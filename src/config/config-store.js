const fs = require("node:fs");
const path = require("node:path");

const BASE_CONFIG_PATH = path.resolve(__dirname, "../../config.json");
const LOCAL_CONFIG_PATH = path.resolve(__dirname, "../../config.local.json");

let cachedConfig = null;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(baseValue, overrideValue) {
  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
    return overrideValue;
  }
  if (isObject(baseValue) && isObject(overrideValue)) {
    const result = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      result[key] = key in baseValue ? deepMerge(baseValue[key], value) : value;
    }
    return result;
  }
  return overrideValue;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function assertField(condition, message) {
  if (!condition) {
    throw new Error(`Invalid config: ${message}`);
  }
}

function validateConfig(config) {
  assertField(isObject(config), "root must be an object");
  assertField(isObject(config.app), "app must be an object");
  assertField(isObject(config.providers), "providers must be an object");
  assertField(isObject(config.providers.openai), "providers.openai must be an object");
  assertField(isObject(config.providers.elevenlabs), "providers.elevenlabs must be an object");
  assertField(isObject(config.prompts), "prompts must be an object");
  assertField(Array.isArray(config.languages) && config.languages.length > 0, "languages must be a non-empty array");
  assertField(Array.isArray(config.voices) && config.voices.length > 0, "voices must be a non-empty array");
  assertField(Array.isArray(config.modes) && config.modes.length > 0, "modes must be a non-empty array");
  assertField(Array.isArray(config.difficultyLevels) && config.difficultyLevels.length > 0, "difficultyLevels must be a non-empty array");
  assertField(isObject(config.memory), "memory must be an object");
  assertField(isObject(config.translation), "translation must be an object");
  assertField(isObject(config.themes), "themes must be an object");
  assertField(Array.isArray(config.themes.options) && config.themes.options.length > 0, "themes.options must be a non-empty array");
  assertField(typeof config.providers.openai.baseUrl === "string", "providers.openai.baseUrl must be string");
  assertField(typeof config.providers.elevenlabs.baseUrl === "string", "providers.elevenlabs.baseUrl must be string");
  assertField(typeof config.prompts.speechBaseEnglish === "string", "prompts.speechBaseEnglish must be string");
  assertField(typeof config.prompts.grammarCompanionEnglish === "string", "prompts.grammarCompanionEnglish must be string");
  assertField(typeof config.prompts.talkSummaryEnglish === "string", "prompts.talkSummaryEnglish must be string");
  assertField(typeof config.app.defaultAssistantName === "string", "app.defaultAssistantName must be string");
  assertField(typeof config.app.defaultDifficultyId === "string", "app.defaultDifficultyId must be string");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadConfig() {
  const baseConfig = readJsonFile(BASE_CONFIG_PATH);
  const config = fs.existsSync(LOCAL_CONFIG_PATH)
    ? deepMerge(baseConfig, readJsonFile(LOCAL_CONFIG_PATH))
    : baseConfig;

  validateConfig(config);
  cachedConfig = config;
  return clone(cachedConfig);
}

function getConfig() {
  if (!cachedConfig) {
    loadConfig();
  }
  return clone(cachedConfig);
}

function getPublicConfig() {
  return getConfig();
}

module.exports = {
  BASE_CONFIG_PATH,
  LOCAL_CONFIG_PATH,
  loadConfig,
  getConfig,
  getPublicConfig
};
