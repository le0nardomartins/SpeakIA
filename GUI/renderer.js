// ─── renderer.js ─────────────────────────────────────────────────────────────
// Ponto de entrada da aplicação: conecta eventos e inicializa a UI.
// Carregado por último — depende de todos os outros módulos do GUI/.
// Ordem de carregamento: translations.js → app-state.js → ui-utils.js
//                        → options-manager.js → chat-session.js → renderer.js

// Conecta os botões do modal de alterações não salvas (salvar/descartar/cancelar)
class TechParticleField {
  constructor(layerElement) {
    this.layerElement = layerElement;
    this.particles = [];
  }

  shouldReduceMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  resolveParticleCount() {
    if (this.shouldReduceMotion()) {
      return 0;
    }
    const cores = Number(navigator.hardwareConcurrency || 6);
    if (cores <= 4) {
      return 10;
    }
    return 18;
  }

  createParticle(index) {
    const particle = document.createElement("span");
    particle.className = "o-tech-particle";

    const size = 2 + Math.random() * 3.5;
    const startX = Math.random() * 100;
    const drift = -20 + Math.random() * 40;
    const duration = 14 + Math.random() * 22;
    const delay = -Math.random() * duration;
    const alpha = 0.22 + Math.random() * 0.45;

    particle.style.setProperty("--p-size", `${size}px`);
    particle.style.setProperty("--p-start-x", `${startX}%`);
    particle.style.setProperty("--p-drift-x", `${drift}px`);
    particle.style.setProperty("--p-duration", `${duration}s`);
    particle.style.setProperty("--p-delay", `${delay}s`);
    particle.style.setProperty("--p-alpha", `${alpha.toFixed(3)}`);
    particle.style.setProperty("--p-index", String(index));
    return particle;
  }

  mount() {
    if (!this.layerElement) {
      return;
    }
    const count = this.resolveParticleCount();
    if (count <= 0) {
      this.layerElement.setAttribute("data-reduced-motion", "1");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const particle = this.createParticle(i);
      this.particles.push(particle);
      fragment.appendChild(particle);
    }

    this.layerElement.appendChild(fragment);
  }
}

class AppCloseLifecycleManager {
  constructor() {
    this.closeRequested = false;
    this.finalized = false;
  }

  bind() {
    if (!window.speakAI?.onAppCloseRequested) {
      return;
    }

    window.speakAI.onAppCloseRequested(() => {
      this.handleCloseRequest();
    });
  }

  async handleCloseRequest() {
    if (this.closeRequested) {
      return;
    }
    this.closeRequested = true;
    state.shutdown.closeRequested = true;

    this.stopActiveRecordingIfNeeded();

    if (this.hasActiveBackgroundTasks()) {
      setStatus("Encerramento solicitado, finalizando processo em segundo plano...", "ok");
      showToast("Aguarde: finalizando processamento antes de encerrar.", "info");
      await this.waitUntilIdle();
      showToast("Processamento concluído. Encerrando aplicação...", "ok");
    }

    await this.finalizeSessionsIfNeeded();
    this.finalized = true;
    state.shutdown.finalizationCompleted = true;
    window.speakAI.sendAppCloseResponse({ canClose: true });
  }

  hasActiveBackgroundTasks() {
    return Boolean(state.isBusy);
  }

  stopActiveRecordingIfNeeded() {
    if (!state.speechRecording?.active) {
      return;
    }

    state.speechRecording.active = false;
    const recorder = state.speechRecording.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try { recorder.stop(); } catch {}
    }
    state.speechRecording.recorder = null;
    state.speechRecording.chunks = [];

    if (state.speechRecording.stream) {
      state.speechRecording.stream.getTracks().forEach((track) => track.stop());
      state.speechRecording.stream = null;
    }

