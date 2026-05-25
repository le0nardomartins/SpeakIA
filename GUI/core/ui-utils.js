// ─── ui-utils.js ─────────────────────────────────────────────────────────────
// Funções utilitárias de UI: status, toasts, i18n, sidebar, abas e textarea.
// Dependências: app-state.js, translations.js

// Escapa caracteres HTML para evitar XSS ao inserir texto dinamicamente
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Atualiza o badge de status no rodapé da sidebar
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

// Ativa/desativa os controles interativos enquanto a IA processa
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

// Atualiza o badge de memórias com o texto traduzido
function setMemoryBadge(count) {
  state.memoryCount = Number.isInteger(count) ? count : 0;
  const t = getTranslation(state.options?.appLanguageId || "pt-BR");
  elements.memoryBadge.textContent = typeof t.footerMemory === "function"
    ? t.footerMemory(state.memoryCount)
    : `Memórias: ${state.memoryCount}`;
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

// Redimensiona a textarea conforme o conteúdo (máx 180px)
function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
}

// ─── Toast ───────────────────────────────────────────────────────────────────
// Exibe uma notificação temporária no canto inferior direito
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

// ─── Dirty state das opções ───────────────────────────────────────────────────
function markOptionsDirty()  { state.optionsDirty = true;  }
function clearOptionsDirty() { state.optionsDirty = false; }

// ─── Modal de alterações não salvas ──────────────────────────────────────────
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

// ─── Navegação entre abas ─────────────────────────────────────────────────────
function setActiveTab(tabId) {
  state.activeTab = tabId;
  const map = {
    text:    elements.tabText,
    speech:  elements.tabSpeech,
    options: elements.tabOptions
  };
  Object.entries(map).forEach(([id, panel]) => {
    panel.classList.toggle("is-active", id === tabId);
  });
  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabId);
  });
}

// ─── Sidebar colapsável ───────────────────────────────────────────────────────
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

// ─── i18n ─────────────────────────────────────────────────────────────────────
// Atalho para buscar uma string traduzida usando o idioma atual do app
function tr(key) {
  const t = getTranslation(state.options?.appLanguageId || "en-US");
  const val = t[key];
  return typeof val === "string" ? val : key;
}

// Atualiza todos os elementos marcados com data-i18n / data-i18n-ph
// Chamado na inicialização e sempre que o usuário troca o idioma do app
function applyUiLanguage(langId) {
  const t = getTranslation(langId);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (typeof t[key] === "string") { el.textContent = t[key]; }
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    const key = el.dataset.i18nPh;
    if (typeof t[key] === "string") { el.placeholder = t[key]; }
  });
  if (elements.memoryBadge) {
    const fn = t.footerMemory;
    elements.memoryBadge.textContent = typeof fn === "function"
      ? fn(state.memoryCount || 0)
      : `Memórias: ${state.memoryCount || 0}`;
  }
}
