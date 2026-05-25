// ─── chat-session.js ──────────────────────────────────────────────────────────
// Renderização do chat, turnos de sessão e gravação de áudio por voz.
// Dependências: app-state.js, ui-utils.js, options-manager.js

// ─── Indicador de digitação ───────────────────────────────────────────────────

// Exibe o indicador de "digitando..." enquanto aguarda resposta da IA
function insertTypingIndicator(container, assistantName) {
  removeTypingIndicator(container);
  const t     = getTranslation(state.options?.appLanguageId || "en-US");
  const label = typeof t.typingIndicator === "function" ? t.typingIndicator(assistantName) : `${assistantName}...`;

  const row    = document.createElement("div");
  row.className = "message-row assistant typing-indicator-row";

  const meta       = document.createElement("div");
  meta.className   = "message-meta";
  meta.textContent = assistantName;

  const bubble     = document.createElement("div");
  bubble.className = "typing-bubble";

  const labelEl       = document.createElement("span");
  labelEl.className   = "typing-label";
  labelEl.textContent = label;

  const dots     = document.createElement("div");
  dots.className = "typing-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";

  bubble.appendChild(labelEl);
  bubble.appendChild(dots);
  row.appendChild(meta);
  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator(container) {
  const existing = container.querySelector(".typing-indicator-row");
  if (existing) { existing.remove(); }
}

// ─── Mensagens de chat ────────────────────────────────────────────────────────

// Exibe uma dica centralizada quando o chat está vazio
function insertChatHint(container, text) {
  const hint = document.createElement("div");
  hint.className = "chat-hint";
  hint.innerHTML = `
    <svg viewBox="0 0 24 24" class="chat-hint-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    <span>${escapeHtml(text)}</span>
  `;
  container.appendChild(hint);
}

// Anima o texto da IA aparecendo palavra a palavra
function typewriterReveal(element, text, onDone, scrollContainer) {
  const words = text.split(" ");
  let i = 0;
  element.textContent = "";

  function step() {
    if (i >= words.length) {
      if (onDone) { onDone(); }
      return;
    }
    element.textContent += (i > 0 ? " " : "") + words[i];
    i++;
    if (scrollContainer) { scrollContainer.scrollTop = scrollContainer.scrollHeight; }
    setTimeout(step, 28);
  }
  step();
}

// Adiciona ícone de correção abaixo da mensagem do usuário quando há erros
function addUserCorrectionIcon(wrapper, correction) {
  if (!correction || !correction.corrected || correction.original === correction.corrected) { return; }

  const btn     = document.createElement("button");
  btn.type      = "button";
  btn.className = "msg-correction-btn";
  btn.title     = "Ver correção";
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  let card = null;

  btn.addEventListener("click", () => {
    if (card) {
      card.remove();
      card = null;
      btn.classList.remove("is-active");
      return;
    }
    const notes     = Array.isArray(correction.notes) ? correction.notes : [];
    const notesHtml = notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");

    card = document.createElement("div");
    card.className = "user-correction-card";
    card.innerHTML = `
      <div class="uccard-label">Versão corrigida</div>
      <div class="uccard-corrected">${escapeHtml(correction.corrected)}</div>
      ${notesHtml ? `<ul class="uccard-notes">${notesHtml}</ul>` : ""}
    `;
    wrapper.appendChild(card);
    btn.classList.add("is-active");
  });

  wrapper.appendChild(btn);
}

// Adiciona uma mensagem ao chat; role pode ser "user", "assistant", "error" ou "info"
// Mensagens de assistente incluem botão de tradução inline
// animate=true: revela o texto com efeito de digitação (somente para "assistant")
function addChatMessage(container, role, text, translation = "", animate = false) {
  const wrapper       = document.createElement("div");
  wrapper.className   = `message-row ${role}`;

  const meta       = document.createElement("div");
  meta.className   = "message-meta";
  meta.textContent = role === "user"      ? "Você"
                   : role === "assistant" ? (state.options?.assistantName || "SpeakAI")
                   : role === "error"     ? "Sistema"
                   : "Info";

  const bubble     = document.createElement("div");
  bubble.className = `message ${role}`;

  const useTypewriter = animate && role === "assistant" && text;

  if (!useTypewriter) {
    bubble.textContent = text;
    if (translation) {
      const translationEl       = document.createElement("div");
      translationEl.className   = "assistant-translation";
      translationEl.textContent = `Tradução: ${translation}`;
      bubble.appendChild(translationEl);
    }
  }

  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);

  // Botão de tradução sob demanda (apenas mensagens da IA)
  if (role === "assistant") {
    const translateBtn     = document.createElement("button");
    translateBtn.type      = "button";
    translateBtn.className = "msg-translate-btn";
    translateBtn.title     = "Traduzir mensagem";
    translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c-2.5 2.5-3.5 5.5-3.5 9s1 6.5 3.5 9M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9"/></svg>`;

    let annexEl = null;
    let loading = false;

    translateBtn.addEventListener("click", async () => {
      if (loading) { return; }
      if (annexEl) {
        annexEl.remove();
        annexEl = null;
        translateBtn.classList.remove("is-active");
        return;
      }

      const targetLanguage = state.config.languages.find(
        (l) => l.id === state.options?.translationTargetLanguageId
      ) || state.config.languages.find((l) => l.id === "pt-BR") || state.config.languages[0];

      loading = true;
      translateBtn.disabled = true;
      translateBtn.classList.add("is-loading");

      try {
        const result = await window.speakAI.translateText({ text, targetIso6391: targetLanguage.iso6391 });
        annexEl           = document.createElement("div");
        annexEl.className = "msg-translation-annex";
        annexEl.textContent = result.text;
        wrapper.appendChild(annexEl);
        translateBtn.classList.add("is-active");
      } catch { /* falha silenciosa */ } finally {
        loading = false;
        translateBtn.disabled = false;
        translateBtn.classList.remove("is-loading");
      }
    });

    wrapper.appendChild(translateBtn);
  }

  const hint = container.querySelector(".chat-hint");
  if (hint) { hint.remove(); }
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;

  if (useTypewriter) {
    typewriterReveal(bubble, text, () => {
      if (translation) {
        const translationEl       = document.createElement("div");
        translationEl.className   = "assistant-translation";
        translationEl.textContent = `Tradução: ${translation}`;
        bubble.appendChild(translationEl);
      }
    }, container);
  }

  return wrapper;
}

