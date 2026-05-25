const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const dotenv = require("dotenv");
const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { loadConfig, getConfig, getPublicConfig } = require("./config/config-store");
const { transcribeAudio } = require("./clients/openai-client");
const { translateText } = require("./clients/translation-client");
const { processTurn } = require("./conversation/orchestrator");
const {
  getMemorySnapshot,
  finalizeConversation
} = require("./conversation/conversation-memory-orchestrator");
const { loadAllTalkSummaries } = require("./conversation/memory-store");
const {
  getApiKeySettings,
  saveApiKeySettings
} = require("./config/env-file-store");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

if (!app || !BrowserWindow || !ipcMain) {
  console.error("Electron main process is unavailable. Ensure ELECTRON_RUN_AS_NODE is not set.");
  process.exit(1);
}

let mainWindow = null;
let allowWindowClose = false;
let closeHandshakePending = false;
let closeHandshakeTimer = null;
let debugModeEnabled = false;
let debugViewerProcess = null;

const DEBUG_LOG_MAX_CHARS = 4000;

function resolveDebugLogPath() {
  const logsDir = path.resolve(__dirname, "../logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return path.join(logsDir, "debug_console.log");
}

function sanitizeDebugValue(key, value) {
  if (key === "audioBuffer" && value && typeof value.byteLength === "number") {
    return `[ArrayBuffer ${value.byteLength} bytes]`;
  }
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.byteLength} bytes]`;
  }
  if (typeof value === "string" && value.length > DEBUG_LOG_MAX_CHARS) {
    return `${value.slice(0, DEBUG_LOG_MAX_CHARS)}... [truncated ${value.length - DEBUG_LOG_MAX_CHARS} chars]`;
  }
  return value;
}

function safeDebugSerialize(payload) {
  if (payload === undefined || payload === null || payload === "") {
    return "";
  }
  if (typeof payload === "string") {
    return payload.length > DEBUG_LOG_MAX_CHARS
      ? `${payload.slice(0, DEBUG_LOG_MAX_CHARS)}... [truncated ${payload.length - DEBUG_LOG_MAX_CHARS} chars]`
      : payload;
  }
  try {
    const raw = JSON.stringify(payload, sanitizeDebugValue);
    if (!raw) {
      return "";
    }
    if (raw.length > DEBUG_LOG_MAX_CHARS) {
      return `${raw.slice(0, DEBUG_LOG_MAX_CHARS)}... [truncated ${raw.length - DEBUG_LOG_MAX_CHARS} chars]`;
    }
    return raw;
  } catch {
    return String(payload);
  }
}

function writeDebugLine(indicator, payload) {
  if (!debugModeEnabled && indicator !== "DEBUG_MODE") {
    return;
  }
  const timestamp = new Date().toISOString();
  const detail = safeDebugSerialize(payload);
  const line = detail
    ? `${timestamp} [${indicator}] ${detail}`
    : `${timestamp} [${indicator}]`;

  try {
    fs.appendFileSync(resolveDebugLogPath(), `${line}${os.EOL}`, "utf8");
  } catch {}

  if (debugModeEnabled) {
    console.log(line);
  }
}

function stopDebugViewer() {
  if (!debugViewerProcess) {
    return;
  }
  try {
    debugViewerProcess.kill();
  } catch {}
  debugViewerProcess = null;
}

function startDebugViewer() {
  if (process.platform !== "win32") {
    return;
  }
  if (debugViewerProcess) {
    return;
  }

  const logFilePath = resolveDebugLogPath();
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, "", "utf8");
  }

  const escapedPath = logFilePath.replace(/'/g, "''");
  const command = [
    "$Host.UI.RawUI.WindowTitle = 'SpeakAI Debug Console';",
    `$logPath = '${escapedPath}';`,
    "if (!(Test-Path $logPath)) { New-Item -ItemType File -Path $logPath -Force | Out-Null }",
    "Get-Content -Path $logPath -Tail 150 -Wait"
  ].join(" ");

  try {
    debugViewerProcess = spawn("powershell.exe", [
      "-NoLogo",
      "-NoExit",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command
    ], {
      detached: false,
      stdio: "ignore",
      windowsHide: false
    });

    debugViewerProcess.on("exit", () => {
      debugViewerProcess = null;
    });
  } catch (error) {
    debugViewerProcess = null;
    writeDebugLine("DEBUG_VIEWER_ERROR", { message: error?.message || String(error) });
  }
}

function setDebugModeEnabled(enabled, source = "renderer") {
  const next = Boolean(enabled);
  if (debugModeEnabled === next) {
    return debugModeEnabled;
  }

  debugModeEnabled = next;
  if (debugModeEnabled) {
    startDebugViewer();
  }
  writeDebugLine("DEBUG_MODE", { enabled: debugModeEnabled, source });
  if (!debugModeEnabled) {
    stopDebugViewer();
  }
  return debugModeEnabled;
}

function clearCloseHandshakeTimer() {
  if (closeHandshakeTimer) {
    clearTimeout(closeHandshakeTimer);
    closeHandshakeTimer = null;
  }
}

function requestRendererCloseConsent() {
  if (!mainWindow || mainWindow.isDestroyed() || closeHandshakePending) {
    return;
  }

  if (mainWindow.webContents.isLoadingMainFrame()) {
    allowWindowClose = true;
    mainWindow.close();
    return;
  }

  closeHandshakePending = true;
  mainWindow.webContents.send("speakai:app-close-requested");

  // Fallback de segurança caso o renderer não responda.
  closeHandshakeTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !closeHandshakePending) {
      return;
    }
    closeHandshakePending = false;
    allowWindowClose = true;
    mainWindow.close();
  }, 180000);
}

function resolveAppIconPath() {
  const candidates = [
    path.resolve(__dirname, "../assets/background/favicon/favicon.ico"),
    path.resolve(__dirname, "../assets/without_background/favicon/favicon.ico")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
}

function createMainWindow() {
  const iconPath = resolveAppIconPath();
  allowWindowClose = false;
  closeHandshakePending = false;
  clearCloseHandshakeTimer();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "SpeakAI",
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "../GUI/index.html"));

  mainWindow.on("close", (event) => {
    if (allowWindowClose) {
      return;
    }
    event.preventDefault();
    requestRendererCloseConsent();
  });

  mainWindow.on("closed", () => {
    clearCloseHandshakeTimer();
    closeHandshakePending = false;
    allowWindowClose = false;
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.on("speakai:debug-log", (_event, payload) => {
    const indicator = String(payload?.indicator || "DEBUG").trim().toUpperCase() || "DEBUG";
    writeDebugLine(indicator, payload?.data ?? payload?.message ?? "");
  });

  ipcMain.handle("speakai:set-debug-mode", async (_event, payload) => {
    const enabled = setDebugModeEnabled(Boolean(payload?.enabled), "renderer");
    return { enabled };
  });

  ipcMain.on("speakai:app-close-response", (_event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || !closeHandshakePending) {
      return;
    }

    if (!payload || payload.canClose !== true) {
      return;
    }

    closeHandshakePending = false;
    clearCloseHandshakeTimer();
    allowWindowClose = true;
    mainWindow.close();
  });

  ipcMain.handle("speakai:get-config", async () => {
    return getPublicConfig();
  });

  ipcMain.handle("speakai:reload-config", async () => {
    loadConfig();
    return getPublicConfig();
  });

  ipcMain.handle("speakai:transcribe-audio", async (_event, payload) => {
    const config = getConfig();
    const language = config.languages.find((item) => item.id === payload.languageId);
    writeDebugLine("TRANSCRIBE_REQUEST", {
      languageId: payload?.languageId,
      mimeType: payload?.mimeType,
      languageIso6391: language?.iso6391
    });
    try {
      const transcript = await transcribeAudio({
        config,
        audioBuffer: payload.audioBuffer,
        mimeType: payload.mimeType,
        languageIso6391: language?.iso6391
      });
      writeDebugLine("TRANSCRIBE_RESPONSE", { transcript });
      return { text: transcript };
    } catch (error) {
      writeDebugLine("TRANSCRIBE_ERROR", { message: error?.message || String(error) });
      throw error;
    }
  });

  ipcMain.handle("speakai:process-turn", async (_event, payload) => {
    const config = getConfig();
    writeDebugLine("TURN_REQUEST", {
      sessionType: payload?.sessionType,
      languageId: payload?.languageId,
      difficultyId: payload?.difficultyId,
      voiceId: payload?.voiceId || "",
      userText: payload?.text || "",
      historyItems: Array.isArray(payload?.history) ? payload.history.length : 0
    });
    try {
      const result = await processTurn({ config, payload });
      writeDebugLine("API_RESPONSE", {
        assistantText: result?.assistantText || "",
        translatedAssistantText: result?.translatedAssistantText || "",
        correction: result?.correction || null,
        speechDiagnostics: result?.speechDiagnostics || null,
        hasAudio: Boolean(result?.audioDataUrl)
      });
      return result;
    } catch (error) {
      writeDebugLine("TURN_ERROR", { message: error?.message || String(error) });
      throw error;
    }
  });

  ipcMain.handle("speakai:get-memory-snapshot", async () => {
    const config = getConfig();
    return getMemorySnapshot(config);
  });

  ipcMain.handle("speakai:finalize-conversation", async (_event, payload) => {
    const config = getConfig();
    writeDebugLine("FINALIZE_REQUEST", {
      assistantName: payload?.assistantName || config.app.defaultAssistantName,
      historyItems: Array.isArray(payload?.history) ? payload.history.length : 0
    });
    const result = await finalizeConversation({
      config,
      history: payload?.history || [],
      assistantName: payload?.assistantName || config.app.defaultAssistantName
    });
    writeDebugLine("FINALIZE_RESPONSE", {
      saved: Boolean(result?.saved),
      fileName: result?.fileName || "",
      talkCount: result?.talkCount || 0
    });
    return result;
  });

  ipcMain.handle("speakai:get-api-settings", async () => {
    return getApiKeySettings();
  });

  ipcMain.handle("speakai:save-api-settings", async (_event, payload) => {
    return saveApiKeySettings(payload || {});
  });

  ipcMain.handle("speakai:list-conversations", async () => {
    const config = getConfig();
    const talks  = loadAllTalkSummaries(config);
    return talks.map((t) => ({
      talkNumber: t.talkNumber,
      fileName:   t.fileName,
      preview:    t.content.slice(0, 300)
    }));
  });

  ipcMain.handle("speakai:translate-text", async (_event, payload) => {
    const text = String(payload?.text || "").trim();
    const targetIso6391 = String(payload?.targetIso6391 || "pt").trim();
    if (!text) return { text: "" };
    writeDebugLine("TRANSLATE_REQUEST", { targetIso6391, text });
    const translated = await translateText({ text, targetIso6391 });
    writeDebugLine("TRANSLATE_RESPONSE", { translated });
    return { text: translated };
  });

  ipcMain.handle("speakai:open-external-url", async (_event, payload) => {
    const rawUrl = String(payload?.url || "").trim();
    if (!rawUrl) {
      throw new Error("URL vazia.");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error("URL inválida.");
    }

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("Protocolo não permitido.");
    }

    await shell.openExternal(parsedUrl.toString());
    return { ok: true };
  });
}

async function bootstrap() {
  loadConfig();
  registerIpcHandlers();
  await app.whenReady();
  Menu.setApplicationMenu(null);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap SpeakAI:", error);
  app.quit();
});

app.on("before-quit", () => {
  stopDebugViewer();
});

app.on("window-all-closed", () => {
  stopDebugViewer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
