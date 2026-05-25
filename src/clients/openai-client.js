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

function normalizePromptHistory(history, userText) {
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length === 0) {
    return safeHistory;
  }

  const lastItem = safeHistory[safeHistory.length - 1];
  const normalizedUserText = String(userText || "").trim();
  if (lastItem?.role === "user" && String(lastItem?.text || "").trim() === normalizedUserText) {
    return safeHistory.slice(0, -1);
  }

  return safeHistory;
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
    sections.push(`TRAINING LANGUAGE FOR THIS SESSION: ${trainingLanguageLabel}. You MUST respond only in this language. Do not use, mention, or offer any other language.`);
  }

  if (nativeLanguageLabel) {
    sections.push(`User's native language (for your context only, do NOT use it to respond): ${nativeLanguageLabel}.`);
  }

  if (difficultyHint) {
    sections.push(`Learner level: ${difficultyHint}`);
  }

  if (memoryContext) {
    sections.push(
      "Context from previous conversations (use only as background memory):\n"
      + memoryContext
    );
  }

  const nativeLang = nativeLanguageLabel || "the user's native language";
  sections.push(
    `RESPONSE FORMAT — you MUST reply with a single valid JSON object and nothing else outside it:\n`
    + `{\n`
    + `  "reply": "<your conversational response in the training language>",\n`
    + `  "correction": {\n`
    + `    "original": "<the user's exact text>",\n`
    + `    "corrected": "<grammatically and orthographically correct version>",\n`
    + `    "notes": ["<brief explanation of each correction written in ${nativeLang}>"]\n`
    + `  }\n`
    + `}\n`
    + `If the user's text has NO grammar, spelling, or punctuation errors, use "correction": null.\n`
    + `In "correction.original" and "correction.corrected", NEVER include speaker labels like "User:" or "Assistant:".\n`
    + `In "correction.notes", NEVER mention speaker labels, prefixes, transcript formatting, or prompt structure. Only describe language changes in the sentence.\n`
    + `Do NOT include markdown fences, comments, or any text outside the JSON object.`
  );

  return sections.join("\n\n");
}

// Parses the JSON response from the LLM — robust to code fences and minor formatting issues.
// Falls back to treating the entire text as the reply if JSON cannot be extracted.
function parseAssistantResponse(rawText) {
  const text = String(rawText || "").trim();

  const tryParse = (str) => {
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed?.reply === "string" && parsed.reply.trim()) {
        return {
          reply:      parsed.reply.trim(),
          correction: parsed.correction && typeof parsed.correction === "object" ? parsed.correction : null
        };
      }
    } catch {}
    return null;
  };

  // 1. Direct parse
  const direct = tryParse(text);
  if (direct) { return direct; }

  // 2. Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const fromFence = tryParse(fenceMatch[1].trim());
    if (fromFence) { return fromFence; }
  }

  // 3. Grab first {...} block that contains "reply"
  const objMatch = text.match(/\{[\s\S]*?"reply"[\s\S]*?\}/);
  if (objMatch) {
    const fromObj = tryParse(objMatch[0]);
    if (fromObj) { return fromObj; }
  }

  // 4. Fallback — treat raw text as the reply, no correction
  return { reply: text, correction: null };
}

function getOpenAiApiKey(config) {
  return requireEnvValue("OPENAI_API_KEY", "OpenAI");
}

async function callResponsesApi({
  config,
  model,
  instructions,
  input
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

// Returns { reply: string, correction: object|null }
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
  const transcript = mapHistoryToTranscript(normalizePromptHistory(history, userText));
  const input = transcript
    ? `${transcript}\nUser: ${userText}`
    : `User: ${userText}`;

  const rawText = await callResponsesApi({
    config,
    model: String(openai.conversationModel || "gpt-5-mini"),
    instructions,
    input
  });

  return parseAssistantResponse(rawText);
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
    input: text
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
    input: transcript
  });
}

module.exports = {
  transcribeAudio,
  generateAssistantReply,
  generateGrammarWithLlm,
  generateTalkSummary
};