// Renderiza o box de correção gramatical abaixo do chat textual
function renderCorrectionBox(box, correction, emptyText) {
  if (!correction) {
    box.innerHTML = `<p class="placeholder">${escapeHtml(emptyText)}</p>`;
    return;
  }
  const notes     = Array.isArray(correction.notes) ? correction.notes : [];
  const notesHtml = notes.length > 0
    ? `<ul class="note-list">${notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p class="placeholder">${escapeHtml(tr("correctionNoNotes"))}</p>`;

  box.innerHTML = [
    `<p><strong>${escapeHtml(tr("correctionOriginal"))}:</strong> ${escapeHtml(correction.original || "-")}</p>`,
    `<p><strong>${escapeHtml(tr("correctionCorrected"))}:</strong> ${escapeHtml(correction.corrected || "-")}</p>`,
    notesHtml
  ].join("");
}

// Renderiza o painel de feedback de fala (transcrição, avaliação, tradução)
function renderSpeechFeedback(feedback) {
  if (!feedback) {
    elements.speechFeedbackBox.innerHTML = `<p class="placeholder">Feedback de fala será exibido aqui.</p>`;
    return;
  }
  const lines = [];
  if (state.options.showSpeechUnderstood)
    lines.push(`<p><strong>IA entendeu:</strong> ${escapeHtml(feedback.understoodText || "-")}</p>`);
  if (state.options.showSpeechCorrectness) {
    lines.push(`<p><strong>Avaliação:</strong> ${escapeHtml(feedback.correctnessMessage || "-")}</p>`);
    lines.push(`<p><strong>Sugestão:</strong> ${escapeHtml(feedback.suggestedText || "-")}</p>`);
  }
  if (state.options.showSpeechUserTranslation && feedback.translatedUserText)
    lines.push(`<p><strong>Tradução da sua fala:</strong> ${escapeHtml(feedback.translatedUserText)}</p>`);
  if (lines.length === 0)
    lines.push(`<p class="placeholder">Feedback oculto pelas opções atuais.</p>`);

  elements.speechFeedbackBox.innerHTML = lines.join("");
}

