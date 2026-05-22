const USER_OPTIONS_STORAGE_KEY = "speakai_user_options_v2";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "speakai_sidebar_collapsed_v1";

const state = {
  config: null,
  activeTab: "text",
  isBusy: false,
  memoryContext: "",
  memoryCount: 0,
  options: null,
  optionsDirty: false,
  sessions: {
    text: { history: [] },
    speech: { history: [] }
  },
  speechRecording: {
    recorder: null,
    chunks: [],
    stream: null,
    active: false
  }
};

const elements = {
  layoutShell: document.getElementById("layoutShell"),
  sidebarToggleButton: document.getElementById("sidebarToggleButton"),
  memoryBadge: document.getElementById("memoryBadge"),
  statusBadge: document.getElementById("statusBadge"),
  reloadConfigButton: document.getElementById("reloadConfigButton"),
  navButtons: Array.from(document.querySelectorAll(".nav-btn")),
  tabText: document.getElementById("tab-text"),
  tabSpeech: document.getElementById("tab-speech"),
  tabOptions: document.getElementById("tab-options"),
  textChatMessages: document.getElementById("textChatMessages"),
  textInteractionLanguageSelect: document.getElementById("textInteractionLanguageSelect"),
  textDifficultySelect: document.getElementById("textDifficultySelect"),
  textInput: document.getElementById("textInput"),
  textSendButton: document.getElementById("textSendButton"),
  textNewConversationButton: document.getElementById("textNewConversationButton"),
  textCorrectionBox: document.getElementById("textCorrectionBox"),
  speechChatMessages: document.getElementById("speechChatMessages"),
  speechInteractionLanguageSelect: document.getElementById("speechInteractionLanguageSelect"),
  speechDifficultySelect: document.getElementById("speechDifficultySelect"),
  speechVoiceSelect: document.getElementById("speechVoiceSelect"),
  speechTextFallbackInput: document.getElementById("speechTextFallbackInput"),
  speechRecordButton: document.getElementById("speechRecordButton"),
  speechRecordLabel: document.getElementById("speechRecordLabel"),
  speechSendTextButton: document.getElementById("speechSendTextButton"),
  speechAudioPlayer: document.getElementById("speechAudioPlayer"),
  speechNewConversationButton: document.getElementById("speechNewConversationButton"),
  speechFeedbackBox: document.getElementById("speechFeedbackBox"),
  saveOptionsButton: document.getElementById("saveOptionsButton"),
  openaiApiKeyInput: document.getElementById("openaiApiKeyInput"),
  elevenlabsApiKeyInput: document.getElementById("elevenlabsApiKeyInput"),
  saveApiKeysButton: document.getElementById("saveApiKeysButton"),
  apiKeysStateText: document.getElementById("apiKeysStateText"),
  assistantNameInput: document.getElementById("assistantNameInput"),
  nativeLanguageSelect: document.getElementById("nativeLanguageSelect"),
  optionsDifficultySelect: document.getElementById("optionsDifficultySelect"),
  alwaysTrainingLanguageChips: document.getElementById("alwaysTrainingLanguageChips"),
  addTrainingLanguageSelect: document.getElementById("addTrainingLanguageSelect"),
  addTrainingLanguageButton: document.getElementById("addTrainingLanguageButton"),
  themeSelect: document.getElementById("themeSelect"),
  translateAssistantToggle: document.getElementById("translateAssistantToggle"),
  translationTargetLanguageSelect: document.getElementById("translationTargetLanguageSelect"),
  showSpeechUnderstoodToggle: document.getElementById("showSpeechUnderstoodToggle"),
  showSpeechCorrectnessToggle: document.getElementById("showSpeechCorrectnessToggle"),
  translateUserSpeechToggle: document.getElementById("translateUserSpeechToggle"),
  showSpeechUserTranslationToggle: document.getElementById("showSpeechUserTranslationToggle")
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatus(message, type = "ok") {
  elements.statusBadge.textContent = message;
  if (type === "error") {
    elements.statusBadge.style.background = "rgba(167, 118, 53, 0.2)";
    elements.statusBadge.style.color = "var(--warn)";
    return;
  }
  elements.statusBadge.style.background = "rgba(47, 137, 107, 0.14)";
  elements.statusBadge.style.color = "var(--ok)";
}

function setBusy(value) {
  state.isBusy = Boolean(value);
  const disabled = state.isBusy;
  elements.reloadConfigButton.disabled = disabled;
  elements.textSendButton.disabled = disabled;
  elements.textNewConversationButton.disabled = disabled;
  elements.speechRecordButton.disabled = disabled;
  elements.speechSendTextButton.disabled = disabled;
  elements.speechNewConversationButton.disabled = disabled;
  elements.saveOptionsButton.disabled = disabled;
  elements.saveApiKeysButton.disabled = disabled;
}

function setMemoryBadge(count) {
  state.memoryCount = Number.isInteger(count) ? count : 0;
  elements.memoryBadge.textContent = `Memórias: ${state.memoryCount}`;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function hasLanguage(languageId) {
  return state.config.languages.some((item) => item.id === languageId);
}

function hasDifficulty(difficultyId) {
  return state.config.difficultyLevels.some((item) => item.id === difficultyId);
}

function hasTheme(themeId) {
  return state.config.themes.options.some((item) => item.id === themeId);
}

function getLanguageById(languageId) {
  return state.config.languages.find((item) => item.id === languageId)
    || state.config.languages.find((item) => item.id === state.config.app.defaultLanguageId)
    || state.config.languages[0];
}

function applyTheme(themeId) {
  const theme = state.config.themes.options.find((item) => item.id === themeId)
    || state.config.themes.options.find((item) => item.id === state.config.app.defaultThemeId)
    || state.config.themes.options[0];

  if (!theme?.tokens) {
    return;
  }

  Object.entries(theme.tokens).forEach(([token, value]) => {
    document.documentElement.style.setProperty(token, value);
  });
}

function getDefaultOptionsFromConfig() {
  return {
    assistantName: String(state.config.app.defaultAssistantName || state.config.app.name || "SpeakAI"),
    nativeLanguageId: hasLanguage("pt-BR") ? "pt-BR" : state.config.app.defaultLanguageId,
    alwaysTrainingLanguageIds: [state.config.app.defaultLanguageId],
    difficultyId: state.config.app.defaultDifficultyId,
    themeId: state.config.app.defaultThemeId,
    translateAssistantReply: Boolean(state.config.translation.defaultEnabled),
    translationTargetLanguageId: state.config.translation.defaultTargetLanguageId || state.config.app.defaultLanguageId,
    showSpeechUnderstood: true,
    showSpeechCorrectness: true,
    translateUserSpeechToNative: true,
    showSpeechUserTranslation: true,
    askTrainingLanguagePerInteraction: true
  };
}

function normalizeOptions(raw) {
  const defaults = getDefaultOptionsFromConfig();
  const source = raw && typeof raw === "object" ? raw : {};

  const alwaysTrainingLanguageIds = Array.isArray(source.alwaysTrainingLanguageIds)
    ? source.alwaysTrainingLanguageIds.filter((id) => hasLanguage(id))
    : defaults.alwaysTrainingLanguageIds;

  const normalized = {
    ...defaults,
    ...source,
    assistantName: String(source.assistantName || defaults.assistantName).trim() || defaults.assistantName,
    nativeLanguageId: hasLanguage(source.nativeLanguageId) ? source.nativeLanguageId : defaults.nativeLanguageId,
    alwaysTrainingLanguageIds: alwaysTrainingLanguageIds.length > 0 ? alwaysTrainingLanguageIds : defaults.alwaysTrainingLanguageIds,
    difficultyId: hasDifficulty(source.difficultyId) ? source.difficultyId : defaults.difficultyId,
    themeId: hasTheme(source.themeId) ? source.themeId : defaults.themeId,
    translationTargetLanguageId: hasLanguage(source.translationTargetLanguageId)
      ? source.translationTargetLanguageId
      : defaults.translationTargetLanguageId,
    translateAssistantReply: Boolean(source.translateAssistantReply ?? defaults.translateAssistantReply),
    showSpeechUnderstood: Boolean(source.showSpeechUnderstood ?? defaults.showSpeechUnderstood),
    showSpeechCorrectness: Boolean(source.showSpeechCorrectness ?? defaults.showSpeechCorrectness),
    translateUserSpeechToNative: Boolean(source.translateUserSpeechToNative ?? defaults.translateUserSpeechToNative),
    showSpeechUserTranslation: Boolean(source.showSpeechUserTranslation ?? defaults.showSpeechUserTranslation),
    askTrainingLanguagePerInteraction: true
  };

  return normalized;
}

function loadStoredOptions() {
  const raw = localStorage.getItem(USER_OPTIONS_STORAGE_KEY);
  if (!raw) {
    return normalizeOptions({});
  }

  try {
    return normalizeOptions(JSON.parse(raw));
  } catch {
    return normalizeOptions({});
  }
}

function persistOptions(options) {
  localStorage.setItem(USER_OPTIONS_STORAGE_KEY, JSON.stringify(options));
}

function getCountryCodeByLanguageId(languageId) {
  const suffix = String(languageId || "").split("-")[1] || "";
  return suffix.length === 2 ? suffix.toUpperCase() : "";
}

function toFlagEmoji(languageId) {
  const countryCode = getCountryCodeByLanguageId(languageId);
  if (!countryCode) {
    return "🌐";
  }
  return countryCode
    .split("")
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

function getSelectedTrainingLanguages() {
  const raw = Array.isArray(state.options?.alwaysTrainingLanguageIds)
    ? state.options.alwaysTrainingLanguageIds
    : [];
  const valid = raw.filter((id) => hasLanguage(id));
  if (valid.length > 0) {
    return valid;
  }
  return [state.config.app.defaultLanguageId];
}

function refreshAddTrainingLanguageSelect() {
  clearChildren(elements.addTrainingLanguageSelect);
  const selected = new Set(getSelectedTrainingLanguages());
  const available = state.config.languages.filter((language) => !selected.has(language.id));

  if (available.length === 0) {
    elements.addTrainingLanguageSelect.appendChild(createOption("", "Todos adicionados"));
    elements.addTrainingLanguageSelect.disabled = true;
    elements.addTrainingLanguageButton.disabled = true;
    return;
  }

  elements.addTrainingLanguageSelect.appendChild(createOption("", "Adicionar idioma"));
  available.forEach((language) => {
    elements.addTrainingLanguageSelect.appendChild(createOption(language.id, language.label));
  });
  elements.addTrainingLanguageSelect.value = available[0].id;
  elements.addTrainingLanguageSelect.disabled = false;
  elements.addTrainingLanguageButton.disabled = false;
}

function renderTrainingLanguageChips() {
  clearChildren(elements.alwaysTrainingLanguageChips);
  const selected = getSelectedTrainingLanguages();

  selected.forEach((languageId) => {
    const language = getLanguageById(languageId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "lang-chip";
    chip.title = language.label;
    chip.setAttribute("aria-label", `${language.label}. Clique para remover.`);
    chip.dataset.languageId = language.id;
    const countryCode = getCountryCodeByLanguageId(language.id).toLowerCase();
    chip.innerHTML = countryCode
      ? `<span class="fi fi-${countryCode} lang-chip-flag"></span>`
      : `<span class="lang-chip-code">${language.id.slice(0, 2).toUpperCase()}</span>`;
    chip.addEventListener("click", () => {
      const current = getSelectedTrainingLanguages();
      if (current.length <= 1) {
        setStatus("Mantenha pelo menos um idioma treinado.", "error");
        return;
      }
      state.options.alwaysTrainingLanguageIds = current.filter((id) => id !== language.id);
      markOptionsDirty();
      renderTrainingLanguageChips();
      populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
      populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
    });
    elements.alwaysTrainingLanguageChips.appendChild(chip);
  });

  refreshAddTrainingLanguageSelect();
}

function addSelectedTrainingLanguage() {
  const languageId = String(elements.addTrainingLanguageSelect.value || "").trim();
  if (!languageId || !hasLanguage(languageId)) {
    return;
  }
  const current = getSelectedTrainingLanguages();
  if (current.includes(languageId)) {
    return;
  }
  state.options.alwaysTrainingLanguageIds = [...current, languageId];
  markOptionsDirty();
  renderTrainingLanguageChips();
  populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
  populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
}

function readOptionsFromForm() {
  return normalizeOptions({
    assistantName: String(elements.assistantNameInput.value || "").trim(),
    nativeLanguageId: elements.nativeLanguageSelect.value,
    alwaysTrainingLanguageIds: getSelectedTrainingLanguages(),
    difficultyId: elements.optionsDifficultySelect.value,
    themeId: elements.themeSelect.value,
    translateAssistantReply: Boolean(elements.translateAssistantToggle.checked),
    translationTargetLanguageId: elements.translationTargetLanguageSelect.value,
    showSpeechUnderstood: Boolean(elements.showSpeechUnderstoodToggle.checked),
    showSpeechCorrectness: Boolean(elements.showSpeechCorrectnessToggle.checked),
    translateUserSpeechToNative: Boolean(elements.translateUserSpeechToggle.checked),
    showSpeechUserTranslation: Boolean(elements.showSpeechUserTranslationToggle.checked),
    askTrainingLanguagePerInteraction: true
  });
}

function addChatMessage(container, role, text, translation = "") {
  const wrapper = document.createElement("div");
  wrapper.className = `message-row ${role}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  if (role === "user") {
    meta.textContent = "Você";
  } else if (role === "assistant") {
    meta.textContent = state.options?.assistantName || "SpeakAI";
  } else if (role === "error") {
    meta.textContent = "Sistema";
  } else {
    meta.textContent = "Info";
  }

  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = text;

  if (translation) {
    const translationEl = document.createElement("div");
    translationEl.className = "assistant-translation";
    translationEl.textContent = `Tradução: ${translation}`;
    bubble.appendChild(translationEl);
  }

  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

function renderCorrectionBox(box, correction, emptyText) {
  if (!correction) {
    box.innerHTML = `<p class="placeholder">${escapeHtml(emptyText)}</p>`;
    return;
  }

  const notes = Array.isArray(correction.notes) ? correction.notes : [];
  const notesHtml = notes.length > 0
    ? `<ul class="note-list">${notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p class=\"placeholder\">Sem observações adicionais.</p>";

  box.innerHTML = [
    `<p><strong>Original:</strong> ${escapeHtml(correction.original || "-")}</p>`,
    `<p><strong>Resultado:</strong> ${escapeHtml(correction.corrected || "-")}</p>`,
    notesHtml
  ].join("");
}

function renderSpeechFeedback(feedback) {
  if (!feedback) {
    elements.speechFeedbackBox.innerHTML = "<p class=\"placeholder\">Feedback de fala será exibido aqui.</p>";
    return;
  }

  const lines = [];
  if (state.options.showSpeechUnderstood) {
    lines.push(`<p><strong>IA entendeu:</strong> ${escapeHtml(feedback.understoodText || "-")}</p>`);
  }
  if (state.options.showSpeechCorrectness) {
    lines.push(`<p><strong>Avaliação:</strong> ${escapeHtml(feedback.correctnessMessage || "-")}</p>`);
    lines.push(`<p><strong>Sugestão:</strong> ${escapeHtml(feedback.suggestedText || "-")}</p>`);
  }
  if (state.options.showSpeechUserTranslation && feedback.translatedUserText) {
    lines.push(`<p><strong>Tradução da sua fala:</strong> ${escapeHtml(feedback.translatedUserText)}</p>`);
  }
  if (lines.length === 0) {
    lines.push("<p class=\"placeholder\">Feedback oculto pelas opções atuais.</p>");
  }

  elements.speechFeedbackBox.innerHTML = lines.join("");
}

function setActiveTab(tabId) {
  state.activeTab = tabId;
  const map = {
    text: elements.tabText,
    speech: elements.tabSpeech,
    options: elements.tabOptions
  };

  Object.entries(map).forEach(([id, panel]) => {
    panel.classList.toggle("is-active", id === tabId);
  });

  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabId);
  });
}

function applySidebarCollapsed(collapsed) {
  elements.layoutShell.classList.toggle("sidebar-collapsed", collapsed);
  elements.sidebarToggleButton.title = collapsed ? "Expandir menu lateral" : "Recolher menu lateral";
  elements.sidebarToggleButton.setAttribute("aria-label", elements.sidebarToggleButton.title);
}

function loadSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
}

function persistSidebarCollapsed(collapsed) {
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
}

function getInteractionLanguagePool() {
  const preferred = Array.isArray(state.options?.alwaysTrainingLanguageIds)
    ? state.options.alwaysTrainingLanguageIds
    : [state.config.app.defaultLanguageId];

  const validPreferred = preferred.filter((id) => hasLanguage(id));
  if (validPreferred.length > 0) {
    return validPreferred;
  }
  return state.config.languages.map((item) => item.id);
}

function populateInteractionLanguageSelect(selectElement) {
  const previousValue = String(selectElement.value || "").trim();
  clearChildren(selectElement);
  const pool = getInteractionLanguagePool();

  pool.forEach((languageId) => {
    const language = getLanguageById(languageId);
    selectElement.appendChild(createOption(language.id, language.label));
  });

  if (pool.length === 0) {
    selectElement.value = "";
    return;
  }

  if (pool.includes(previousValue)) {
    selectElement.value = previousValue;
    return;
  }

  if (pool.includes(state.config.app.defaultLanguageId)) {
    selectElement.value = state.config.app.defaultLanguageId;
    return;
  }

  selectElement.value = pool[0];
}

function populateDifficultySelect(selectElement) {
  clearChildren(selectElement);
  state.config.difficultyLevels.forEach((difficulty) => {
    selectElement.appendChild(createOption(difficulty.id, difficulty.label));
  });
}

function populateLanguageSelect(selectElement) {
  clearChildren(selectElement);
  state.config.languages.forEach((language) => {
    selectElement.appendChild(createOption(language.id, language.label));
  });
}

function populateThemeSelect(selectElement) {
  clearChildren(selectElement);
  state.config.themes.options.forEach((theme) => {
    selectElement.appendChild(createOption(theme.id, theme.label));
  });
}

function populateSpeechVoices(trainingLanguageId) {
  clearChildren(elements.speechVoiceSelect);
  const voices = state.config.voices.filter((voice) => {
    const ids = Array.isArray(voice.languageIds) ? voice.languageIds : [];
    return ids.includes(trainingLanguageId);
  });
  const list = voices.length > 0 ? voices : state.config.voices;
  list.forEach((voice) => {
    elements.speechVoiceSelect.appendChild(createOption(voice.id, voice.label));
  });
  elements.speechVoiceSelect.value = state.config.app.defaultVoiceId;
}

function applyOptionsToForm() {
  elements.assistantNameInput.value = state.options.assistantName;
  elements.nativeLanguageSelect.value = state.options.nativeLanguageId;
  elements.translationTargetLanguageSelect.value = state.options.translationTargetLanguageId;
  elements.themeSelect.value = state.options.themeId;
  elements.translateAssistantToggle.checked = state.options.translateAssistantReply;
  elements.translationTargetLanguageSelect.disabled = !state.options.translateAssistantReply;
  elements.showSpeechUnderstoodToggle.checked = state.options.showSpeechUnderstood;
  elements.showSpeechCorrectnessToggle.checked = state.options.showSpeechCorrectness;
  elements.translateUserSpeechToggle.checked = state.options.translateUserSpeechToNative;
  elements.showSpeechUserTranslationToggle.checked = state.options.showSpeechUserTranslation;
  elements.textDifficultySelect.value = state.options.difficultyId;
  elements.speechDifficultySelect.value = state.options.difficultyId;
  elements.optionsDifficultySelect.value = state.options.difficultyId;
  renderTrainingLanguageChips();

  applyTheme(state.options.themeId);
}

function hydrateSelectors() {
  populateDifficultySelect(elements.textDifficultySelect);
  populateDifficultySelect(elements.speechDifficultySelect);
  populateDifficultySelect(elements.optionsDifficultySelect);
  populateLanguageSelect(elements.nativeLanguageSelect);
  populateLanguageSelect(elements.translationTargetLanguageSelect);
  populateThemeSelect(elements.themeSelect);
  populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
  populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
  populateSpeechVoices(state.config.app.defaultLanguageId);
  refreshAddTrainingLanguageSelect();
}

function setSpeechRecordButtonState(isRecording) {
  elements.speechRecordButton.classList.toggle("is-recording", Boolean(isRecording));
  elements.speechRecordButton.title = isRecording ? "Parar gravação" : "Gravar áudio";
  elements.speechRecordButton.setAttribute("aria-label", elements.speechRecordButton.title);
  if (elements.speechRecordLabel) {
    elements.speechRecordLabel.textContent = isRecording ? "Gravando… clique para parar" : "Pressione para gravar";
  }
}

function getCommonPayload(sessionType, interactionLanguageId, difficultyId, history, userText) {
  return {
    sessionType,
    languageId: interactionLanguageId,
    voiceId: sessionType === "speech" ? elements.speechVoiceSelect.value : "",
    modeId: "conversation_with_correction",
    difficultyId,
    assistantName: state.options.assistantName,
    translateAssistantReply: state.options.translateAssistantReply,
    translationTargetLanguageId: state.options.translationTargetLanguageId,
    nativeLanguageId: state.options.nativeLanguageId,
    translateUserSpeechToNative: state.options.translateUserSpeechToNative,
    alwaysTrainingLanguageIds: state.options.alwaysTrainingLanguageIds,
    text: userText,
    history,
    memoryContext: state.memoryContext
  };
}

function requireInteractionLanguage(selectElement) {
  const languageId = String(selectElement.value || "").trim()
    || getInteractionLanguagePool()[0]
    || state.config.app.defaultLanguageId;

  if (!languageId) {
    setStatus("Selecione o idioma treinado para esta interação.", "error");
    return "";
  }

  if (String(selectElement.value || "").trim() !== languageId) {
    selectElement.value = languageId;
  }

  return languageId;
}

async function runSessionTurn({
  sessionKey,
  userText,
  interactionLanguageId,
  difficultyId,
  chatContainer,
  correctionBox,
  sessionType,
  clearInputCallback
}) {
  const session = state.sessions[sessionKey];
  const safeUserText = String(userText || "").trim();
  if (!safeUserText) {
    return;
  }

  session.history.push({ role: "user", text: safeUserText });
  addChatMessage(chatContainer, "user", safeUserText);
  clearInputCallback();

  setBusy(true);
  setStatus("Processando...", "ok");

  try {
    const result = await window.speakAI.processTurn(
      getCommonPayload(sessionType, interactionLanguageId, difficultyId, session.history, safeUserText)
    );

    const assistantText = String(result?.assistantText || "").trim();
    if (!assistantText) {
      throw new Error("Resposta vazia da IA");
    }

    const translatedAssistantText = String(result?.translatedAssistantText || "").trim();
    session.history.push({ role: "assistant", text: assistantText });
    addChatMessage(chatContainer, "assistant", assistantText, translatedAssistantText);

    renderCorrectionBox(
      correctionBox,
      result?.correction || null,
      sessionType === "speech"
        ? "Feedback de fala será exibido aqui."
        : "Correções e observações vão aparecer aqui."
    );

    if (sessionType === "speech") {
      renderSpeechFeedback(result?.speechDiagnostics || null);
      if (result?.audioDataUrl && state.config.ui?.autoPlayAssistantAudio) {
        elements.speechAudioPlayer.src = result.audioDataUrl;
        const playPromise = elements.speechAudioPlayer.play();
        if (playPromise?.catch) {
          playPromise.catch(() => {});
        }
      }
    }

    setStatus("Resposta gerada", "ok");
  } catch (error) {
    addChatMessage(chatContainer, "error", `Erro: ${error.message}`);
    setStatus("Erro na interação", "error");
  } finally {
    setBusy(false);
  }
}

function stopSpeechStreamTracks() {
  if (state.speechRecording.stream) {
    state.speechRecording.stream.getTracks().forEach((track) => track.stop());
    state.speechRecording.stream = null;
  }
}

async function handleSpeechRecordingToggle() {
  if (state.isBusy) {
    return;
  }

  const interactionLanguageId = requireInteractionLanguage(elements.speechInteractionLanguageSelect);
  if (!interactionLanguageId) {
    return;
  }

  if (state.speechRecording.active) {
    state.speechRecording.active = false;
    setSpeechRecordButtonState(false);
    setBusy(true);
    try {
      await new Promise((resolve, reject) => {
        if (!state.speechRecording.recorder) {
          resolve();
          return;
        }

        state.speechRecording.recorder.onstop = async () => {
          try {
            const blob = new Blob(
              state.speechRecording.chunks,
              { type: state.config.ui?.recordingMimeType || "audio/webm" }
            );
            const arrayBuffer = await blob.arrayBuffer();
            const transcriptResult = await window.speakAI.transcribeAudio({
              audioBuffer: arrayBuffer,
              mimeType: blob.type,
              languageId: interactionLanguageId
            });
            const transcript = String(transcriptResult?.text || "").trim();
            if (!transcript) {
              throw new Error("Transcrição vazia");
            }

            if (state.options.showSpeechUnderstood) {
              addChatMessage(elements.speechChatMessages, "info", `IA entendeu da sua fala: ${transcript}`);
            }

            await runSessionTurn({
              sessionKey: "speech",
              userText: transcript,
              interactionLanguageId,
              difficultyId: elements.speechDifficultySelect.value,
              chatContainer: elements.speechChatMessages,
              correctionBox: elements.speechFeedbackBox,
              sessionType: "speech",
              clearInputCallback: () => {}
            });

            resolve();
          } catch (error) {
            addChatMessage(elements.speechChatMessages, "error", `Erro na fala: ${error.message}`);
            setStatus("Erro na conversa por fala", "error");
            reject(error);
          } finally {
            state.speechRecording.chunks = [];
            stopSpeechStreamTracks();
          }
        };

        state.speechRecording.recorder.stop();
      });
    } finally {
      setBusy(false);
    }
    return;
  }

  try {
    state.speechRecording.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = state.config.ui?.recordingMimeType || "audio/webm";
    const supportsPreferred = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(preferredType);
    const options = supportsPreferred ? { mimeType: preferredType } : undefined;
    state.speechRecording.recorder = new MediaRecorder(state.speechRecording.stream, options);
    state.speechRecording.chunks = [];

    state.speechRecording.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.speechRecording.chunks.push(event.data);
      }
    };

    state.speechRecording.recorder.start();
    state.speechRecording.active = true;
    setSpeechRecordButtonState(true);
    setStatus("Gravando...", "ok");
  } catch (error) {
    stopSpeechStreamTracks();
    addChatMessage(elements.speechChatMessages, "error", `Microfone indisponível: ${error.message}`);
    setStatus("Erro ao gravar", "error");
  }
}

