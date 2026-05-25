const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("speakAI", {
  getConfig: () => ipcRenderer.invoke("speakai:get-config"),
  reloadConfig: () => ipcRenderer.invoke("speakai:reload-config"),
  transcribeAudio: (payload) => ipcRenderer.invoke("speakai:transcribe-audio", payload),
  processTurn: (payload) => ipcRenderer.invoke("speakai:process-turn", payload),
  getMemorySnapshot: () => ipcRenderer.invoke("speakai:get-memory-snapshot"),
  finalizeConversation: (payload) => ipcRenderer.invoke("speakai:finalize-conversation", payload),
  getApiSettings: () => ipcRenderer.invoke("speakai:get-api-settings"),
  saveApiSettings: (payload) => ipcRenderer.invoke("speakai:save-api-settings", payload),
  translateText: (payload) => ipcRenderer.invoke("speakai:translate-text", payload),
  listConversations: () => ipcRenderer.invoke("speakai:list-conversations")
});