// Atualiza o botão e label do microfone conforme estado de gravação
function setSpeechRecordButtonState(isRecording) {
  elements.speechRecordButton.classList.toggle("is-recording", Boolean(isRecording));
  elements.speechRecordButton.title = isRecording ? "Parar gravação" : "Gravar áudio";
  elements.speechRecordButton.setAttribute("aria-label", elements.speechRecordButton.title);
  if (elements.speechRecordLabel) {
    elements.speechRecordLabel.textContent = isRecording ? tr("recordStop") : tr("recordPress");
  }
}

// ─── Turnos de sessão ─────────────────────────────────────────────────────────

function getCommonPayload(sessionType, interactionLanguageId, difficultyId, history, userText) {
  return {
    sessionType,
    languageId:                  interactionLanguageId,
    voiceId:                     sessionType === "speech" ? elements.speechVoiceSelect.value : "",
    modeId:                      "conversation_with_correction",
    difficultyId,
    assistantName:               state.options.assistantName,
    translateAssistantReply:     state.options.translateAssistantReply,
    translationTargetLanguageId: state.options.translationTargetLanguageId,
    nativeLanguageId:            state.options.nativeLanguageId,
    translateUserSpeechToNative: state.options.translateUserSpeechToNative,
    alwaysTrainingLanguageIds:   state.options.alwaysTrainingLanguageIds,
    text:                        userText,
    history,
    memoryContext:               state.memoryContext
  };
}

function requireInteractionLanguage(selectElement) {
  const languageId = String(selectElement.value || "").trim()
    || getInteractionLanguagePool()[0]
    || state.config.app.defaultLanguageId;

  if (!languageId) { setStatus("Selecione o idioma treinado para esta interação.", "error"); return ""; }
  if (String(selectElement.value || "").trim() !== languageId) { selectElement.value = languageId; }
  return languageId;
}

// Executa um turno completo da sessão: envia mensagem do usuário, exibe indicador,
// chama o backend e renderiza a resposta da IA (texto + correção + áudio se speech)
async function runSessionTurn({ sessionKey, userText, interactionLanguageId, difficultyId, chatContainer, correctionBox, sessionType, clearInputCallback }) {
  const session      = state.sessions[sessionKey];
  const safeUserText = String(userText || "").trim();
  if (!safeUserText) { return; }

  session.history.push({ role: "user", text: safeUserText });
  const userMsgWrapper = addChatMessage(chatContainer, "user", safeUserText);
  clearInputCallback();

  const assistantName = state.options?.assistantName || state.config?.app?.defaultAssistantName || "Ari";
  insertTypingIndicator(chatContainer, assistantName);
  setBusy(true);
  setStatus(tr("statusProcessing"), "ok");

  try {
    const result        = await window.speakAI.processTurn(getCommonPayload(sessionType, interactionLanguageId, difficultyId, session.history, safeUserText));
    removeTypingIndicator(chatContainer);

    const assistantText = String(result?.assistantText || "").trim();
    if (!assistantText) { throw new Error("Resposta vazia da IA"); }

    const translatedAssistantText = String(result?.translatedAssistantText || "").trim();
    session.history.push({ role: "assistant", text: assistantText });
    addChatMessage(chatContainer, "assistant", assistantText, translatedAssistantText, true);

    // correction=null means AI found no errors; distinguish from pre-turn placeholder
    const corrEmptyText = result.correction === null ? tr("correctionNone") : tr("correctionPlaceholder");
    renderCorrectionBox(correctionBox, result.correction, corrEmptyText);

    // Add correction icon to user's message bubble if there are errors
    if (userMsgWrapper && result.correction) {
      addUserCorrectionIcon(userMsgWrapper, result.correction);
    }

    if (sessionType === "speech") {
      renderSpeechFeedback(result?.speechDiagnostics || null);
      if (result?.audioDataUrl && state.config.ui?.autoPlayAssistantAudio) {
        elements.speechAudioPlayer.src = result.audioDataUrl;
        const p = elements.speechAudioPlayer.play();
        if (p?.catch) { p.catch(() => {}); }
      }
    }
    setStatus("Resposta gerada", "ok");
  } catch (error) {
    removeTypingIndicator(chatContainer);
    addChatMessage(chatContainer, "error", `Erro: ${error.message}`);
    setStatus("Erro na interação", "error");
  } finally {
    setBusy(false);
  }
}

