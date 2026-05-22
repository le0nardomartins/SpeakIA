const { requireEnvValue } = require("../config/env-store");

function cleanBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function truncateForError(text, max = 400) {
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  const parts = [];

  for (const item of output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }
    for (const chunk of item.content) {
      if (chunk?.type === "output_text" && typeof chunk?.text === "string") {
        parts.push(chunk.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function mapHistoryToTranscript(history) {
  const safeHistory = Array.isArray(history) ? history : [];
  const lines = [];

  for (const item of safeHistory) {
    if (!item || typeof item.text !== "string") {
      continue;
    }
    const role = item.role === "assistant" ? "Assistant" : "User";
    lines.push(`${role}: ${item.text}`);
  }

  return lines.join("\n");
}

function inferExtensionFromMimeType(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("wav")) return "wav";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function applyPromptVars(template, variables) {
  let output = String(template || "");
  for (const [name, value] of Object.entries(variables || {})) {
    const token = new RegExp(`{{\\s*${name}\\s*}}`, "g");
    output = output.replace(token, String(value ?? ""));
  }
  return output;
}

function buildBaseSpeechInstructions({
  config,
  assistantName,
  difficultyHint,
  memoryContext,
  trainingLanguageLabel,
  nativeLanguageLabel,
  alwaysTrainingLanguageLabels
}) {
  const basePrompt = String(config.prompts?.speechBaseEnglish || "");
  const promptWithName = applyPromptVars(basePrompt, { assistantName });

  const sections = [promptWithName];

  if (trainingLanguageLabel) {
    sections.push(`Current training language for this interaction: ${trainingLanguageLabel}.`);
  }

  if (nativeLanguageLabel) {
    sections.push(`User native language preference: ${nativeLanguageLabel}.`);
  }

  if (alwaysTrainingLanguageLabels) {
    sections.push(`Always-practiced languages set by user: ${alwaysTrainingLanguageLabels}.`);
  }

  if (difficultyHint) {
    sections.push(`Current learner level guidance: ${difficultyHint}`);
  }

  if (memoryContext) {
    sections.push(
      "Context from previous conversations. Use this only as supportive memory:\n"
      + memoryContext
    );
  }

  return sections.join("\n\n");
}

function getOpenAiApiKey(config) {
  return requireEnvValue("OPENAI_API_KEY", "OpenAI");
}

async function callResponsesApi({
  config,
  model,
  instructions,
  input,
  temperature
}) {
  const openai = config.providers.openai;
  const apiKey = getOpenAiApiKey(config);
  const baseUrl = cleanBaseUrl(openai.baseUrl);

  const payload = {
    model,
    instructions,
    input,
    store: false
  };

  if (typeof temperature === "number") {
    payload.temperature = temperature;
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = truncateForError(await response.text());
    throw new Error(`OpenAI responses request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = extractResponseText(data);

  if (!text) {
    throw new Error("OpenAI responses request returned empty text");
  }

  return text;
}

async function transcribeAudio({
  config,
  audioBuffer,
  mimeType,
  languageIso6391
}) {
  const openai = config.providers.openai;
  const apiKey = getOpenAiApiKey(config);
  const baseUrl = cleanBaseUrl(openai.baseUrl);

  const arrayBuffer = audioBuffer instanceof ArrayBuffer
    ? audioBuffer
    : audioBuffer?.buffer;

  if (!arrayBuffer) {
    throw new Error("Audio buffer is missing");
  }

  const blob = new Blob([arrayBuffer], { type: mimeType || "audio/webm" });
  const formData = new FormData();
  const fileExt = inferExtensionFromMimeType(mimeType);

  formData.append("file", blob, `recording.${fileExt}`);
  formData.append("model", String(openai.transcriptionModel || "gpt-4o-mini-transcribe"));
  if (languageIso6391) {
    formData.append("language", languageIso6391);
  }

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = truncateForError(await response.text());
    throw new Error(`OpenAI transcription failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = String(data?.text || "").trim();
  if (!text) {
    throw new Error("OpenAI transcription returned empty text");
  }

  return text;
}

async function generateAssistantReply({
  config,
  history,
  userText,
  assistantName,
  difficultyHint,
  memoryContext,
  trainingLanguageLabel,
  nativeLanguageLabel,
  alwaysTrainingLanguageLabels
}) {
  const openai = config.providers.openai;
  const instructions = buildBaseSpeechInstructions({
    config,
    assistantName,
    difficultyHint,
    memoryContext,
    trainingLanguageLabel,
    nativeLanguageLabel,
    alwaysTrainingLanguageLabels
  });
  const transcript = mapHistoryToTranscript(history);
  const input = transcript
    ? `${transcript}\nUser: ${userText}\nAssistant:`
    : `User: ${userText}\nAssistant:`;

  return callResponsesApi({
    config,
    model: String(openai.conversationModel || "gpt-5-mini"),
    instructions,
    input,
    temperature: openai.conversationTemperature
  });
}

async function generateGrammarWithLlm({
  config,
  text,
  assistantName
}) {
  const openai = config.providers.openai;
  const prompt = String(config.prompts?.grammarCompanionEnglish || "");
  const instructions = applyPromptVars(prompt, { assistantName });
  const result = await callResponsesApi({
    config,
    model: String(openai.grammarModel || openai.conversationModel || "gpt-5-mini"),
    instructions,
    input: text,
    temperature: 0.6
  });

  return result.trim();
}

async function generateTalkSummary({
  config,
  history,
  assistantName
}) {
  const transcript = mapHistoryToTranscript(history);
  if (!transcript) {
    return "";
  }

  const openai = config.providers.openai;
  const summaryPrompt = String(config.prompts?.talkSummaryEnglish || "");
  const instructions = applyPromptVars(summaryPrompt, { assistantName });

  return callResponsesApi({
    config,
    model: String(openai.summaryModel || openai.conversationModel || "gpt-5-mini"),
    instructions,
    input: transcript,
    temperature: 0.3
  });
}

module.exports = {
  transcribeAudio,
  generateAssistantReply,
  generateGrammarWithLlm,
  generateTalkSummary
};
