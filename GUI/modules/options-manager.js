// ─── options-manager.js ───────────────────────────────────────────────────────
// Gerencia configuração, opções do usuário, seletores e chips de idioma.
// Dependências: app-state.js, ui-utils.js

// ─── Validadores de config ────────────────────────────────────────────────────

function hasLanguage(languageId) {
  return state.config.languages.some((item) => item.id === languageId);
}

function hasDifficulty(difficultyId) {
  return state.config.difficultyLevels.some((item) => item.id === difficultyId);
}

function hasTheme(themeId) {
  return state.config.themes.options.some((item) => item.id === themeId);
}

// Verifica se existe tradução de UI completa para o idioma
function hasAppLanguage(langId) {
  return typeof TRANSLATIONS !== "undefined" && Boolean(TRANSLATIONS[langId]);
}

// Detecta o idioma do sistema operacional e retorna o id mais próximo disponível
function detectDeviceLanguageId() {
  const availableIds = state.config.languages.map((l) => l.id);
  const candidates = Array.from(navigator.languages || [navigator.language || ""]).filter(Boolean);
  for (const lang of candidates) {
    if (availableIds.includes(lang)) return lang;
    const prefix = lang.split("-")[0];
    const match = availableIds.find((id) => id.split("-")[0] === prefix);
    if (match) return match;
  }
  return availableIds[0] || "en-US";
}

function getLanguageById(languageId) {
  return state.config.languages.find((item) => item.id === languageId)
    || state.config.languages.find((item) => item.id === state.config.app.defaultLanguageId)
    || state.config.languages[0];
}

const SIDEBAR_LOGO_LIGHT_SRC = "../assets/without_background/logo_sem_fundo.png";
const SIDEBAR_LOGO_DARK_SRC  = "../assets/without_background/logo_sem_fundo_darkMode.png";

// Aplica os tokens CSS do tema selecionado no :root do documento
function applyTheme(themeId) {
  const theme = state.config.themes.options.find((item) => item.id === themeId)
    || state.config.themes.options.find((item) => item.id === state.config.app.defaultThemeId)
    || state.config.themes.options[0];
  if (!theme?.tokens) { return; }
  Object.entries(theme.tokens).forEach(([token, value]) => {
    document.documentElement.style.setProperty(token, value);
  });
  document.documentElement.setAttribute("data-theme-id", theme.id);

  if (elements.sidebarBrandLogo) {
    elements.sidebarBrandLogo.src = theme.id === "night" ? SIDEBAR_LOGO_DARK_SRC : SIDEBAR_LOGO_LIGHT_SRC;
  }
}

// ─── Opções padrão e normalização ────────────────────────────────────────────

// Retorna as opções padrão detectando o idioma do SO.
// Usado apenas quando não há opções salvas em localStorage.
function getDefaultOptionsFromConfig() {
  const detectedId = detectDeviceLanguageId();
  // appLanguageId só pode ser um idioma que tenha tradução de UI completa
  const detectedAppLangId = hasAppLanguage(detectedId) ? detectedId : "en-US";
  return {
    assistantName:               String(state.config.app.defaultAssistantName || state.config.app.name || "SpeakAI"),
    nativeLanguageId:            detectedId,
    appLanguageId:               detectedAppLangId,
    alwaysTrainingLanguageIds:   [state.config.app.defaultLanguageId],
    difficultyId:                state.config.app.defaultDifficultyId,
    themeId:                     state.config.app.defaultThemeId,
    translateAssistantReply:     Boolean(state.config.translation.defaultEnabled),
    translationTargetLanguageId: detectedId,
    showSpeechUnderstood:        true,
    showSpeechCorrectness:       true,
    translateUserSpeechToNative: true,
    showSpeechUserTranslation:   true,
    debugMode:                   false,
    askTrainingLanguagePerInteraction: true
  };
}

// Garante que todas as opções são válidas; preenche com defaults o que faltar
function normalizeOptions(raw) {
  const defaults = getDefaultOptionsFromConfig();
  const source   = raw && typeof raw === "object" ? raw : {};

  const alwaysTrainingLanguageIds = Array.isArray(source.alwaysTrainingLanguageIds)
    ? source.alwaysTrainingLanguageIds.filter((id) => hasLanguage(id))
    : defaults.alwaysTrainingLanguageIds;

  return {
    ...defaults,
    ...source,
    assistantName:               String(source.assistantName || defaults.assistantName).trim() || defaults.assistantName,
    nativeLanguageId:            hasLanguage(source.nativeLanguageId)     ? source.nativeLanguageId     : defaults.nativeLanguageId,
    appLanguageId:               hasAppLanguage(source.appLanguageId)     ? source.appLanguageId         : defaults.appLanguageId,
    alwaysTrainingLanguageIds:   alwaysTrainingLanguageIds.length > 0     ? alwaysTrainingLanguageIds    : defaults.alwaysTrainingLanguageIds,
    difficultyId:                hasDifficulty(source.difficultyId)       ? source.difficultyId          : defaults.difficultyId,
    themeId:                     hasTheme(source.themeId)                 ? source.themeId               : defaults.themeId,
    translationTargetLanguageId: hasLanguage(source.translationTargetLanguageId) ? source.translationTargetLanguageId : defaults.translationTargetLanguageId,
    translateAssistantReply:     Boolean(source.translateAssistantReply     ?? defaults.translateAssistantReply),
    showSpeechUnderstood:        Boolean(source.showSpeechUnderstood        ?? defaults.showSpeechUnderstood),
    showSpeechCorrectness:       true,
    translateUserSpeechToNative: true,
    showSpeechUserTranslation:   true,
    debugMode:                   Boolean(source.debugMode ?? defaults.debugMode),
    askTrainingLanguagePerInteraction: true
  };
}

