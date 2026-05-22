const fs = require("node:fs");
const path = require("node:path");

const ENV_PATH = path.resolve(__dirname, "../../.env");

function ensureEnvFileExists() {
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(
      ENV_PATH,
      "OPENAI_API_KEY=\nELEVENLABS_API_KEY=\n",
      "utf8"
    );
  }
}

function readEnvRaw() {
  ensureEnvFileExists();
  return fs.readFileSync(ENV_PATH, "utf8");
}

function parseEnvValue(raw, key) {
  const regex = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "mi");
  const match = raw.match(regex);
  if (!match) {
    return "";
  }
  return String(match[1] || "").trim();
}

function maskValue(value) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }
  if (raw.length <= 6) {
    return "*".repeat(raw.length);
  }
  return `${raw.slice(0, 3)}${"*".repeat(raw.length - 6)}${raw.slice(-3)}`;
}

function getApiKeySettings() {
  const raw = readEnvRaw();
  const openaiApiKey = parseEnvValue(raw, "OPENAI_API_KEY");
  const elevenlabsApiKey = parseEnvValue(raw, "ELEVENLABS_API_KEY");

  return {
    openaiApiKey,
    elevenlabsApiKey,
    openaiApiKeyMasked: maskValue(openaiApiKey),
    elevenlabsApiKeyMasked: maskValue(elevenlabsApiKey)
  };
}

function upsertEnvValue(raw, key, value) {
  const normalizedValue = String(value || "").trim();
  const lines = raw.split(/\r?\n/);
  const lineRegex = new RegExp(`^\\s*${key}\\s*=`);
  const existingIndex = lines.findIndex((line) => lineRegex.test(line));

  if (existingIndex >= 0) {
    lines[existingIndex] = `${key}=${normalizedValue}`;
  } else {
    lines.push(`${key}=${normalizedValue}`);
  }

  return lines.join("\n").replace(/\n+$/g, "\n");
}

function saveApiKeySettings(payload) {
  const safePayload = payload || {};
  let raw = readEnvRaw();

  if (Object.prototype.hasOwnProperty.call(safePayload, "openaiApiKey")) {
    raw = upsertEnvValue(raw, "OPENAI_API_KEY", safePayload.openaiApiKey);
    process.env.OPENAI_API_KEY = String(safePayload.openaiApiKey || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(safePayload, "elevenlabsApiKey")) {
    raw = upsertEnvValue(raw, "ELEVENLABS_API_KEY", safePayload.elevenlabsApiKey);
    process.env.ELEVENLABS_API_KEY = String(safePayload.elevenlabsApiKey || "").trim();
  }

  fs.writeFileSync(ENV_PATH, raw, "utf8");
  return getApiKeySettings();
}

module.exports = {
  ENV_PATH,
  getApiKeySettings,
  saveApiKeySettings
};
