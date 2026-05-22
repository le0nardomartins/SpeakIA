const { generateTalkSummary } = require("../clients/openai-client");
const { buildMemoryContext, loadAllTalkSummaries, saveTalkSummary } = require("./memory-store");

function sanitizeHistory(history) {
  const safeHistory = Array.isArray(history) ? history : [];
  return safeHistory.filter((item) => {
    if (!item) {
      return false;
    }
    if (item.role !== "user" && item.role !== "assistant") {
      return false;
    }
    return typeof item.text === "string" && item.text.trim().length > 0;
  });
}

function getMemorySnapshot(config) {
  const talks = loadAllTalkSummaries(config);
  return {
    memoryContext: buildMemoryContext(config),
    talkCount: talks.length
  };
}

async function finalizeConversation({
  config,
  history,
  assistantName
}) {
  const safeHistory = sanitizeHistory(history);
  if (safeHistory.length < 2) {
    return {
      saved: false,
      summary: "",
      fileName: "",
      ...getMemorySnapshot(config)
    };
  }

  const summary = await generateTalkSummary({
    config,
    history: safeHistory,
    assistantName
  });

  const saved = saveTalkSummary(config, summary);
  const snapshot = getMemorySnapshot(config);

  return {
    saved: Boolean(saved),
    summary,
    fileName: saved?.fileName || "",
    ...snapshot
  };
}

module.exports = {
  getMemorySnapshot,
  finalizeConversation
};