function loadStoredOptions() {
  const raw = localStorage.getItem(USER_OPTIONS_STORAGE_KEY);
  if (!raw) { return normalizeOptions({}); }
  try {
    return normalizeOptions(JSON.parse(raw));
  } catch {
    return normalizeOptions({});
  }
}

function persistOptions(options) {
  localStorage.setItem(USER_OPTIONS_STORAGE_KEY, JSON.stringify(options));
}

// ─── Seletores e formulário ───────────────────────────────────────────────────

function getCountryCodeByLanguageId(languageId) {
  const suffix = String(languageId || "").split("-")[1] || "";
  return suffix.length === 2 ? suffix.toUpperCase() : "";
}

function getSelectedTrainingLanguages() {
  const raw   = Array.isArray(state.options?.alwaysTrainingLanguageIds) ? state.options.alwaysTrainingLanguageIds : [];
  const valid = raw.filter((id) => hasLanguage(id));
  return valid.length > 0 ? valid : [state.config.app.defaultLanguageId];
}

// Atualiza o <select> de adição de idioma, excluindo os já selecionados
function refreshAddTrainingLanguageSelect() {
  clearChildren(elements.addTrainingLanguageSelect);
  const selected  = new Set(getSelectedTrainingLanguages());
  const available = state.config.languages.filter((lang) => !selected.has(lang.id));

  if (available.length === 0) {
    elements.addTrainingLanguageSelect.appendChild(createOption("", "Todos adicionados"));
    elements.addTrainingLanguageSelect.disabled = true;
    elements.addTrainingLanguageButton.disabled = true;
    return;
  }

  elements.addTrainingLanguageSelect.appendChild(createOption("", "Adicionar idioma"));
  available.forEach((lang) => elements.addTrainingLanguageSelect.appendChild(createOption(lang.id, lang.label)));
  elements.addTrainingLanguageSelect.value   = available[0].id;
  elements.addTrainingLanguageSelect.disabled = false;
  elements.addTrainingLanguageButton.disabled = false;
}