async function finalizeConversation(sessionKey, chatContainer, resetTarget) {
  const session = state.sessions[sessionKey];
  if (state.isBusy) {
    return;
  }

  try {
    setBusy(true);
    setStatus("Resumindo conversa...", "ok");
    const summaryResult = await window.speakAI.finalizeConversation({
      history: session.history,
      assistantName: state.options.assistantName
    });

    session.history = [];
    state.memoryContext = String(summaryResult?.memoryContext || "");
    setMemoryBadge(Number(summaryResult?.talkCount || 0));
    chatContainer.innerHTML = "";

    if (sessionKey === "speech") {
      elements.speechAudioPlayer.removeAttribute("src");
      renderSpeechFeedback(null);
    } else {
      renderCorrectionBox(elements.textCorrectionBox, null, "Correções e observações vão aparecer aqui.");
    }

    addChatMessage(chatContainer, "assistant", `${state.options.assistantName} pronto para nova conversa.`);
    setStatus(
      summaryResult?.saved ? `Resumo salvo em ${summaryResult.fileName}` : "Nova conversa iniciada",
      "ok"
    );
    resetTarget();
  } catch (error) {
    setStatus("Erro ao finalizar conversa", "error");
    addChatMessage(chatContainer, "error", `Erro ao finalizar: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function refreshMemorySnapshot() {
  const snapshot = await window.speakAI.getMemorySnapshot();
  state.memoryContext = String(snapshot?.memoryContext || "");
  setMemoryBadge(Number(snapshot?.talkCount || 0));
}

function renderApiKeysState(settings) {
  if (!elements.apiKeysStateText) {
    return;
  }
  elements.apiKeysStateText.textContent = "";
  elements.apiKeysStateText.dataset.hasOpenai = settings?.openaiApiKey ? "1" : "0";
  elements.apiKeysStateText.dataset.hasElevenlabs = settings?.elevenlabsApiKey ? "1" : "0";
}

async function loadApiKeysState() {
  try {
    renderApiKeysState(await window.speakAI.getApiSettings());
  } catch {
    if (elements.apiKeysStateText) {
      elements.apiKeysStateText.textContent = "";
    }
  }
}

async function saveApiKeys() {
  const openaiApiKey = String(elements.openaiApiKeyInput.value || "").trim();
  const elevenlabsApiKey = String(elements.elevenlabsApiKeyInput.value || "").trim();

  if (!openaiApiKey && !elevenlabsApiKey) {
    setStatus("Informe ao menos uma chave para salvar no .env", "error");
    return;
  }

  try {
    setBusy(true);
    const settings = await window.speakAI.saveApiSettings({
      ...(openaiApiKey ? { openaiApiKey } : {}),
      ...(elevenlabsApiKey ? { elevenlabsApiKey } : {})
    });
    elements.openaiApiKeyInput.value = "";
    elements.elevenlabsApiKeyInput.value = "";
    renderApiKeysState(settings);
    setStatus("Chaves salvas", "ok");
    showToast("Chaves de API salvas", "ok");
  } catch (error) {
    setStatus("Erro ao salvar chaves", "error");
    showToast("Erro ao salvar chaves de API", "error");
  } finally {
    setBusy(false);
  }
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
}

/* ── Toast ──────────────────────────────────────────── */
function showToast(message, type = "ok") {
  const container = document.getElementById("toastContainer");
  if (!container) { return; }

  const iconMap = {
    ok:    `<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>`,
    error: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info:  `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${iconMap[type] || iconMap.info}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  };

  const timer = setTimeout(remove, 3200);
  toast.addEventListener("click", () => { clearTimeout(timer); remove(); });
}

/* ── Options dirty state ────────────────────────────── */
function markOptionsDirty() {
  state.optionsDirty = true;
}

function clearOptionsDirty() {
  state.optionsDirty = false;
}

/* ── Unsaved-changes modal ──────────────────────────── */
let _pendingTab = null;

function openUnsavedModal(targetTab) {
  _pendingTab = targetTab;
  const modal = document.getElementById("unsavedModal");
  if (modal) { modal.hidden = false; }
}

function closeUnsavedModal() {
  _pendingTab = null;
  const modal = document.getElementById("unsavedModal");
  if (modal) { modal.hidden = true; }
}

function bindModalEvents() {
  const modal   = document.getElementById("unsavedModal");
  const btnSave = document.getElementById("modalSaveSwitch");
  const btnDiscard = document.getElementById("modalDiscardSwitch");
  const btnCancel  = document.getElementById("modalCancel");

  if (!modal) { return; }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) { closeUnsavedModal(); }
  });

  btnSave.addEventListener("click", () => {
    state.options = readOptionsFromForm();
    persistOptions(state.options);
    applyTheme(state.options.themeId);
    renderTrainingLanguageChips();
    populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
    populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
    clearOptionsDirty();
    showToast("Opções salvas com sucesso", "ok");
    const tab = _pendingTab;
    closeUnsavedModal();
    setActiveTab(tab);
  });

  btnDiscard.addEventListener("click", () => {
    clearOptionsDirty();
    const tab = _pendingTab;
    closeUnsavedModal();
    setActiveTab(tab);
  });

  btnCancel.addEventListener("click", () => {
    closeUnsavedModal();
  });
}

