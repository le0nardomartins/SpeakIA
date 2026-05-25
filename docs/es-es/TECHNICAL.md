# SpeakAI — Referencia Técnica

> Análisis profundo de la arquitectura, flujos de datos, puente IPC, ingeniería de prompts e internos de módulos.

<p align="center">
  🌐 &nbsp;
  <a href="../../README.md"><img src="https://flagcdn.com/20x15/us.png" alt="en-US" /> English</a>
  &nbsp;|&nbsp;
  <a href="../pt-br/TECHNICAL.md"><img src="https://flagcdn.com/20x15/br.png" alt="pt-BR" /> Português</a>
  &nbsp;|&nbsp;
  <a href="TECHNICAL.md"><img src="https://flagcdn.com/20x15/es.png" alt="es-ES" /> Español</a>
</p>

---

## Tabla de Contenidos

1. [Modelo de Procesos](#1-modelo-de-procesos)
2. [Puente IPC](#2-puente-ipc)
3. [Backend — `src/`](#3-backend--src)
4. [Renderer — `GUI/`](#4-renderer--gui)
5. [Turno de Conversación — Flujo Completo de Datos](#5-turno-de-conversación--flujo-completo-de-datos)
6. [Sistema de Memoria](#6-sistema-de-memoria)
7. [Motor de Corrección Gramatical](#7-motor-de-corrección-gramatical)
8. [Ingeniería de Prompts](#8-ingeniería-de-prompts)
9. [Referencia del Esquema `config.json`](#9-referencia-del-esquema-configjson)
10. [Sistema de Tokens CSS](#10-sistema-de-tokens-css)
11. [Sistema i18n](#11-sistema-i18n)

---

## 1. Modelo de Procesos

SpeakAI es una app Electron estándar de dos procesos. Los dos procesos no pueden compartir memoria — se comunican exclusivamente a través de IPC.

```
┌─────────────────────────────────────────────────────────────────┐
│  Proceso Principal  (Node.js — src/)                            │
│                                                                 │
│  bootstrap()                                                    │
│    loadConfig()          — lee config.json en memoria           │
│    registerIpcHandlers() — conecta canales IPC speakai:*        │
│    createMainWindow()    — BrowserWindow, carga GUI/index.html  │
│                                                                 │
│  En ejecución:                                                  │
│    ipcMain.handle("speakai:*", handler)                         │
│    → openai-client.js    (Whisper, Responses API)               │
│    → elevenlabs-client.js (TTS)                                 │
│    → translation-client.js (Google Translate)                   │
│    → memory-store.js     (lectura/escritura de talk_N.txt)      │
└────────────────────────────┬────────────────────────────────────┘
                             │  contextBridge (preload.js)
                             │  contextIsolation: true
                             │  nodeIntegration: false
                             │  sandbox: true
┌────────────────────────────▼────────────────────────────────────┐
│  Proceso Renderer  (Vanilla JS — GUI/)                          │
│                                                                 │
│  window.speakAI.*  ← única superficie de API disponible        │
│                                                                 │
│  Orden de carga de scripts (index.html):                        │
│    i18n/translations.js                                         │
│    core/app-state.js                                            │
│    core/ui-utils.js                                             │
│    modules/options-manager.js                                   │
│    modules/chat-session.js                                      │
│    renderer.js  ← init() se llama aquí                          │
└─────────────────────────────────────────────────────────────────┘
```

**Restricciones de seguridad:**
- `contextIsolation: true` — el renderer no puede acceder a APIs de Node
- `nodeIntegration: false` — sin `require()` en el renderer
- `sandbox: true` — el renderer corre en sandbox a nivel de OS
- `preload.js` es el único puente y expone exactamente 10 métodos

---

## 2. Puente IPC

`preload.js` expone `window.speakAI` vía `contextBridge.exposeInMainWorld`. Cada llamada es un `ipcRenderer.invoke()` que mapea a un `ipcMain.handle()` en `main.js`.

| `window.speakAI.*` | Canal IPC | Manejador | Descripción |
|---|---|---|---|
| `getConfig()` | `speakai:get-config` | `getPublicConfig()` | Devuelve config sanitizada (sin secretos) |
| `reloadConfig()` | `speakai:reload-config` | `loadConfig()` + `getPublicConfig()` | Recarga `config.json` sin reiniciar |
| `transcribeAudio(payload)` | `speakai:transcribe-audio` | `transcribeAudio()` en openai-client | Envía blob de audio a Whisper STT |
| `processTurn(payload)` | `speakai:process-turn` | `processTurn()` en orchestrator | Turno completo (LLM + corrección + TTS) |
| `getMemorySnapshot()` | `speakai:get-memory-snapshot` | `getMemorySnapshot()` | Devuelve string `memoryContext` + `talkCount` |
| `finalizeConversation(payload)` | `speakai:finalize-conversation` | `finalizeConversation()` | Resume el historial y guarda en `talk_N.txt` |
| `listConversations()` | `speakai:list-conversations` | `loadAllTalkSummaries()` | Devuelve lista de conversaciones guardadas con vista previa |
| `getApiSettings()` | `speakai:get-api-settings` | `getApiKeySettings()` | Devuelve qué claves están configuradas (no sus valores) |
| `saveApiSettings(payload)` | `speakai:save-api-settings` | `saveApiKeySettings()` | Escribe claves en el archivo `.env` |
| `translateText(payload)` | `speakai:translate-text` | `translateText()` | Traducción de texto bajo demanda |

### Forma del payload de `processTurn`

```json
{
  "sessionType": "text | speech",
  "languageId": "en-US",
  "voiceId": "JBFqnCBsd6RMkjVDRZzb",
  "modeId": "conversation_with_correction",
  "difficultyId": "beginner",
  "assistantName": "Ari",
  "translateAssistantReply": true,
  "translationTargetLanguageId": "pt-BR",
  "nativeLanguageId": "pt-BR",
  "translateUserSpeechToNative": true,
  "alwaysTrainingLanguageIds": ["en-US"],
  "text": "Hello, how are you?",
  "history": [{ "role": "user", "text": "..." }, { "role": "assistant", "text": "..." }],
  "memoryContext": "Talk 1 summary: ..."
}
```

### Forma de la respuesta de `processTurn`

```json
{
  "assistantText": "I'm doing great! What would you like to talk about?",
  "translatedAssistantText": "Estoy muy bien! ¿De qué te gustaría hablar?",
  "correction": {
    "original": "Hello, how are you?",
    "corrected": "Hello, how are you?",
    "changed": false,
    "notes": []
  },
  "audioDataUrl": "data:audio/mp3;base64,...",
  "speechDiagnostics": {
    "understoodText": "Hello, how are you?",
    "translatedUserText": "Hola, ¿cómo estás?",
    "isLikelyCorrect": true,
    "suggestedText": "Hello, how are you?",
    "correctnessMessage": "Tu habla fue entendida y es correcta."
  }
}
```

### Forma de la respuesta de `listConversations`

```json
[
  {
    "talkNumber": 1,
    "fileName": "talk_1.txt",
    "preview": "Primeros 300 caracteres del resumen..."
  }
]
```

---

## 3. Backend — `src/`

### `main.js`

Punto de entrada de bootstrap. Corre secuencialmente:

```
bootstrap()
  loadConfig()             — valida y cachea config.json
  registerIpcHandlers()    — 10 registros de ipcMain.handle()
  app.whenReady()
  createMainWindow()       — BrowserWindow(1200×820, mín 980×680)
```

Config de `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `preload: src/preload.js`.

---

### `src/config/config-store.js`

Lee `config.json` una vez al inicio en caché en memoria. `getPublicConfig()` elimina `providers.openai.apiKey` (si estuviera presente) antes de enviarlo al renderer. `loadConfig()` puede llamarse en tiempo de ejecución para recargar en caliente sin reiniciar.

---

### `src/config/env-file-store.js`

Lee y escribe `.env` usando `fs.readFileSync`/`fs.writeFileSync`. `saveApiKeySettings()` parsea el archivo existente, parchea las líneas relevantes y sobreescribe — preservando todos los demás valores.

---

### `src/clients/openai-client.js`

Todas las llamadas a OpenAI pasan por `callResponsesApi()` que hace POST a `{baseUrl}/responses`:

```javascript
// Forma del request (OpenAI Responses API)
{
  model: "gpt-5-mini",
  instructions: "<system prompt>",
  input: "User: ...\nAssistant:",
  store: false
}
```

**Tres callers:**

| Función | Clave de modelo en config | Qué hace |
|---|---|---|
| `generateAssistantReply()` | `conversationModel` | Llamada LLM principal de conversación |
| `generateGrammarWithLlm()` | `grammarModel` | Coach gramatical basado en LLM (opcional) |
| `generateTalkSummary()` | `summaryModel` | Resume el historial para el archivo de memoria |

**`transcribeAudio()`** hace POST a `{baseUrl}/audio/transcriptions` como `multipart/form-data` con el blob de audio, modelo (`gpt-4o-mini-transcribe`) y código de idioma ISO 639-1.

**`buildBaseSpeechInstructions()`** ensambla el system prompt concatenando secciones en orden:
1. Prompt base (`config.prompts.speechBaseEnglish`) con `{{assistantName}}` sustituido
2. `TRAINING LANGUAGE FOR THIS SESSION: {label}. You MUST respond only in this language.`
3. `User's native language (for your context only, do NOT use it to respond): {label}.`
4. `Learner level: {difficultyHint}`
5. `Context from previous conversations:\n{memoryContext}` (si existe)

---

### `src/clients/elevenlabs-client.js`

Llama a `POST {baseUrl}/text-to-speech/{voiceId}` con:

```json
{
  "text": "...",
  "model_id": "eleven_multilingual_v2",
  "language_code": "en",
  "voice_settings": {
    "stability": 0.45,
    "similarity_boost": 0.75,
    "style": 0.25,
    "use_speaker_boost": true
  }
}
```

Devuelve una URL `data:audio/mp3;base64,...` lista para el elemento de reproductor de audio personalizado.

---

### `src/clients/translation-client.js`

Envuelve `@vitalets/google-translate-api`. No requiere clave de API — usa el endpoint público de Google Translate. Usado para:
- Auto-traducir respuestas del asistente (si `translateAssistantReply: true`)
- Traducir la voz del usuario al idioma nativo (modo voz)
- Traducción inline bajo demanda desde el botón de traducir en el chat

---

### `src/conversation/orchestrator.js`

`processTurn()` es el núcleo de la app. Corre en esta secuencia:

```
1. Resolver objetos de idioma, dificultad, idioma nativo desde config
2. Recortar historial a maxHistoryMessages (por defecto 20)
3. EN PARALELO:
   a. generateAssistantReply()  — llamada LLM
   b. generateCorrection()      — verificación gramatical (heurística local o LLM)
4. await Promise.all([assistantPromise, correctionPromise])
5. maybeTranslate(assistantText)  — solo si translateAssistantReply=true
6. Si sessionType === "speech":
   a. Ejecutar corrección en texto del usuario (si no se hizo antes)
   b. maybeTranslate(userText) → nativeLanguage
   c. buildSpeechDiagnostics()
7. Si assistantVoiceEnabled && voiceId:
   a. synthesizeSpeech() → audioDataUrl
8. Devolver objeto de resultado completo
```

Los pasos 3a y 3b corren **en paralelo** vía `Promise.all` — la verificación gramatical no bloquea la respuesta de la IA.

---

### `src/conversation/conversation-memory-orchestrator.js`

Capa delgada sobre `memory-store.js`:

- `getMemorySnapshot(config)` — devuelve `{ memoryContext: string, talkCount: number }`
- `finalizeConversation({ config, history, assistantName })`:
  1. Sanitiza el historial (elimina turnos que no son usuario/asistente, textos vacíos)
  2. Si el historial tiene < 2 items → omite guardado, devuelve snapshot
  3. Llama a `generateTalkSummary()` → string de resumen LLM
  4. Llama a `saveTalkSummary(config, summary)` → escribe `talk_N.txt`
  5. Devuelve `{ saved, summary, fileName, memoryContext, talkCount }`

---

### `src/conversation/memory-store.js`

Operaciones puras de filesystem en `ai_memory/` (ruta desde `config.memory.folder`):

| Función | Qué hace |
|---|---|
| `listTalkFiles(config)` | Lee el directorio, filtra patrón `talk_N.txt`, ordena por N |
| `loadAllTalkSummaries(config)` | Lee el contenido de cada archivo, filtra vacíos |
| `buildMemoryContext(config)` | Une todos los resúmenes como `"Talk N summary:\n{content}"` |
| `saveTalkSummary(config, summary)` | Escribe `talk_{max+1}.txt` con el resumen |

El `talkPrefix` (`talk_`) es configurable en `config.json`.

---

### `src/conversation/local-grammar-engine.js`

Verificador gramatical determinista basado en reglas. Corre cuando `config.correction.engine = "local_heuristic"` (por defecto). Devuelve:

```json
{
  "original": "...",
  "corrected": "...",
  "changed": true,
  "notes": ["Possible issue: ..."]
}
```

Sin llamada a API — latencia cero. El motor LLM (`config.correction.engine = "llm"`) llama a `generateGrammarWithLlm()` en su lugar.

---

## 4. Renderer — `GUI/`

Sin bundler. Seis tags `<script>` en `index.html`. Todos los módulos comparten el **ámbito global del navegador** — las funciones exportadas de cada archivo están disponibles para todos los scripts cargados después.

### `GUI/i18n/translations.js`

Exporta `TRANSLATIONS` — un objeto plano con clave BCP-47 de idioma:

```javascript
const TRANSLATIONS = {
  "en-US": {
    navGrammar: "Grammar Training",
    navSpeech: "Conversation",
    statusReady: "Ready",
    typingIndicator: (name) => `${name} is typing...`,
    footerMemory: (count) => `Memories: ${count}`,
    // ...
  },
  "pt-BR": { ... },
  "es-ES": { ... },
  "fr-FR": { ... },
  "de-DE": { ... },
  "it-IT": { ... }
}
```

**6 idiomas** tienen traducciones completas de UI. Los 30 idiomas de entrenamiento pueden usarse para conversación — solo estos 6 traducen la interfaz en sí.

---

### `GUI/core/app-state.js`

Define dos globales compartidos por todos los demás módulos:

**`state`** — el único objeto mutable. Nunca almacenes estado de la app fuera de este objeto.

```javascript
const state = {
  config: null,          // payload de config.json desde el proceso principal
  activeTab: "text",     // "text" | "speech" | "options"
  isBusy: false,         // bloquea la UI durante el procesamiento de IA
  memoryContext: "",     // inyectado en cada llamada a processTurn
  memoryCount: 0,        // número de archivos talk_N.txt
  options: null,         // preferencias del usuario (desde localStorage)
  optionsDirty: false,   // flag de opciones no guardadas
  sessions: {
    text:   { history: [] },
    speech: { history: [] }
  },
  speechRecording: {
    recorder: null,      // instancia de MediaRecorder
    chunks:   [],        // chunks de Blob recolectados
    stream:   null,      // stream de getUserMedia
    active:   false
  }
}
```

**`elements`** — caché del DOM. Todas las llamadas `getElementById` / `querySelectorAll` ocurren una vez al parsear, almacenadas aquí.

**Claves de almacenamiento:**
- `speakai_user_options_v2` — clave de localStorage para preferencias del usuario
- `speakai_sidebar_collapsed_v1` — clave de localStorage para estado de la barra lateral

---

### `GUI/core/ui-utils.js`

Funciones de utilidad sin estado. Las más importantes:

| Función | Propósito |
|---|---|
| `tr(key)` | Devuelve string traducida para `state.options.appLanguageId` |
| `applyUiLanguage(langId)` | Actualiza todos los elementos `[data-i18n]` y `[data-i18n-ph]` |
| `setStatus(message, type)` | Actualiza el badge de estado del footer (ok = verde, error = ámbar) |
| `setBusy(value)` | Alterna `state.isBusy` + deshabilita/habilita todos los controles interactivos |
| `setMemoryBadge(count)` | Actualiza la visualización del contador de memoria en el footer |
| `showToast(message, type)` | Crea notificación temporal (auto-descarta a los 3.2s) |
| `setActiveTab(tabId)` | Cambia el panel visible + botón nav activo |
| `openUnsavedModal(tab)` / `closeUnsavedModal()` | Controla el diálogo de cambios no guardados |
| `applySidebarCollapsed(bool)` | Alterna clase `sidebar-collapsed` en `#layoutShell` |

---

### `GUI/modules/options-manager.js`

Gestiona el ciclo de vida de preferencias del usuario:

```
loadStoredOptions()
  → localStorage.getItem(USER_OPTIONS_STORAGE_KEY)
  → normalizeOptions(raw)
    → getDefaultOptionsFromConfig()
      → detectDeviceLanguageId()   — hace match de navigator.languages con config.languages
      → hasAppLanguage(id)         — verifica si TRANSLATIONS[id] existe
    → valida cada campo contra config (hasLanguage, hasDifficulty, hasTheme)
    → rellena campos faltantes con valores predeterminados
```

**Gestión de estado de claves de API:**
- `renderApiKeysState(settings)` — muestra un indicador verde "Chave configurada" debajo de cada input cuando una clave existe; actualiza el texto de placeholder; almacena el estado actual en `_apiKeysExist`
- `saveApiKeys()` — si las claves existentes serían sobreescritas, muestra un modal de confirmación rojo (`#apiKeyOverwriteModal`) antes de proceder
- `_doSaveApiKeys(openai, elevenlabs)` — la lógica de guardado real, llamada después de la confirmación

**UI de chips de idioma:** `renderTrainingLanguageChips()` crea `<button class="lang-chip">` con iconos de bandera `<span class="fi fi-{code}">`. Al hacer clic elimina el idioma si hay más de uno seleccionado.

**Funciones de populate:** `hydrateSelectors()` llama a todas las funciones de populate una vez al inicio (y después de recargar config). Cada `populate*()` limpia y reconstruye su `<select>` desde `state.config`.

---

### `GUI/modules/chat-session.js`

**`addChatMessage(container, role, text, translation, animate)`**

Devuelve el elemento `div` wrapper. Para `role === "assistant"`:
- Agrega un botón de traducción con ícono de globo (`<button class="msg-translate-btn">`)
- Si `animate === true`: revela el texto palabra por palabra vía `typewriterReveal()` (28ms/palabra); el div de traducción se agrega después de que termina la animación
- Primer clic en traducir: llama a `window.speakAI.translateText()`, agrega `<div class="msg-translation-annex">`
- Segundo clic en traducir: elimina el elemento annex

**`addUserCorrectionIcon(wrapper, correction)`**

Se llama después de que la IA responde. Si `correction.original !== correction.corrected`, agrega un botón de ícono de lápiz debajo de la burbuja del usuario. Al hacer clic alterna una tarjeta de corrección con estilo ámbar que muestra la frase corregida y notas en viñetas.

**`typewriterReveal(element, text, onDone, scrollContainer)`**

Divide el texto por espacios, establece cada palabra con un delay de 28ms. Hace scroll de `scrollContainer` al fondo en cada paso. Llama a `onDone` cuando termina.

**`runSessionTurn({ sessionKey, userText, ... })`**

Lado UI de un turno de conversación:

```
1. Push userText al session.history
2. userMsgWrapper = addChatMessage(container, "user", userText)
3. clearInputCallback()
4. insertTypingIndicator(container, assistantName)
5. setBusy(true)
6. await window.speakAI.processTurn(payload)
7. removeTypingIndicator(container)
8. addChatMessage(container, "assistant", assistantText, translatedText, true)
9. renderCorrectionBox(correctionBox, correction)
10. addUserCorrectionIcon(userMsgWrapper, correction)
11. si speech: renderSpeechFeedback() + reproductor de audio personalizado carga src
12. setBusy(false)
```

**`handleSpeechRecordingToggle()`**

Primera llamada: `navigator.mediaDevices.getUserMedia({ audio: true })` → crea `MediaRecorder` → `recorder.start()`.

Segunda llamada: `recorder.stop()` → `onstop` se dispara → `Blob(chunks)` → `arrayBuffer()` → `window.speakAI.transcribeAudio()` → `runSessionTurn()`.

---

### `GUI/renderer.js`

Punto de entrada. Se carga último. Contiene:

- `bindModalEvents()` — conecta los botones guardar/descartar/cancelar en el modal de cambios no guardados
- `bindEvents()` — todas las llamadas `addEventListener` para toda la app, incluyendo botones de historial
- `init()` — carga config → opciones → hidrata selectores → enlaza eventos → inicia reproductor de audio → refresca memoria
- `initCustomAudioPlayer()` — conecta la UI personalizada `#capPlayer` a los eventos del elemento nativo `<audio>` (loadedmetadata, timeupdate, play, pause, ended, emptied)
- `openHistoryModal()` / `closeHistoryModal()` — llama a `window.speakAI.listConversations()` y renderiza resultados en `#historyModalList`
- `window.addEventListener("beforeunload")` — dispara `finalizeConversation` para sesiones activas

Nada en este archivo debe contener lógica de negocio.

---

## 5. Turno de Conversación — Flujo Completo de Datos

```
[Renderer] Usuario presiona Enter
  │
  ▼
runSessionTurn()
  │  construye getCommonPayload()
  ▼
window.speakAI.processTurn(payload)   [IPC invoke]
  │
  ▼
[Main] ipcMain.handle("speakai:process-turn")
  │  getConfig()
  ▼
orchestrator.processTurn({ config, payload })
  │
  ├─► generateAssistantReply()    ──► callResponsesApi() ──► POST /responses
  │                                                           ← assistantText
  │
  ├─► generateCorrection()        ──► runLocalCorrection()  (local, sin API)
  │                                o generateGrammarWithLlm() (LLM, opcional)
  │                                           ← objeto correction
  │
  ├─► [await ambos arriba en paralelo]
  │
  ├─► maybeTranslate(assistantText) ──► translateText() ──► Google Translate
  │                                              ← translatedAssistantText
  │
  ├─► [solo speech] maybeTranslate(userText) ──► translatedUserText
  │
  ├─► [solo speech] buildSpeechDiagnostics()
  │
  └─► [si voiceEnabled] synthesizeSpeech() ──► POST ElevenLabs /text-to-speech
                                                  ← audioDataUrl (base64 mp3)
  │
  ▼
return { assistantText, translatedAssistantText, correction, audioDataUrl, speechDiagnostics }
  │
  ▼
[Renderer] removeTypingIndicator()
           addChatMessage("assistant", ..., animate=true)  ← efecto de escritura
           addUserCorrectionIcon(userMsgWrapper, correction)
           renderCorrectionBox(...)
           renderSpeechFeedback(...)     [solo speech]
           reproductor de audio personalizado carga src + reproduce  [solo speech, si autoPlay]
```

---

## 6. Sistema de Memoria

```
La sesión termina (clic en "Nueva Conversación" o beforeunload de ventana)
  │
  ▼
window.speakAI.finalizeConversation({ history, assistantName })
  │
  ▼
conversation-memory-orchestrator.finalizeConversation()
  │
  ├─► sanitizeHistory()   — filtra solo turnos de usuario/asistente
  │
  ├─► generateTalkSummary()  — LLM resume la conversación
  │     Instrucciones: "Crea un resumen corto de hasta 5 líneas.
  │                    Enfócate en objetivos del usuario, errores frecuentes,
  │                    ajustes solicitados, preferencias."
  │
  └─► saveTalkSummary()  — escribe ai_memory/talk_{N+1}.txt
                            N = número máximo de talk existente + 1

Inicio de siguiente sesión:
  ▼
getMemorySnapshot() → buildMemoryContext()
  │
  ├─► listTalkFiles() — lee ai_memory/, ordena por número de talk
  ├─► loadAllTalkSummaries() — lee cada .txt
  └─► une como:
        "Talk 1 summary:\n{content}\n\nTalk 2 summary:\n{content}\n\n..."

  ▼
state.memoryContext = snapshot.memoryContext
  │
  └─► inyectado en cada payload de processTurn como `memoryContext`
        → agregado al system prompt por buildBaseSpeechInstructions()
```

El modal de historial de conversaciones (`#historyModal`) llama a `window.speakAI.listConversations()` que lee los mismos archivos `talk_N.txt` y devuelve una vista previa (primeros 300 chars) de cada uno.

---

## 7. Motor de Corrección Gramatical

Dos motores, seleccionados vía `config.correction.engine`:

### `local_heuristic` (por defecto)

`src/conversation/local-grammar-engine.js` — corre en el proceso principal, sin llamada a API, latencia casi cero. Aplica reglas de patrones de `config.correction.localRules`. Devuelve `{ original, corrected, changed, notes }`.

### `llm`

Llama a `generateGrammarWithLlm()` que hace POST a la Responses API usando `config.prompts.grammarCompanionEnglish` como instrucciones. Más lento pero más detallado.

Ambos corren **en paralelo** con la llamada LLM principal de conversación dentro de `Promise.all`, por lo que no añaden latencia percibida.

Cuando `correction.original !== correction.corrected`, aparece un ícono de lápiz debajo de la burbuja del usuario. Al hacer clic abre una tarjeta ámbar inline con la frase corregida y notas explicativas.

---

## 8. Ingeniería de Prompts

### System prompt de conversación (ensamblado por `buildBaseSpeechInstructions`)

```
{speechBaseEnglish con {{assistantName}} sustituido}

TRAINING LANGUAGE FOR THIS SESSION: {languageLabel}.
You MUST respond only in this language.
Do not use, mention, or offer any other language.

User's native language (for your context only,
do NOT use it to respond): {nativeLanguageLabel}.

Learner level: {difficultyHint}

Context from previous conversations (use only as background memory):
Talk 1 summary: ...
Talk 2 summary: ...
```

### Reglas críticas del prompt base (`config.prompts.speechBaseEnglish`)

1. Responde **exclusivamente** en el idioma de entrenamiento — nunca cambies, menciones ni ofrezcas otros idiomas
2. Mantén las respuestas concisas; haz una pregunta de seguimiento
3. Nunca menciones gramática, corrección, modos de práctica, ni nada meta sobre el aprendizaje
4. Compórtate como un hablante nativo en charla casual
5. Nunca uses guiones (`-`), guiones em (`—`), guiones en (`–`), ni emojis

### Formato de input de conversación

```
User: {primer turno}
Assistant: {primera respuesta}
User: {mensaje actual}
Assistant:
```

El historial se recorta a `config.ui.maxHistoryMessages` (por defecto 20) para controlar el uso de tokens. El flag `store: false` evita que OpenAI cachee esta conversación.

---

## 9. Referencia del Esquema `config.json`

```jsonc
{
  "app": {
    "name": "SpeakAI",
    "defaultLanguageId": "en-US",        // BCP-47, debe existir en languages[]
    "defaultModeId": "conversation",
    "defaultVoiceId": "...",              // debe existir en voices[]
    "defaultThemeId": "studio",           // debe existir en themes.options[]
    "defaultDifficultyId": "beginner",    // debe existir en difficultyLevels[]
    "defaultAssistantName": "Ari"
  },

  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "transcriptionModel": "gpt-4o-mini-transcribe",
      "conversationModel": "gpt-5-mini",
      "grammarModel": "gpt-5-mini",
      "summaryModel": "gpt-5-mini"
    },
    "elevenlabs": {
      "baseUrl": "https://api.elevenlabs.io/v1",
      "modelId": "eleven_multilingual_v2",
      "outputFormat": "mp3_44100_128",
      "voiceSettings": {
        "stability": 0.45,
        "similarity_boost": 0.75,
        "style": 0.25,
        "use_speaker_boost": true
      }
    }
  },

  "prompts": {
    "speechBaseEnglish": "...",        // soporta token {{assistantName}}
    "grammarCompanionEnglish": "...",  // soporta token {{assistantName}}
    "talkSummaryEnglish": "..."        // sin tokens
  },

  "languages": [
    // 30 entradas
    { "id": "en-US", "label": "English (US)", "iso6391": "en" }
    // id: tag BCP-47 usado como clave en toda la app
    // iso6391: enviado a APIs de Whisper y traducción
  ],

  "difficultyLevels": [
    { "id": "beginner",     "label": "Principiante",  "promptHint": "..." },
    { "id": "intermediate", "label": "Intermedio",    "promptHint": "..." },
    { "id": "advanced",     "label": "Avanzado",      "promptHint": "..." }
  ],

  "voices": [
    {
      "id": "JBFqnCBsd6RMkjVDRZzb",  // ID de voz de ElevenLabs
      "label": "Rachel",
      "languageIds": ["en-US", "en-GB"]  // mostrado solo cuando estos idiomas están seleccionados
    }
  ],

  "themes": {
    "options": [
      {
        "id": "studio",
        "label": "Studio",
        "tokens": {
          "--bg": "#1a1a2e",
          "--surface": "#16213e",
          "--accent": "#7c6bc9"
          // ... conjunto completo de CSS custom properties
        }
      }
    ]
  },

  "translation": {
    "enabled": true,
    "defaultEnabled": true,
    "defaultTargetLanguageId": "pt-BR"
  },

  "correction": {
    "engine": "local_heuristic",   // "local_heuristic" | "llm"
    "enabledModeIds": ["conversation_with_correction"],
    "localRules": { ... }
  },

  "memory": {
    "folder": "ai_memory",
    "talkPrefix": "talk_"          // archivos: talk_1.txt, talk_2.txt, ...
  },

  "ui": {
    "autoPlayAssistantAudio": true,
    "assistantVoiceEnabled": true,
    "recordingMimeType": "audio/webm",
    "maxHistoryMessages": 20
  }
}
```

---

## 10. Sistema de Tokens CSS

Los temas se definen completamente en `config.json` como mapas de CSS custom properties. `applyTheme(themeId)` en `options-manager.js` itera el mapa de tokens y llama a `document.documentElement.style.setProperty(token, value)`.

Tokens principales usados en todo `main.css`:

| Token | Rol |
|---|---|
| `--bg` | Fondo de la app |
| `--surface` | Fondo de tarjeta / panel |
| `--surface-soft` | Superficie sutil (burbujas de mensajes de IA, reproductor de audio) |
| `--surface-strong` | Superficie más fuerte (estados hover, track de progreso) |
| `--border` | Color de borde predeterminado |
| `--text-main` | Texto primario |
| `--text-soft` | Texto secundario/placeholder |
| `--accent` | Color de marca (botones, scrollbars, chips, estados activos) |
| `--accent-strong` | Accent más oscuro para estados hover |
| `--ok` | Color de estado de éxito (también badge de clave API confirmada) |
| `--warn` | Color de error/advertencia (también acento de tarjeta de corrección) |
| `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` | Escala de border radius |
| `--shadow-sm` / `--shadow-md` | Valores de box shadow |

Las scrollbars usan `scrollbar-color: var(--accent) transparent` (Firefox) y `::-webkit-scrollbar-thumb { background: var(--accent) }` (Chromium/Electron). Aplicado consistentemente a: barra lateral, mensajes de chat, coach box, panel de opciones, lista de chips de idioma, lista del modal de historial.

---

## 11. Sistema i18n

### Cómo funciona

1. `TRANSLATIONS[langId]` devuelve un objeto plano de claves de strings
2. `tr(key)` — atajo que lee `state.options.appLanguageId` y devuelve `TRANSLATIONS[langId][key]`
3. `applyUiLanguage(langId)` — itera el DOM:
   - `[data-i18n="key"]` → establece `element.textContent = t[key]`
   - `[data-i18n-ph="key"]` → establece `element.placeholder = t[key]`
4. Se llama en `init()` y en cada evento de cambio de `appLanguageSelect`

### Tipos de claves especiales

| Tipo | Ejemplo | Uso |
|---|---|---|
| `string` | `"navGrammar": "Entrenamiento"` | Etiqueta estática |
| `function(name)` | `"typingIndicator": (name) => \`${name} está escribiendo...\`` | String dinámico con parámetro |
| `function(count)` | `"footerMemory": (count) => \`Memorias: ${count}\`` | String dinámico con parámetro |

### Agregar un nuevo idioma

1. Agrega el idioma a `config.json` `languages[]` con `id`, `label`, `iso6391`
2. Agrega una entrada completa a `TRANSLATIONS` en `GUI/i18n/translations.js`
3. El idioma aparecerá ahora en el selector de **Idioma de la App** en Opciones

> El idioma de la UI y el idioma de entrenamiento son independientes. Un usuario puede practicar japonés mientras la interfaz de la app está en español.

---

<p align="center">
  <sub>SpeakAI Referencia Técnica — mantenida junto al código fuente</sub>
</p>