// Renderiza os chips de bandeira dos idiomas de treino selecionados
function renderTrainingLanguageChips() {
  clearChildren(elements.alwaysTrainingLanguageChips);
  const selected = getSelectedTrainingLanguages();

  selected.forEach((languageId) => {
    const language    = getLanguageById(languageId);
    const chip        = document.createElement("button");
    chip.type         = "button";
    chip.className    = "lang-chip";
    chip.title        = language.label;
    chip.setAttribute("aria-label", `${language.label}. Clique para remover.`);
    chip.dataset.languageId = language.id;

    const countryCode = getCountryCodeByLanguageId(language.id).toLowerCase();
    chip.innerHTML = countryCode
      ? `<span class="fi fi-${countryCode} lang-chip-flag"></span>`
      : `<span class="lang-chip-code">${language.id.slice(0, 2).toUpperCase()}</span>`;

    chip.addEventListener("click", () => {
      const current = getSelectedTrainingLanguages();
      if (current.length <= 1) { setStatus("Mantenha pelo menos um idioma treinado.", "error"); return; }
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
  if (!languageId || !hasLanguage(languageId)) { return; }
  const current = getSelectedTrainingLanguages();
  if (current.includes(languageId)) { return; }
  state.options.alwaysTrainingLanguageIds = [...current, languageId];
  markOptionsDirty();
  renderTrainingLanguageChips();
  populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
  populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
}

// Lê os valores atuais do formulário de opções e retorna opções normalizadas
function readOptionsFromForm() {
  return normalizeOptions({
    assistantName:               String(elements.assistantNameInput.value || "").trim(),
    nativeLanguageId:            elements.nativeLanguageSelect.value,
    appLanguageId:               elements.appLanguageSelect ? elements.appLanguageSelect.value : state.options.appLanguageId,
    alwaysTrainingLanguageIds:   getSelectedTrainingLanguages(),
    difficultyId:                elements.optionsDifficultySelect.value,
    themeId:                     elements.themeSelect.value,
    translateAssistantReply:     Boolean(elements.translateAssistantToggle.checked),
    translationTargetLanguageId: elements.translationTargetLanguageSelect.value,
    showSpeechUnderstood:        Boolean(elements.showSpeechUnderstoodToggle.checked),
    showSpeechCorrectness:       true,
    translateUserSpeechToNative: true,
    showSpeechUserTranslation:   true,
    debugMode:                   Boolean(elements.debugModeToggle?.checked),
    askTrainingLanguagePerInteraction: true
  });
}

// Aplica as opções salvas nos controles do formulário e atualiza tema e idioma
function applyOptionsToForm() {
  elements.assistantNameInput.value                       = state.options.assistantName;
  elements.nativeLanguageSelect.value                     = state.options.nativeLanguageId;
  elements.translationTargetLanguageSelect.value          = state.options.translationTargetLanguageId;
  elements.themeSelect.value                              = state.options.themeId;
  elements.translateAssistantToggle.checked               = state.options.translateAssistantReply;
  elements.translationTargetLanguageSelect.disabled       = !state.options.translateAssistantReply;
  elements.showSpeechUnderstoodToggle.checked             = state.options.showSpeechUnderstood;
  if (elements.debugModeToggle) { elements.debugModeToggle.checked = Boolean(state.options.debugMode); }
  elements.textDifficultySelect.value                     = state.options.difficultyId;
  elements.speechDifficultySelect.value                   = state.options.difficultyId;
  elements.optionsDifficultySelect.value                  = state.options.difficultyId;
  renderTrainingLanguageChips();
  if (elements.appLanguageSelect) { elements.appLanguageSelect.value = state.options.appLanguageId; }
  applyTheme(state.options.themeId);
  applyUiLanguage(state.options.appLanguageId);
  if (window.speakAI?.setDebugMode) {
    window.speakAI.setDebugMode({ enabled: Boolean(state.options.debugMode) }).catch(() => {});
  }
}

// ─── Populate functions ───────────────────────────────────────────────────────

function getInteractionLanguagePool() {
  const preferred = Array.isArray(state.options?.alwaysTrainingLanguageIds)
    ? state.options.alwaysTrainingLanguageIds
    : [state.config.app.defaultLanguageId];
  const validPreferred = preferred.filter((id) => hasLanguage(id));
  return validPreferred.length > 0 ? validPreferred : state.config.languages.map((item) => item.id);
}

function populateInteractionLanguageSelect(selectElement) {
  const previousValue = String(selectElement.value || "").trim();
  clearChildren(selectElement);
  const pool = getInteractionLanguagePool();
  pool.forEach((languageId) => {
    const language = getLanguageById(languageId);
    selectElement.appendChild(createOption(language.id, language.label));
  });
  if (pool.length === 0)                              { selectElement.value = "";      return; }
  if (pool.includes(previousValue))                   { selectElement.value = previousValue; return; }
  if (pool.includes(state.config.app.defaultLanguageId)) { selectElement.value = state.config.app.defaultLanguageId; return; }
  selectElement.value = pool[0];
}

function populateDifficultySelect(selectElement) {
  clearChildren(selectElement);
  state.config.difficultyLevels.forEach((d) => selectElement.appendChild(createOption(d.id, d.label)));
}

function populateLanguageSelect(selectElement) {
  clearChildren(selectElement);
  state.config.languages.forEach((l) => selectElement.appendChild(createOption(l.id, l.label)));
}

function populateThemeSelect(selectElement) {
  clearChildren(selectElement);
  state.config.themes.options.forEach((t) => selectElement.appendChild(createOption(t.id, t.label)));
}

// Preenche o seletor de idioma do app filtrando apenas idiomas com tradução de UI
// (nem todos os 30 idiomas de treino têm tradução completa da interface)
function populateAppLanguageSelect() {
  if (!elements.appLanguageSelect) { return; }
  clearChildren(elements.appLanguageSelect);
  state.config.languages
    .filter((lang) => hasAppLanguage(lang.id))
    .forEach((lang) => elements.appLanguageSelect.appendChild(createOption(lang.id, lang.label)));
}

function populateSpeechVoices(trainingLanguageId) {
  const currentValue = String(elements.speechVoiceSelect.value || "").trim();
  clearChildren(elements.speechVoiceSelect);
  const voices = state.config.voices.filter((voice) => {
    const ids = Array.isArray(voice.languageIds) ? voice.languageIds : [];
    return ids.includes(trainingLanguageId);
  });
  const list = voices.length > 0 ? voices : state.config.voices;
  list.forEach((voice) => elements.speechVoiceSelect.appendChild(createOption(voice.id, voice.label)));
  const defaultVoiceId = String(state.config.app.defaultVoiceId || "").trim();
  const preferredVoiceId = [currentValue, defaultVoiceId].find((voiceId) =>
    list.some((voice) => voice.id === voiceId)
  );
  elements.speechVoiceSelect.value = preferredVoiceId || String(list[0]?.id || "");
}

// Popula todos os seletores na inicialização (ou após reload de config)
function hydrateSelectors() {
  populateDifficultySelect(elements.textDifficultySelect);
  populateDifficultySelect(elements.speechDifficultySelect);
  populateDifficultySelect(elements.optionsDifficultySelect);
  populateLanguageSelect(elements.nativeLanguageSelect);
  populateLanguageSelect(elements.translationTargetLanguageSelect);
  populateThemeSelect(elements.themeSelect);
  populateAppLanguageSelect();
  populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
  populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
  const speechInteractionLanguageId = String(elements.speechInteractionLanguageSelect.value || state.config.app.defaultLanguageId).trim();
  populateSpeechVoices(speechInteractionLanguageId || state.config.app.defaultLanguageId);
  refreshAddTrainingLanguageSelect();
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

let _apiKeysExist = { openai: false, elevenlabs: false };

function renderApiKeysState(settings) {
  const hasOpenai     = Boolean(settings?.openaiApiKey);
  const hasElevenlabs = Boolean(settings?.elevenlabsApiKey);

  _apiKeysExist = { openai: hasOpenai, elevenlabs: hasElevenlabs };

  const openaiStatus     = document.getElementById("openaiKeyStatus");
  const elevenlabsStatus = document.getElementById("elevenlabsKeyStatus");
  if (openaiStatus)     { openaiStatus.hidden     = !hasOpenai; }
  if (elevenlabsStatus) { elevenlabsStatus.hidden = !hasElevenlabs; }

  if (elements.openaiApiKeyInput) {
    elements.openaiApiKeyInput.placeholder = hasOpenai ? "Nova chave (substituirá a atual)" : "sk-...";
  }
  if (elements.elevenlabsApiKeyInput) {
    elements.elevenlabsApiKeyInput.placeholder = hasElevenlabs ? "Nova chave (substituirá a atual)" : "...";
  }
}

async function loadApiKeysState() {
  try {
    renderApiKeysState(await window.speakAI.getApiSettings());
  } catch { /* falha silenciosa */ }
}

async function _doSaveApiKeys(openaiApiKey, elevenlabsApiKey) {
  try {
    setBusy(true);
    const settings = await window.speakAI.saveApiSettings({
      ...(openaiApiKey     ? { openaiApiKey }     : {}),
      ...(elevenlabsApiKey ? { elevenlabsApiKey } : {})
    });
    elements.openaiApiKeyInput.value     = "";
    elements.elevenlabsApiKeyInput.value = "";
    renderApiKeysState(settings);
    setStatus(tr("toastKeysSaved"), "ok");
    showToast(tr("toastKeysSaved"), "ok");
  } catch {
    setStatus(tr("toastKeysError"), "error");
    showToast(tr("toastKeysError"), "error");
  } finally {
    setBusy(false);
  }
}

function openApiKeyOverwriteModal(onConfirm) {
  const modal   = document.getElementById("apiKeyOverwriteModal");
  const confirm = document.getElementById("apiKeyOverwriteConfirm");
  const cancel  = document.getElementById("apiKeyOverwriteCancel");

  if (!modal) { onConfirm(); return; }
  modal.hidden = false;

  function cleanup() {
    modal.hidden = true;
    confirm.removeEventListener("click", handleConfirm);
    cancel.removeEventListener("click",  handleCancel);
    modal.removeEventListener("click",   handleOverlay);
  }
  function handleConfirm()  { cleanup(); onConfirm(); }
  function handleCancel()   { cleanup(); }
  function handleOverlay(e) { if (e.target === modal) { cleanup(); } }

  confirm.addEventListener("click", handleConfirm);
  cancel.addEventListener("click",  handleCancel);
  modal.addEventListener("click",   handleOverlay);
}

async function saveApiKeys() {
  const openaiApiKey     = String(elements.openaiApiKeyInput.value     || "").trim();
  const elevenlabsApiKey = String(elements.elevenlabsApiKeyInput.value || "").trim();

  if (!openaiApiKey && !elevenlabsApiKey) {
    setStatus("Informe ao menos uma chave para salvar no .env", "error");
    return;
  }

  const willOverwrite = (openaiApiKey && _apiKeysExist.openai) || (elevenlabsApiKey && _apiKeysExist.elevenlabs);

  if (willOverwrite) {
    openApiKeyOverwriteModal(() => _doSaveApiKeys(openaiApiKey, elevenlabsApiKey));
    return;
  }

  await _doSaveApiKeys(openaiApiKey, elevenlabsApiKey);
}