function bindEvents() {
  elements.sidebarToggleButton.addEventListener("click", () => {
    const collapsed = !elements.layoutShell.classList.contains("sidebar-collapsed");
    applySidebarCollapsed(collapsed);
    persistSidebarCollapsed(collapsed);
  });

  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.tab;
      if (state.activeTab === "options" && state.optionsDirty && target !== "options") {
        openUnsavedModal(target);
        return;
      }
      setActiveTab(target);
    });
  });

  elements.reloadConfigButton.addEventListener("click", async () => {
    if (state.isBusy) {
      return;
    }
    try {
      setBusy(true);
      state.config = await window.speakAI.reloadConfig();
      state.options = normalizeOptions(state.options || loadStoredOptions());
      hydrateSelectors();
      applyOptionsToForm();
      await refreshMemorySnapshot();
      await loadApiKeysState();
      setStatus("Configuração recarregada", "ok");
    } catch (error) {
      setStatus(`Erro ao recarregar: ${error.message}`, "error");
    } finally {
      setBusy(false);
    }
  });

  elements.textSendButton.addEventListener("click", async () => {
    const interactionLanguageId = requireInteractionLanguage(elements.textInteractionLanguageSelect);
    if (!interactionLanguageId) {
      return;
    }
    await runSessionTurn({
      sessionKey: "text",
      userText: elements.textInput.value,
      interactionLanguageId,
      difficultyId: elements.textDifficultySelect.value,
      chatContainer: elements.textChatMessages,
      correctionBox: elements.textCorrectionBox,
      sessionType: "text",
      clearInputCallback: () => {
        elements.textInput.value = "";
        elements.textInput.style.height = "auto";
      }
    });
  });

  elements.textInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.textSendButton.click();
    }
  });

  elements.textInput.addEventListener("input", () => {
    autoResizeTextarea(elements.textInput);
  });

  elements.speechTextFallbackInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.speechSendTextButton.click();
    }
  });

  elements.speechTextFallbackInput.addEventListener("input", () => {
    autoResizeTextarea(elements.speechTextFallbackInput);
  });

  elements.textNewConversationButton.addEventListener("click", async () => {
    await finalizeConversation("text", elements.textChatMessages, () => {
      elements.textInput.value = "";
    });
  });

  elements.speechSendTextButton.addEventListener("click", async () => {
    const interactionLanguageId = requireInteractionLanguage(elements.speechInteractionLanguageSelect);
    if (!interactionLanguageId) {
      return;
    }
    await runSessionTurn({
      sessionKey: "speech",
      userText: elements.speechTextFallbackInput.value,
      interactionLanguageId,
      difficultyId: elements.speechDifficultySelect.value,
      chatContainer: elements.speechChatMessages,
      correctionBox: elements.speechFeedbackBox,
      sessionType: "speech",
      clearInputCallback: () => {
        elements.speechTextFallbackInput.value = "";
        elements.speechTextFallbackInput.style.height = "auto";
      }
    });
  });

  elements.speechRecordButton.addEventListener("click", () => {
    handleSpeechRecordingToggle();
  });

  elements.speechNewConversationButton.addEventListener("click", async () => {
    await finalizeConversation("speech", elements.speechChatMessages, () => {
      elements.speechTextFallbackInput.value = "";
    });
  });

  elements.speechInteractionLanguageSelect.addEventListener("change", () => {
    const interactionLanguageId = String(elements.speechInteractionLanguageSelect.value || "").trim();
    if (interactionLanguageId) {
      populateSpeechVoices(interactionLanguageId);
    }
  });

  const syncDifficulty = (value) => {
    elements.textDifficultySelect.value = value;
    elements.speechDifficultySelect.value = value;
    elements.optionsDifficultySelect.value = value;
  };

  elements.textDifficultySelect.addEventListener("change", () => {
    syncDifficulty(elements.textDifficultySelect.value);
  });

  elements.speechDifficultySelect.addEventListener("change", () => {
    syncDifficulty(elements.speechDifficultySelect.value);
  });

  elements.optionsDifficultySelect.addEventListener("change", () => {
    syncDifficulty(elements.optionsDifficultySelect.value);
  });

  elements.themeSelect.addEventListener("change", () => {
    applyTheme(elements.themeSelect.value);
  });

  elements.translateAssistantToggle.addEventListener("change", () => {
    elements.translationTargetLanguageSelect.disabled = !elements.translateAssistantToggle.checked;
  });

  elements.addTrainingLanguageButton.addEventListener("click", () => {
    addSelectedTrainingLanguage();
  });

  elements.saveOptionsButton.addEventListener("click", () => {
    state.options = readOptionsFromForm();
    persistOptions(state.options);
    applyTheme(state.options.themeId);
    renderTrainingLanguageChips();
    populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
    populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
    clearOptionsDirty();
    setStatus("Opções salvas", "ok");
    showToast("Opções salvas com sucesso", "ok");
  });

  elements.saveApiKeysButton.addEventListener("click", () => {
    saveApiKeys();
  });

  /* ── Options dirty listeners ──────────────────────── */
  const dirtyWatchers = [
    elements.assistantNameInput,
    elements.nativeLanguageSelect,
    elements.themeSelect,
    elements.optionsDifficultySelect,
    elements.translateAssistantToggle,
    elements.translationTargetLanguageSelect,
    elements.showSpeechUnderstoodToggle,
    elements.showSpeechCorrectnessToggle,
    elements.translateUserSpeechToggle,
    elements.showSpeechUserTranslationToggle
  ];

  dirtyWatchers.forEach((el) => {
    if (!el) { return; }
    el.addEventListener("change", markOptionsDirty);
    el.addEventListener("input", markOptionsDirty);
  });

  bindModalEvents();
}