// ─── Gravação de áudio ────────────────────────────────────────────────────────

function stopSpeechStreamTracks() {
  if (state.speechRecording.stream) {
    state.speechRecording.stream.getTracks().forEach((track) => track.stop());
    state.speechRecording.stream = null;
  }
}

// Alterna gravação de áudio: primeira chamada inicia, segunda para e processa
async function handleSpeechRecordingToggle() {
  if (state.isBusy) { return; }
  const interactionLanguageId = requireInteractionLanguage(elements.speechInteractionLanguageSelect);
  if (!interactionLanguageId) { return; }

  if (state.speechRecording.active) {
    state.speechRecording.active = false;
    setSpeechRecordButtonState(false);
    setBusy(true);
    try {
      await new Promise((resolve, reject) => {
        if (!state.speechRecording.recorder) { resolve(); return; }
        state.speechRecording.recorder.onstop = async () => {
          try {
            const blob         = new Blob(state.speechRecording.chunks, { type: state.config.ui?.recordingMimeType || "audio/webm" });
            const arrayBuffer  = await blob.arrayBuffer();
            const transcriptResult = await window.speakAI.transcribeAudio({ audioBuffer: arrayBuffer, mimeType: blob.type, languageId: interactionLanguageId });
            const transcript   = String(transcriptResult?.text || "").trim();
            if (!transcript) { throw new Error("Transcrição vazia"); }

            if (state.options.showSpeechUnderstood) {
              addChatMessage(elements.speechChatMessages, "info", `IA entendeu da sua fala: ${transcript}`);
            }

            await runSessionTurn({
              sessionKey: "speech", userText: transcript, interactionLanguageId,
              difficultyId: elements.speechDifficultySelect.value,
              chatContainer: elements.speechChatMessages, correctionBox: elements.speechFeedbackBox,
              sessionType: "speech", clearInputCallback: () => {}
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
    } finally { setBusy(false); }
    return;
  }

  try {
    state.speechRecording.stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType            = state.config.ui?.recordingMimeType || "audio/webm";
    const supportsPreferred        = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(preferredType);
    const options                  = supportsPreferred ? { mimeType: preferredType } : undefined;
    state.speechRecording.recorder = new MediaRecorder(state.speechRecording.stream, options);
    state.speechRecording.chunks   = [];

    state.speechRecording.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) { state.speechRecording.chunks.push(event.data); }
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

// ─── Memória e finalização ────────────────────────────────────────────────────

// Finaliza a conversa: salva resumo na memória e limpa o histórico da sessão
async function finalizeConversation(sessionKey, chatContainer, resetTarget) {
  const session = state.sessions[sessionKey];
  if (state.isBusy) { return; }

  try {
    setBusy(true);
    setStatus("Resumindo conversa...", "ok");
    const summaryResult = await window.speakAI.finalizeConversation({ history: session.history, assistantName: state.options.assistantName });

    session.history      = [];
    state.memoryContext  = String(summaryResult?.memoryContext || "");
    setMemoryBadge(Number(summaryResult?.talkCount || 0));
    chatContainer.innerHTML = "";

    if (sessionKey === "speech") {
      elements.speechAudioPlayer.removeAttribute("src");
      renderSpeechFeedback(null);
    } else {
      renderCorrectionBox(elements.textCorrectionBox, null, tr("correctionPlaceholder"));
    }

    addChatMessage(chatContainer, "assistant", `${state.options.assistantName} pronto para nova conversa.`);
    setStatus(summaryResult?.saved ? `Resumo salvo em ${summaryResult.fileName}` : "Nova conversa iniciada", "ok");
    resetTarget();
  } catch (error) {
    setStatus("Erro ao finalizar conversa", "error");
    addChatMessage(chatContainer, "error", `Erro ao finalizar: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function refreshMemorySnapshot() {
  const snapshot      = await window.speakAI.getMemorySnapshot();
  state.memoryContext = String(snapshot?.memoryContext || "");
  setMemoryBadge(Number(snapshot?.talkCount || 0));
}
