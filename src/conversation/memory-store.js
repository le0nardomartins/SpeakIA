const fs = require("node:fs");
const path = require("node:path");

function getMemoryFolderPath(config) {
  const folder = String(config.memory?.folder || "ai_memory");
  return path.resolve(__dirname, "../../", folder);
}

function ensureMemoryFolder(config) {
  const folderPath = getMemoryFolderPath(config);
  fs.mkdirSync(folderPath, { recursive: true });
  return folderPath;
}

function parseTalkNumber(fileName, talkPrefix) {
  const escapedPrefix = String(talkPrefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escapedPrefix}(\\d+)\\.txt$`, "i");
  const match = fileName.match(regex);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function listTalkFiles(config) {
  const folderPath = ensureMemoryFolder(config);
  const talkPrefix = String(config.memory?.talkPrefix || "talk_");
  const files = fs.readdirSync(folderPath);
  const talks = [];

  for (const fileName of files) {
    const talkNumber = parseTalkNumber(fileName, talkPrefix);
    if (!Number.isInteger(talkNumber)) {
      continue;
    }
    talks.push({
      fileName,
      talkNumber,
      absolutePath: path.join(folderPath, fileName)
    });
  }

  talks.sort((a, b) => a.talkNumber - b.talkNumber);
  return talks;
}

function loadAllTalkSummaries(config) {
  const talks = listTalkFiles(config);
  return talks.map((talk) => {
    const content = fs.readFileSync(talk.absolutePath, "utf8").trim();
    return {
      ...talk,
      content
    };
  }).filter((talk) => talk.content.length > 0);
}

function buildMemoryContext(config) {
  const talks = loadAllTalkSummaries(config);
  if (talks.length === 0) {
    return "";
  }

  return talks
    .map((talk) => `Talk ${talk.talkNumber} summary:\n${talk.content}`)
    .join("\n\n");
}

function saveTalkSummary(config, summary) {
  const safeSummary = String(summary || "").trim();
  if (!safeSummary) {
    return null;
  }

  const talks = listTalkFiles(config);
  const nextNumber = talks.length > 0 ? talks[talks.length - 1].talkNumber + 1 : 1;
  const talkPrefix = String(config.memory?.talkPrefix || "talk_");
  const fileName = `${talkPrefix}${nextNumber}.txt`;
  const absolutePath = path.join(getMemoryFolderPath(config), fileName);

  fs.writeFileSync(absolutePath, `${safeSummary}\n`, "utf8");
  return { fileName, absolutePath, talkNumber: nextNumber };
}

module.exports = {
  buildMemoryContext,
  loadAllTalkSummaries,
  saveTalkSummary
};