async function init() {
  try {
    setStatus("Carregando...", "ok");
    state.config = await window.speakAI.getConfig();
    state.options = loadStoredOptions();
    hydrateSelectors();
    applyOptionsToForm();
    bindEvents();
    applySidebarCollapsed(loadSidebarCollapsed());
    await refreshMemorySnapshot();
    await loadApiKeysState();

    addChatMessage(
      elements.textChatMessages,
      "assistant",
      `Hi! I am ${state.options.assistantName}. Vamos iniciar seu treino gramatical.`
    );
    addChatMessage(
      elements.speechChatMessages,
      "assistant",
      `Hi! I am ${state.options.assistantName}. Selecione o idioma e grave sua fala.`
    );

    renderCorrectionBox(elements.textCorrectionBox, null, "Correções e observações vão aparecer aqui.");
    renderSpeechFeedback(null);
    setSpeechRecordButtonState(false);
    setStatus("Pronto", "ok");
  } catch (error) {
    setStatus(`Falha na inicialização: ${error.message}`, "error");
    addChatMessage(elements.textChatMessages, "error", `Falha: ${error.message}`);
  }
}

window.addEventListener("beforeunload", () => {
  if (state.sessions.text.history.length > 1) {
    window.speakAI.finalizeConversation({
      history: state.sessions.text.history,
      assistantName: state.options?.assistantName || state.config?.app?.defaultAssistantName || "SpeakAI"
    }).catch(() => {});
  }

  if (state.sessions.speech.history.length > 1) {
    window.speakAI.finalizeConversation({
      history: state.sessions.speech.history,
      assistantName: state.options?.assistantName || state.config?.app?.defaultAssistantName || "SpeakAI"
    }).catch(() => {});
  }
});

init();
