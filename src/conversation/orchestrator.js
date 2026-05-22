const { generateAssistantReply, generateGrammarWithLlm } = require("../clients/openai-client");
const { synthesizeSpeech } = require("../clients/elevenlabs-client");
const { runLocalCorrection } = require("./local-grammar-engine");
const { translateText } = require("../clients/translation-client");

function findLanguage(config, languageId) {
  return config.languages.find((item) => item.id === languageId)
    || config.languages.find((item) => item.id === config.app.defaultLanguageId)
    || config.languages[0];
}

function findDifficulty(config, difficultyId) {
  return config.difficultyLevels.find((item) => item.id === difficultyId)
    || config.difficultyLevels.find((item) => item.id === config.app.defaultDifficultyId)
    || config.difficultyLevels[0];
}

function labelsFromLanguageIds(config, languageIds) {
  const ids = Array.isArray(languageIds) ? languageIds : [];
  const labels = ids.map((id) => findLanguage(config, id)?.label).filter(Boolean);
  return labels.join(", ");
}

function shouldGenerateCorrection(config, modeId) {
  const enabledModes = config.correction?.enabledModeIds || [];
  return enabledModes.includes(modeId);
}

async function generateCorrection({
  config,
  languageId,
  text,
  assistantName
}) {
  const engine = String(config.correction?.engine || "local_heuristic");

  if (engine === "llm") {
    const parallelCoachText = await generateGrammarWithLlm({
      config,
      text,
      assistantName
    });
    return {
      original: text,
      corrected: parallelCoachText,
      changed: parallelCoachText !== text,
      notes: ["Coach paralelo gerado por LLM."]
    };
  }

  return runLocalCorrection({
    text,
    languageId,
    rules: config.correction?.localRules || {}
  });
}

function trimHistory(history, maxItems) {
  const safeHistory = Array.isArray(history) ? history : [];
  const limit = Number.isInteger(maxItems) && maxItems > 0 ? maxItems : 20;
  return safeHistory.slice(-limit);
}

async function maybeTranslate({
  config,
  text,
  translationEnabled,
  targetLanguageIso6391
}) {
  if (!translationEnabled) {
    return null;
  }
  if (!config.translation?.enabled) {
    return null;
  }
  if (!targetLanguageIso6391) {
    return null;
  }

  const translated = await translateText({
    text,
    targetIso6391: targetLanguageIso6391
  });

  return translated || null;
}

function buildSpeechDiagnostics({
  userText,
  correction,
  translatedUserText
}) {
  const isLikelyCorrect = !correction?.changed;
  return {
    understoodText: userText,
    translatedUserText: translatedUserText || "",
    isLikelyCorrect,
    suggestedText: correction?.corrected || userText,
    correctnessMessage: isLikelyCorrect
      ? "Sua fala foi entendida e esta correta."
      : "Sua fala foi entendida, mas pode melhorar com pequenos ajustes."
  };
}

async function processTurn({ config, payload }) {
  const language = findLanguage(config, payload.languageId);
  const targetTranslationLanguage = findLanguage(config, payload.translationTargetLanguageId);
  const nativeLanguage = findLanguage(config, payload.nativeLanguageId);
  const difficulty = findDifficulty(config, payload.difficultyId);
  const modeId = payload.modeId || config.app.defaultModeId;
  const history = trimHistory(payload.history, config.ui?.maxHistoryMessages);
  const userText = String(payload.text || "").trim();
  const assistantName = String(payload.assistantName || config.app.defaultAssistantName || config.app.name || "SpeakAI");
  const memoryContext = String(payload.memoryContext || "").trim();
  const sessionType = String(payload.sessionType || "text");
  const alwaysTrainingLanguageLabels = labelsFromLanguageIds(
    config,
    payload.alwaysTrainingLanguageIds
  );

  if (!userText) {
    throw new Error("User text is empty");
  }

  const assistantPromise = generateAssistantReply({
    config,
    history,
    userText,
    assistantName,
    difficultyHint: difficulty?.promptHint || "",
    memoryContext,
    trainingLanguageLabel: language?.label || "",
    nativeLanguageLabel: nativeLanguage?.label || "",
    alwaysTrainingLanguageLabels
  });

  const correctionPromise = shouldGenerateCorrection(config, modeId)
    ? generateCorrection({
        config,
        languageId: language.id,
        text: userText,
        assistantName
      })
    : Promise.resolve(null);

  const [assistantText, correction] = await Promise.all([
    assistantPromise,
    correctionPromise
  ]);

  const translatedAssistantText = await maybeTranslate({
    config,
    text: assistantText,
    translationEnabled: Boolean(payload.translateAssistantReply),
    targetLanguageIso6391: targetTranslationLanguage?.iso6391
  });

  let speechDiagnostics = null;
  if (sessionType === "speech") {
    const speechCorrection = correction || runLocalCorrection({
      text: userText,
      languageId: language.id,
      rules: config.correction?.localRules || {}
    });

    const translatedUserText = await maybeTranslate({
      config,
      text: userText,
      translationEnabled: Boolean(payload.translateUserSpeechToNative),
      targetLanguageIso6391: nativeLanguage?.iso6391
    });

    speechDiagnostics = buildSpeechDiagnostics({
      userText,
      correction: speechCorrection,
      translatedUserText
    });
  }

  let audioDataUrl = null;
  if (config.ui?.assistantVoiceEnabled && payload.voiceId) {
    audioDataUrl = await synthesizeSpeech({
      config,
      text: assistantText,
      voiceId: payload.voiceId,
      languageIso6391: language.iso6391
    });
  }

  return {
    assistantText,
    translatedAssistantText,
    correction,
    audioDataUrl,
    speechDiagnostics
  };
}

module.exports = {
  processTurn
};
