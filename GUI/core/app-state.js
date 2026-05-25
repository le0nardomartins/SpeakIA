// ─── app-state.js ────────────────────────────────────────────────────────────
// Constantes, estado global e referências DOM.
// Este arquivo deve ser carregado PRIMEIRO — todos os outros dependem de state e elements.

const USER_OPTIONS_STORAGE_KEY    = "speakai_user_options_v2";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "speakai_sidebar_collapsed_v1";

// Único objeto mutável da aplicação. Nunca crie variáveis de estado soltas fora daqui.
const state = {
  config: null,          // configuração carregada do backend (config.json)
  activeTab: "text",     // aba visível: "text" | "speech" | "options"
  isBusy: false,         // bloqueia interacao enquanto aguarda resposta da IA
  shutdown: {
    closeRequested: false,
    finalizationCompleted: false
  },
  memoryContext: "",     // resumo das conversas anteriores enviado para a IA
  memoryCount: 0,        // número de arquivos de memória salvos
  options: null,         // preferências do usuário (persistidas em localStorage)
  optionsDirty: false,   // indica que há alterações não salvas nas opções
  sessions: {
    text:   { history: [] },   // histórico da sessão de treino textual
    speech: { history: [] }    // histórico da sessão de conversação por voz
  },
  speechRecording: {
    recorder: null,   // instância de MediaRecorder
    chunks:   [],     // fragmentos de áudio coletados
    stream:   null,   // stream do microfone (getUserMedia)
    active:   false   // true enquanto o microfone está gravando
  }
};

// Cache de referências DOM — evita chamadas repetidas a getElementById
const elements = {
  techFxLayer:                      document.getElementById("techFxLayer"),
  layoutShell:                      document.getElementById("layoutShell"),
  sidebarToggleButton:              document.getElementById("sidebarToggleButton"),
  sidebarBrandLogo:                 document.getElementById("sidebarBrandLogo"),
  sidebarRepoLinkButton:            document.getElementById("sidebarRepoLinkButton"),
  memoryBadge:                      document.getElementById("memoryBadge"),
  statusBadge:                      document.getElementById("statusBadge"),
  reloadConfigButton:               document.getElementById("reloadConfigButton"),
  navButtons:                       Array.from(document.querySelectorAll(".nav-btn")),
  tabText:                          document.getElementById("tab-text"),
  tabSpeech:                        document.getElementById("tab-speech"),
  tabOptions:                       document.getElementById("tab-options"),
  // ── Aba de treino textual ──
  textChatMessages:                 document.getElementById("textChatMessages"),
  textInteractionLanguageSelect:    document.getElementById("textInteractionLanguageSelect"),
  textDifficultySelect:             document.getElementById("textDifficultySelect"),
  textInput:                        document.getElementById("textInput"),
  textSendButton:                   document.getElementById("textSendButton"),
  textNewConversationButton:        document.getElementById("textNewConversationButton"),
  textCorrectionBox:                document.getElementById("textCorrectionBox"),
  // ── Aba de conversação por voz ──
  speechChatMessages:               document.getElementById("speechChatMessages"),
  speechInteractionLanguageSelect:  document.getElementById("speechInteractionLanguageSelect"),
  speechDifficultySelect:           document.getElementById("speechDifficultySelect"),
  speechVoiceSelect:                document.getElementById("speechVoiceSelect"),
  speechTextFallbackInput:          document.getElementById("speechTextFallbackInput"),
  speechRecordButton:               document.getElementById("speechRecordButton"),
  speechRecordLabel:                document.getElementById("speechRecordLabel"),
  speechSendTextButton:             document.getElementById("speechSendTextButton"),
  speechAudioPlayer:                document.getElementById("speechAudioPlayer"),
  speechNewConversationButton:      document.getElementById("speechNewConversationButton"),
  speechFeedbackBox:                document.getElementById("speechFeedbackBox"),
  // ── Aba de opções ──
  saveOptionsButton:                document.getElementById("saveOptionsButton"),
  openaiApiKeyInput:                document.getElementById("openaiApiKeyInput"),
  elevenlabsApiKeyInput:            document.getElementById("elevenlabsApiKeyInput"),
  saveApiKeysButton:                document.getElementById("saveApiKeysButton"),
  apiKeysStateText:                 document.getElementById("apiKeysStateText"),
  assistantNameInput:               document.getElementById("assistantNameInput"),
  nativeLanguageSelect:             document.getElementById("nativeLanguageSelect"),
  optionsDifficultySelect:          document.getElementById("optionsDifficultySelect"),
  alwaysTrainingLanguageChips:      document.getElementById("alwaysTrainingLanguageChips"),
  addTrainingLanguageSelect:        document.getElementById("addTrainingLanguageSelect"),
  addTrainingLanguageButton:        document.getElementById("addTrainingLanguageButton"),
  themeSelect:                      document.getElementById("themeSelect"),
  translateAssistantToggle:         document.getElementById("translateAssistantToggle"),
  translationTargetLanguageSelect:  document.getElementById("translationTargetLanguageSelect"),
  showSpeechUnderstoodToggle:       document.getElementById("showSpeechUnderstoodToggle"),
  debugModeToggle:                  document.getElementById("debugModeToggle"),
  appLanguageSelect:                document.getElementById("appLanguageSelect")
};
