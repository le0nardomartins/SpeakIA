const path = require("node:path");
const fs = require("node:fs");
const dotenv = require("dotenv");
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
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

function resolveAppIconPath() {
  const candidates = [
    path.resolve(__dirname, "../assets/background/favicon/favicon.ico"),
    path.resolve(__dirname, "../assets/without_background/favicon/favicon.ico")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
}

function createMainWindow() {
  const iconPath = resolveAppIconPath();
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
}

function registerIpcHandlers() {
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
    const transcript = await transcribeAudio({
      config,
      audioBuffer: payload.audioBuffer,
      mimeType: payload.mimeType,
      languageIso6391: language?.iso6391
    });
    return { text: transcript };
  });

  ipcMain.handle("speakai:process-turn", async (_event, payload) => {
    const config = getConfig();
    return processTurn({ config, payload });
  });

  ipcMain.handle("speakai:get-memory-snapshot", async () => {
    const config = getConfig();
    return getMemorySnapshot(config);
  });

  ipcMain.handle("speakai:finalize-conversation", async (_event, payload) => {
    const config = getConfig();
    return finalizeConversation({
      config,
      history: payload?.history || [],
      assistantName: payload?.assistantName || config.app.defaultAssistantName
    });
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
    const translated = await translateText({ text, targetIso6391 });
    return { text: translated };
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