    if (typeof setSpeechRecordButtonState === "function") {
      setSpeechRecordButtonState(false);
    }
  }

  async waitUntilIdle() {
    while (this.hasActiveBackgroundTasks()) {
      await new Promise((resolve) => setTimeout(resolve, 240));
    }
  }

  async finalizeSessionsIfNeeded() {
    const assistantName = state.options?.assistantName || state.config?.app?.defaultAssistantName || "SpeakAI";
    const tasks = [];

    if (Array.isArray(state.sessions?.text?.history) && state.sessions.text.history.length > 1) {
      tasks.push(window.speakAI.finalizeConversation({
        history: state.sessions.text.history,
        assistantName
      }));
    }

    if (Array.isArray(state.sessions?.speech?.history) && state.sessions.speech.history.length > 1) {
      tasks.push(window.speakAI.finalizeConversation({
        history: state.sessions.speech.history,
        assistantName
      }));
    }

    if (tasks.length === 0) {
      return;
    }

    setStatus("Salvando sessões antes de encerrar...", "ok");
    showToast("Salvando sessões antes de encerrar...", "info");
    await Promise.allSettled(tasks);
  }
}

let techParticleField = null;
let closeLifecycleManager = null;

function bindModalEvents() {
  const modal      = document.getElementById("unsavedModal");
  const btnSave    = document.getElementById("modalSaveSwitch");
  const btnDiscard = document.getElementById("modalDiscardSwitch");
  const btnCancel  = document.getElementById("modalCancel");

  if (!modal) { return; }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) { closeUnsavedModal(); }
  });

  btnSave.addEventListener("click", () => {
    state.options = readOptionsFromForm();
    persistOptions(state.options);
    window.speakAI.setDebugMode({ enabled: Boolean(state.options.debugMode) }).catch(() => {});
    window.speakAI.debugLog({
      indicator: "OPTIONS_SAVE",
      data: { debugMode: Boolean(state.options.debugMode), source: "unsaved-modal" }
    });
    applyTheme(state.options.themeId);
    renderTrainingLanguageChips();
    populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
    populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
    clearOptionsDirty();
    applyUiLanguage(state.options.appLanguageId);
    showToast(tr("toastOptionsSaved"), "ok");
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

// ─── Histórico de conversas ───────────────────────────────────────────────────
async function openHistoryModal() {
  const modal = document.getElementById("historyModal");
  const list  = document.getElementById("historyModalList");
  if (!modal || !list) { return; }

  modal.hidden = false;
  list.innerHTML = `<p class="history-empty">Carregando...</p>`;

  try {
    const convs = await window.speakAI.listConversations();
    if (!convs || convs.length === 0) {
      list.innerHTML = `<p class="history-empty">Nenhum histórico salvo ainda.</p>`;
      return;
    }
    list.innerHTML = "";
    convs.slice().reverse().forEach((conv) => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `
        <div class="history-item-header">
          <span class="history-item-num">Conversa #${conv.talkNumber}</span>
          <span class="history-item-file">${escapeHtml(conv.fileName)}</span>
        </div>
        <p class="history-item-preview">${escapeHtml(conv.preview)}</p>
      `;
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = `<p class="history-empty">Erro ao carregar histórico.</p>`;
  }
}

function closeHistoryModal() {
  const modal = document.getElementById("historyModal");
  if (modal) { modal.hidden = true; }
}

// ─── Player de áudio customizado ─────────────────────────────────────────────
function initCustomAudioPlayer() {
  const audio   = elements.speechAudioPlayer;
  const playBtn = document.getElementById("capPlayBtn");
  const barFill = document.getElementById("capBarFill");
  const seek    = document.getElementById("capSeek");
  const curTime = document.getElementById("capCurrentTime");
  const durEl   = document.getElementById("capDuration");
  const volBtn  = document.getElementById("capVolumeBtn");

  if (!audio || !playBtn) { return; }

  const playIcon  = playBtn.querySelector(".cap-icon-play");
  const pauseIcon = playBtn.querySelector(".cap-icon-pause");

  function fmt(s) {
    if (!isFinite(s) || s < 0) { return "--:--"; }
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function syncPlayState() {
    const playing = !audio.paused && !audio.ended;
    if (playIcon)  { playIcon.style.display  = playing ? "none" : ""; }
    if (pauseIcon) { pauseIcon.style.display = playing ? "" : "none"; }
  }

  function syncProgress() {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    if (barFill) { barFill.style.width = `${pct}%`; }
    if (seek)    { seek.value = pct; }
    if (curTime) { curTime.textContent = fmt(audio.currentTime); }
  }

  audio.addEventListener("loadedmetadata", () => {
    if (durEl)   { durEl.textContent = fmt(audio.duration); }
    if (playBtn) { playBtn.disabled = false; }
    syncProgress();
  });

  audio.addEventListener("timeupdate", syncProgress);
  audio.addEventListener("play",       syncPlayState);
  audio.addEventListener("pause",      syncPlayState);
  audio.addEventListener("ended", () => { syncPlayState(); syncProgress(); });

  audio.addEventListener("emptied", () => {
    if (playBtn) { playBtn.disabled = true; }
    if (barFill) { barFill.style.width = "0%"; }
    if (seek)    { seek.value = 0; }
    if (curTime) { curTime.textContent = "0:00"; }
    if (durEl)   { durEl.textContent = "--:--"; }
    syncPlayState();
  });

  playBtn.addEventListener("click", () => {
    if (audio.paused) { audio.play().catch(() => {}); }
    else              { audio.pause(); }
  });

  if (seek) {
    seek.addEventListener("input", () => {
      const t = (parseFloat(seek.value) / 100) * (audio.duration || 0);
      audio.currentTime = t;
    });
  }

  if (volBtn) {
    volBtn.addEventListener("click", () => {
      audio.muted = !audio.muted;
      volBtn.classList.toggle("is-muted", audio.muted);
      volBtn.title = audio.muted ? "Ativar som" : "Silenciar";
    });
  }
}

// ─── Ligação de eventos ───────────────────────────────────────────────────────
// Todos os addEventListener ficam aqui; mantém a lógica separada da renderização
function bindEvents() {
  elements.sidebarToggleButton.addEventListener("click", () => {
    const collapsed = !elements.layoutShell.classList.contains("sidebar-collapsed");
    applySidebarCollapsed(collapsed);
    persistSidebarCollapsed(collapsed);
  });

  if (elements.sidebarRepoLinkButton) {
    elements.sidebarRepoLinkButton.addEventListener("click", async () => {
      try {
        await window.speakAI.openExternalUrl({ url: "https://github.com/le0nardomartins/SpeakIA" });
      } catch {
        setStatus("Não foi possível abrir o repositório.", "error");
      }
    });
  }

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
    if (state.isBusy) { return; }
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
    if (!interactionLanguageId) { return; }
    await runSessionTurn({
      sessionKey:            "text",
      userText:              elements.textInput.value,
      interactionLanguageId,
      difficultyId:          elements.textDifficultySelect.value,
      chatContainer:         elements.textChatMessages,
      correctionBox:         elements.textCorrectionBox,
      sessionType:           "text",
      clearInputCallback:    () => {
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
    if (!interactionLanguageId) { return; }
    await runSessionTurn({
      sessionKey:            "speech",
      userText:              elements.speechTextFallbackInput.value,
      interactionLanguageId,
      difficultyId:          elements.speechDifficultySelect.value,
      chatContainer:         elements.speechChatMessages,
      correctionBox:         elements.speechFeedbackBox,
      sessionType:           "speech",
      clearInputCallback:    () => {
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
    if (interactionLanguageId) { populateSpeechVoices(interactionLanguageId); }
  });

  // Sincroniza o seletor de dificuldade entre as três abas
  const syncDifficulty = (value) => {
    elements.textDifficultySelect.value   = value;
    elements.speechDifficultySelect.value = value;
    elements.optionsDifficultySelect.value = value;
  };
  elements.textDifficultySelect.addEventListener("change",    () => syncDifficulty(elements.textDifficultySelect.value));
  elements.speechDifficultySelect.addEventListener("change",  () => syncDifficulty(elements.speechDifficultySelect.value));
  elements.optionsDifficultySelect.addEventListener("change", () => syncDifficulty(elements.optionsDifficultySelect.value));

  elements.themeSelect.addEventListener("change", () => {
    applyTheme(elements.themeSelect.value);
  });

  if (elements.appLanguageSelect) {
    elements.appLanguageSelect.addEventListener("change", () => {
      applyUiLanguage(elements.appLanguageSelect.value);
      markOptionsDirty();
    });
  }

  elements.translateAssistantToggle.addEventListener("change", () => {
    elements.translationTargetLanguageSelect.disabled = !elements.translateAssistantToggle.checked;
  });

  elements.addTrainingLanguageButton.addEventListener("click", () => {
    addSelectedTrainingLanguage();
  });

  elements.saveOptionsButton.addEventListener("click", () => {
    state.options = readOptionsFromForm();
    persistOptions(state.options);
    window.speakAI.setDebugMode({ enabled: Boolean(state.options.debugMode) }).catch(() => {});
    window.speakAI.debugLog({
      indicator: "OPTIONS_SAVE",
      data: { debugMode: Boolean(state.options.debugMode), source: "options-button" }
    });
    applyTheme(state.options.themeId);
    renderTrainingLanguageChips();
    populateInteractionLanguageSelect(elements.textInteractionLanguageSelect);
    populateInteractionLanguageSelect(elements.speechInteractionLanguageSelect);
    clearOptionsDirty();
    applyUiLanguage(state.options.appLanguageId);
    setStatus(tr("statusSaved"), "ok");
    showToast(tr("toastOptionsSaved"), "ok");
  });

  elements.saveApiKeysButton.addEventListener("click", () => {
    saveApiKeys();
  });

  // Marca opções como alteradas sempre que qualquer campo for modificado
  const dirtyWatchers = [
    elements.assistantNameInput,
    elements.nativeLanguageSelect,
    elements.themeSelect,
    elements.optionsDifficultySelect,
    elements.translateAssistantToggle,
    elements.translationTargetLanguageSelect,
    elements.showSpeechUnderstoodToggle,
    elements.debugModeToggle
  ];
  dirtyWatchers.forEach((el) => {
    if (!el) { return; }
    el.addEventListener("change", markOptionsDirty);
    el.addEventListener("input",  markOptionsDirty);
  });

  bindModalEvents();

  // Histórico de conversas
  const textHistoryButton   = document.getElementById("textHistoryButton");
  const speechHistoryButton = document.getElementById("speechHistoryButton");
  const historyModalClose   = document.getElementById("historyModalClose");
  const historyModal        = document.getElementById("historyModal");

  textHistoryButton?.addEventListener("click",   openHistoryModal);
  speechHistoryButton?.addEventListener("click", openHistoryModal);
  historyModalClose?.addEventListener("click",   closeHistoryModal);
  historyModal?.addEventListener("click", (e) => {
    if (e.target === historyModal) { closeHistoryModal(); }
  });
}

// ─── Inicialização ────────────────────────────────────────────────────────────
// Ponto de entrada: carrega config, opções salvas, popula seletores e exibe UI
async function init() {
  try {
    setStatus("...", "ok");
    state.config  = await window.speakAI.getConfig();
    state.options = loadStoredOptions();
    hydrateSelectors();
    applyOptionsToForm();
    bindEvents();
    techParticleField = new TechParticleField(elements.techFxLayer);
    techParticleField.mount();
    closeLifecycleManager = new AppCloseLifecycleManager();
    closeLifecycleManager.bind();
    applySidebarCollapsed(loadSidebarCollapsed());
    await refreshMemorySnapshot();
    await loadApiKeysState();

    initCustomAudioPlayer();
    insertChatHint(elements.textChatMessages,   tr("hintText"));
    insertChatHint(elements.speechChatMessages, tr("hintSpeech"));

    renderCorrectionBox(elements.textCorrectionBox, null, tr("correctionPlaceholder"));
    renderSpeechFeedback(null);
    setSpeechRecordButtonState(false);
    setStatus(tr("statusReady"), "ok");
  } catch (error) {
    setStatus(`Falha na inicialização: ${error.message}`, "error");
    addChatMessage(elements.textChatMessages, "error", `Falha: ${error.message}`);
  }
}

// Tenta salvar resumo das sessões ativas antes de fechar a janela
window.addEventListener("beforeunload", () => {
  if (state.shutdown?.finalizationCompleted) {
    return;
  }
  const name = state.options?.assistantName || state.config?.app?.defaultAssistantName || "SpeakAI";
  if (state.sessions.text.history.length > 1) {
    window.speakAI.finalizeConversation({ history: state.sessions.text.history,   assistantName: name }).catch(() => {});
  }
  if (state.sessions.speech.history.length > 1) {
    window.speakAI.finalizeConversation({ history: state.sessions.speech.history, assistantName: name }).catch(() => {});
  }
});

init();
