const { requireEnvValue } = require("../config/env-store");

function cleanBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function mapFormatToMimeType(outputFormat) {
  const format = String(outputFormat || "").toLowerCase();
  if (format.startsWith("wav")) return "audio/wav";
  if (format.startsWith("pcm")) return "audio/pcm";
  if (format.startsWith("ulaw") || format.startsWith("alaw")) return "audio/basic";
  if (format.startsWith("opus")) return "audio/ogg";
  return "audio/mpeg";
}

function toBase64(arrayBuffer) {
  return Buffer.from(arrayBuffer).toString("base64");
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

async function synthesizeSpeech({
  config,
  text,
  voiceId,
  languageIso6391
}) {
  const elevenlabs = config.providers.elevenlabs;
  const apiKey = requireEnvValue("ELEVENLABS_API_KEY", "ElevenLabs");
  const baseUrl = cleanBaseUrl(elevenlabs.baseUrl);
  const outputFormat = String(elevenlabs.outputFormat || "mp3_44100_128");
  const modelId = String(elevenlabs.modelId || "eleven_multilingual_v2");

  const url = `${baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;
  const body = {
    text,
    model_id: modelId,
    voice_settings: elevenlabs.voiceSettings || {}
  };

  if (languageIso6391) {
    body.language_code = languageIso6391;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = truncateForError(await response.text());
    throw new Error(`ElevenLabs speech request failed (${response.status}): ${errorText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const mimeType = mapFormatToMimeType(outputFormat);
  return `data:${mimeType};base64,${toBase64(audioBuffer)}`;
}

module.exports = {
  synthesizeSpeech
};
