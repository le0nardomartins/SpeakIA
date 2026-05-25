# SpeakAI — Technical Reference

> Deep dive into the architecture, data flows, IPC bridge, prompt engineering, and module internals.

---

## Table of Contents

1. [Process Model](#1-process-model)
2. [IPC Bridge](#2-ipc-bridge)
3. [Backend — `src/`](#3-backend--src)
4. [Renderer — `GUI/`](#4-renderer--gui)
5. [Conversation Turn — Full Data Flow](#5-conversation-turn--full-data-flow)
6. [Memory System](#6-memory-system)
7. [Grammar Correction Engine](#7-grammar-correction-engine)
8. [Prompt Engineering](#8-prompt-engineering)
9. [`config.json` Schema Reference](#9-configjson-schema-reference)
10. [CSS Token System](#10-css-token-system)
11. [i18n System](#11-i18n-system)

---

## 1. Process Model

SpeakAI is a standard two-process Electron app. The two processes cannot share memory — they communicate exclusively through IPC.

```
┌─────────────────────────────────────────────────────────────────┐
│  Main Process  (Node.js — src/)                                 │
│                                                                 │
│  bootstrap()                                                    │
│    loadConfig()          — reads config.json into memory        │
│    registerIpcHandlers() — wires up speakai:* IPC channels      │
│    createMainWindow()    — BrowserWindow, loads GUI/index.html  │
│                                                                 │
│  Runtime:                                                       │
│    ipcMain.handle("speakai:*", handler)                         │
│    → openai-client.js    (Whisper, Responses API)               │
│    → elevenlabs-client.js (TTS)                                 │
│    → translation-client.js (Google Translate)                   │
│    → memory-store.js     (talk_N.txt read/write)                │
└────────────────────────────┬────────────────────────────────────┘
                             │  contextBridge (preload.js)
                             │  contextIsolation: true
                             │  nodeIntegration: false
                             │  sandbox: true
┌────────────────────────────▼────────────────────────────────────┐
│  Renderer Process  (Vanilla JS — GUI/)                          │
│                                                                 │
│  window.speakAI.*  ← only API surface available to renderer     │
│                                                                 │
│  Script load order (index.html):                                │
│    i18n/translations.js                                         │
│    core/app-state.js                                            │
│    core/ui-utils.js                                             │
│    modules/options-manager.js                                   │
│    modules/chat-session.js                                      │
│    renderer.js  ← init() called here                            │
└─────────────────────────────────────────────────────────────────┘
```

**Security constraints:**
- `contextIsolation: true` — renderer cannot access Node APIs
- `nodeIntegration: false` — no `require()` in renderer
- `sandbox: true` — renderer runs in OS-level sandbox
- `preload.js` is the only bridge and exposes exactly 9 methods

---

## 2. IPC Bridge

`preload.js` exposes `window.speakAI` via `contextBridge.exposeInMainWorld`. Every call is an `ipcRenderer.invoke()` that maps to an `ipcMain.handle()` in `main.js`.

| `window.speakAI.*` | IPC channel | Handler | Description |
|---|---|---|---|
| `getConfig()` | `speakai:get-config` | `getPublicConfig()` | Returns sanitized config (no secrets) |
| `reloadConfig()` | `speakai:reload-config` | `loadConfig()` + `getPublicConfig()` | Hot-reloads `config.json` without restart |
| `transcribeAudio(payload)` | `speakai:transcribe-audio` | `transcribeAudio()` in openai-client | Sends audio blob to Whisper STT |
| `processTurn(payload)` | `speakai:process-turn` | `processTurn()` in orchestrator | Full conversation turn (LLM + correction + TTS) |
| `getMemorySnapshot()` | `speakai:get-memory-snapshot` | `getMemorySnapshot()` | Returns `memoryContext` string + `talkCount` |
| `finalizeConversation(payload)` | `speakai:finalize-conversation` | `finalizeConversation()` | Summarizes history and saves to `talk_N.txt` |
| `getApiSettings()` | `speakai:get-api-settings` | `getApiKeySettings()` | Returns which keys are set (not their values) |
| `saveApiSettings(payload)` | `speakai:save-api-settings` | `saveApiKeySettings()` | Writes keys to `.env` file |
| `translateText(payload)` | `speakai:translate-text` | `translateText()` | On-demand text translation |

### `processTurn` payload shape

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

### `processTurn` response shape

```json
{
  "assistantText": "I'm doing great! What would you like to talk about?",
  "translatedAssistantText": "Estou ótimo! Sobre o que você gostaria de falar?",
  "correction": {
    "original": "Hello, how are you?",
    "corrected": "Hello, how are you?",
    "changed": false,
    "notes": []
  },
  "audioDataUrl": "data:audio/mp3;base64,...",
  "speechDiagnostics": {
    "understoodText": "Hello, how are you?",
    "translatedUserText": "Olá, como vai você?",
    "isLikelyCorrect": true,
    "suggestedText": "Hello, how are you?",
    "correctnessMessage": "Sua fala foi entendida e esta correta."
  }
}
```

---

## 3. Backend — `src/`

### `main.js`

Bootstrap entry point. Runs sequentially:

```
bootstrap()
  loadConfig()             — validates and caches config.json
  registerIpcHandlers()    — 9 ipcMain.handle() registrations
  app.whenReady()
  createMainWindow()       — BrowserWindow(1200×820, min 980×680)
```

`BrowserWindow` config: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `preload: src/preload.js`.

---

### `src/config/config-store.js`

Reads `config.json` once at startup into an in-memory cache. `getPublicConfig()` strips `providers.openai.apiKey` (if ever present) before sending to renderer. `loadConfig()` can be called at runtime to hot-reload without restarting.

---

### `src/config/env-file-store.js`

Reads and writes `.env` using `fs.readFileSync`/`fs.writeFileSync`. `saveApiKeySettings()` parses the existing file, patches the relevant lines, and overwrites — preserving all other values.

---

### `src/clients/openai-client.js`

All OpenAI calls go through `callResponsesApi()` which POSTs to `{baseUrl}/responses`:

```javascript
// Request shape (OpenAI Responses API)
{
  model: "gpt-5-mini",
  instructions: "<system prompt>",
  input: "User: ...\nAssistant:",
  store: false
}
```

**Three callers:**

| Function | Model config key | What it does |
|---|---|---|
| `generateAssistantReply()` | `conversationModel` | Main conversation LLM call |
| `generateGrammarWithLlm()` | `grammarModel` | LLM-based grammar coach (optional) |
| `generateTalkSummary()` | `summaryModel` | Summarizes history for memory file |

**`transcribeAudio()`** POSTs to `{baseUrl}/audio/transcriptions` as `multipart/form-data` with the audio blob, model (`gpt-4o-mini-transcribe`), and ISO 639-1 language code.

**`buildBaseSpeechInstructions()`** assembles the system prompt by concatenating sections in order:
1. Base prompt (`config.prompts.speechBaseEnglish`) with `{{assistantName}}` substituted
2. `TRAINING LANGUAGE FOR THIS SESSION: {label}. You MUST respond only in this language.`
3. `User's native language (for your context only, do NOT use it to respond): {label}.`
4. `Learner level: {difficultyHint}`
5. `Context from previous conversations:\n{memoryContext}` (if any)

---

### `src/clients/elevenlabs-client.js`

Calls `POST {baseUrl}/text-to-speech/{voiceId}` with:

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

Returns a `data:audio/mp3;base64,...` URL ready for `<audio>.src`.

---

### `src/clients/translation-client.js`

Wraps `@vitalets/google-translate-api`. No API key required — uses the public Google Translate endpoint. Used for:
- Auto-translating assistant replies (if `translateAssistantReply: true`)
- Translating user speech to native language (speech mode)
- On-demand inline translation from the translate button in chat

---

### `src/conversation/orchestrator.js`

`processTurn()` is the core of the app. It runs in this sequence:

```
1. Resolve language, difficulty, nativeLanguage objects from config
2. Trim history to maxHistoryMessages (default 20)
3. PARALLEL:
   a. generateAssistantReply()  — LLM call
   b. generateCorrection()      — grammar check (local heuristic or LLM)
4. await Promise.all([assistantPromise, correctionPromise])
5. maybeTranslate(assistantText)  — only if translateAssistantReply=true
6. If sessionType === "speech":
   a. Run correction on user text (if not already done)
   b. maybeTranslate(userText) → nativeLanguage
   c. buildSpeechDiagnostics()
7. If assistantVoiceEnabled && voiceId:
   a. synthesizeSpeech() → audioDataUrl
8. Return full result object
```

Steps 3a and 3b run **in parallel** via `Promise.all` — the grammar check does not block the AI reply.

---

### `src/conversation/conversation-memory-orchestrator.js`

Thin layer over `memory-store.js`:

- `getMemorySnapshot(config)` — returns `{ memoryContext: string, talkCount: number }`
- `finalizeConversation({ config, history, assistantName })`:
  1. Sanitizes history (removes non-user/assistant turns, empty texts)
  2. If history has < 2 items → skips save, returns snapshot
  3. Calls `generateTalkSummary()` → LLM summary string
  4. Calls `saveTalkSummary(config, summary)` → writes `talk_N.txt`
  5. Returns `{ saved, summary, fileName, memoryContext, talkCount }`

---

### `src/conversation/memory-store.js`

Pure filesystem operations on `ai_memory/` (path from `config.memory.folder`):

| Function | What it does |
|---|---|
| `listTalkFiles(config)` | Reads dir, filters `talk_N.txt` pattern, sorts by N |
| `loadAllTalkSummaries(config)` | Reads each file content, filters empty |
| `buildMemoryContext(config)` | Joins all summaries as `"Talk N summary:\n{content}"` |
| `saveTalkSummary(config, summary)` | Writes `talk_{max+1}.txt` with the summary |

The `talkPrefix` (`talk_`) is configurable in `config.json`.

---

### `src/conversation/local-grammar-engine.js`

Deterministic rule-based grammar checker. Runs when `config.correction.engine = "local_heuristic"` (default). Returns:

```json
{
  "original": "...",
  "corrected": "...",
  "changed": true,
  "notes": ["Possible issue: ..."]
}
```

No API call — zero latency. The LLM engine (`config.correction.engine = "llm"`) calls `generateGrammarWithLlm()` instead.

---

## 4. Renderer — `GUI/`

No bundler. Six `<script>` tags in `index.html`. All modules share the **browser global scope** — each file's exported functions are available to all scripts loaded after it.

### `GUI/i18n/translations.js`

Exports `TRANSLATIONS` — a plain object keyed by BCP-47 language id:

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

**6 languages** have complete UI translations. All 30 training languages can be used for conversation — only these 6 translate the interface itself.

---

### `GUI/core/app-state.js`

Defines two globals shared by all other modules:

**`state`** — the single mutable object. Never store app state outside this.

```javascript
const state = {
  config: null,          // config.json payload from main process
  activeTab: "text",     // "text" | "speech" | "options"
  isBusy: false,         // locks UI during AI processing
  memoryContext: "",     // injected into every processTurn call
  memoryCount: 0,        // number of talk_N.txt files
  options: null,         // user preferences (from localStorage)
  optionsDirty: false,   // unsaved options flag
  sessions: {
    text:   { history: [] },
    speech: { history: [] }
  },
  speechRecording: {
    recorder: null,      // MediaRecorder instance
    chunks:   [],        // Blob chunks collected
    stream:   null,      // getUserMedia stream
    active:   false
  }
}
```

**`elements`** — DOM cache. All `getElementById` / `querySelectorAll` calls happen once at parse time, stored here.

**Storage keys:**
- `speakai_user_options_v2` — localStorage key for user preferences
- `speakai_sidebar_collapsed_v1` — localStorage key for sidebar state

---

### `GUI/core/ui-utils.js`

Stateless utility functions. Key ones:

| Function | Purpose |
|---|---|
| `tr(key)` | Returns translated string for `state.options.appLanguageId` |
| `applyUiLanguage(langId)` | Updates all `[data-i18n]` and `[data-i18n-ph]` elements |
| `setStatus(message, type)` | Updates footer status badge (ok = green, error = amber) |
| `setBusy(value)` | Toggles `state.isBusy` + disables/enables all interactive controls |
| `setMemoryBadge(count)` | Updates footer memory count display |
| `showToast(message, type)` | Creates temporary notification (3.2s auto-dismiss) |
| `setActiveTab(tabId)` | Switches visible panel + active nav button |
| `openUnsavedModal(tab)` / `closeUnsavedModal()` | Controls the unsaved-changes dialog |
| `applySidebarCollapsed(bool)` | Toggles `sidebar-collapsed` class on `#layoutShell` |

---

### `GUI/modules/options-manager.js`

Manages user preferences lifecycle:

```
loadStoredOptions()
  → localStorage.getItem(USER_OPTIONS_STORAGE_KEY)
  → normalizeOptions(raw)
    → getDefaultOptionsFromConfig()
      → detectDeviceLanguageId()   — matches navigator.languages to config.languages
      → hasAppLanguage(id)         — checks if TRANSLATIONS[id] exists
    → validates each field against config (hasLanguage, hasDifficulty, hasTheme)
    → fills missing fields with defaults
```

**Language chip UI:** `renderTrainingLanguageChips()` creates `<button class="lang-chip">` with `<span class="fi fi-{code}">` flag icons. Click removes the language if more than one is selected.

**Populate functions:** `hydrateSelectors()` calls all populate functions once at init (and after config reload). Each `populate*()` clears and rebuilds its `<select>` from `state.config`.

---

### `GUI/modules/chat-session.js`

**`addChatMessage(container, role, text, translation)`**

For `role === "assistant"`, appends a translate button (`<button class="msg-translate-btn">`). The button has toggle state:
- First click: calls `window.speakAI.translateText()`, appends `<div class="msg-translation-annex">` to wrapper
- Second click: removes the annex element
- While loading: button disabled, `is-loading` class added

**`runSessionTurn({ sessionKey, userText, ... })`**

Core UI side of a conversation turn:

```
1. Push userText to session.history
2. addChatMessage(container, "user", userText)
3. clearInputCallback()   — clears the textarea
4. insertTypingIndicator(container, assistantName)
5. setBusy(true)
6. await window.speakAI.processTurn(payload)
7. removeTypingIndicator(container)
8. addChatMessage(container, "assistant", assistantText, translatedText)
9. renderCorrectionBox(correctionBox, correction)
10. if speech: renderSpeechFeedback() + maybe autoplay audio
11. setBusy(false)
```

**`handleSpeechRecordingToggle()`**

First call: `navigator.mediaDevices.getUserMedia({ audio: true })` → creates `MediaRecorder` → `recorder.start()`.

Second call: `recorder.stop()` → `onstop` fires → `Blob(chunks)` → `arrayBuffer()` → `window.speakAI.transcribeAudio()` → `runSessionTurn()`.

---

### `GUI/renderer.js`

Entry point. Loaded last. Contains only:

- `bindModalEvents()` — wires save/discard/cancel buttons in the unsaved-changes modal
- `bindEvents()` — all `addEventListener` calls for the entire app
- `init()` — loads config → options → hydrates selectors → binds events → refreshes memory
- `window.addEventListener("beforeunload")` — fires `finalizeConversation` for active sessions

Nothing in this file should contain business logic.

---

## 5. Conversation Turn — Full Data Flow

```
[Renderer] User presses Enter
  │
  ▼
runSessionTurn()
  │  builds getCommonPayload()
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
  ├─► generateCorrection()        ──► runLocalCorrection()  (local, no API)
  │                                or generateGrammarWithLlm() (LLM, optional)
  │                                           ← correction object
  │
  ├─► [await both above in parallel]
  │
  ├─► maybeTranslate(assistantText) ──► translateText() ──► Google Translate
  │                                              ← translatedAssistantText
  │
  ├─► [speech only] maybeTranslate(userText) ──► translatedUserText
  │
  ├─► [speech only] buildSpeechDiagnostics()
  │
  └─► [if voiceEnabled] synthesizeSpeech() ──► POST ElevenLabs /text-to-speech
                                                  ← audioDataUrl (base64 mp3)
  │
  ▼
return { assistantText, translatedAssistantText, correction, audioDataUrl, speechDiagnostics }
  │
  ▼
[Renderer] removeTypingIndicator()
           addChatMessage("assistant", ...)
           renderCorrectionBox(...)
           renderSpeechFeedback(...)     [speech only]
           speechAudioPlayer.play()     [speech only, if autoPlay]
```

---

## 6. Memory System

```
Session ends (click "New Conversation" or window beforeunload)
  │
  ▼
window.speakAI.finalizeConversation({ history, assistantName })
  │
  ▼
conversation-memory-orchestrator.finalizeConversation()
  │
  ├─► sanitizeHistory()   — filters to user/assistant turns only
  │
  ├─► generateTalkSummary()  — LLM summarizes the conversation
  │     Instructions: "Create a short summary in up to 5 lines.
  │                    Focus on user goals, frequent mistakes,
  │                    requested adjustments, preferences."
  │
  └─► saveTalkSummary()  — writes ai_memory/talk_{N+1}.txt
                            N = max existing talk number + 1

Next session startup:
  ▼
getMemorySnapshot() → buildMemoryContext()
  │
  ├─► listTalkFiles() — reads ai_memory/, sorts by talk number
  ├─► loadAllTalkSummaries() — reads each .txt
  └─► joins as:
        "Talk 1 summary:\n{content}\n\nTalk 2 summary:\n{content}\n\n..."

  ▼
state.memoryContext = snapshot.memoryContext
  │
  └─► injected into every processTurn payload as `memoryContext`
        → appended to system prompt by buildBaseSpeechInstructions()
```

---

## 7. Grammar Correction Engine

Two engines, selected via `config.correction.engine`:

### `local_heuristic` (default)

`src/conversation/local-grammar-engine.js` — runs in the main process, no API call, near-zero latency. Applies pattern rules from `config.correction.localRules`. Returns `{ original, corrected, changed, notes }`.

### `llm`

Calls `generateGrammarWithLlm()` which POSTs to Responses API using `config.prompts.grammarCompanionEnglish` as instructions. Slower but more thorough.

Both run **in parallel** with the main conversation LLM call inside `Promise.all`, so they don't add to perceived latency.

---

## 8. Prompt Engineering

### Conversation system prompt (assembled by `buildBaseSpeechInstructions`)

```
{speechBaseEnglish with {{assistantName}} substituted}

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

### Base prompt (`config.prompts.speechBaseEnglish`) critical rules

1. Respond **exclusively** in the training language — never switch, mention, or offer other languages
2. Keep replies concise; ask one follow-up question
3. Never mention grammar, correction, practice modes, or anything meta about learning
4. Behave like a native speaker in casual chat
5. Never use hyphens (`-`), em dashes (`—`), en dashes (`–`), or emojis

### Conversation input format

```
User: {first turn}
Assistant: {first reply}
User: {current message}
Assistant:
```

History is trimmed to `config.ui.maxHistoryMessages` (default 20) to control token usage. The `store: false` flag prevents OpenAI from caching this conversation.

---

## 9. `config.json` Schema Reference

```jsonc
{
  "app": {
    "name": "SpeakAI",
    "defaultLanguageId": "en-US",        // BCP-47, must exist in languages[]
    "defaultModeId": "conversation",
    "defaultVoiceId": "...",              // must exist in voices[]
    "defaultThemeId": "studio",           // must exist in themes.options[]
    "defaultDifficultyId": "beginner",    // must exist in difficultyLevels[]
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
        "stability": 0.45,          // 0–1, lower = more expressive
        "similarity_boost": 0.75,   // 0–1, higher = closer to original voice
        "style": 0.25,
        "use_speaker_boost": true
      }
    }
  },

  "prompts": {
    "speechBaseEnglish": "...",        // supports {{assistantName}} token
    "grammarCompanionEnglish": "...",  // supports {{assistantName}} token
    "talkSummaryEnglish": "..."        // no tokens
  },

  "languages": [
    // 30 entries
    { "id": "en-US", "label": "English (US)", "iso6391": "en" }
    // id: BCP-47 tag used as key throughout the app
    // iso6391: sent to Whisper and translation APIs
  ],

  "difficultyLevels": [
    { "id": "beginner",     "label": "Iniciante",     "promptHint": "..." },
    { "id": "intermediate", "label": "Intermediário",  "promptHint": "..." },
    { "id": "advanced",     "label": "Avançado",       "promptHint": "..." }
  ],

  "voices": [
    {
      "id": "JBFqnCBsd6RMkjVDRZzb",  // ElevenLabs voice ID
      "label": "Rachel",
      "languageIds": ["en-US", "en-GB"]  // shown only when these languages selected
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
          "--accent": "#7c6bc9",
          // ... full set of CSS custom properties
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
    "talkPrefix": "talk_"          // files: talk_1.txt, talk_2.txt, ...
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

## 10. CSS Token System

Themes are defined entirely in `config.json` as CSS custom property maps. `applyTheme(themeId)` in `options-manager.js` iterates the token map and calls `document.documentElement.style.setProperty(token, value)`.

Core tokens used throughout `main.css`:

| Token | Role |
|---|---|
| `--bg` | App background |
| `--surface` | Card / panel background |
| `--surface-soft` | Subtle surface (AI message bubbles) |
| `--border` | Default border color |
| `--text` | Primary text |
| `--text-muted` | Secondary/placeholder text |
| `--accent` | Brand color (buttons, scrollbars, chips, active states) |
| `--accent-fg` | Text on accent-colored backgrounds |
| `--ok` | Success status color |
| `--warn` | Error/warning color |
| `--radius-sm` / `--radius-lg` | Border radius scale |
| `--shadow` | Box shadow value |

Scrollbars use `scrollbar-color: var(--accent) transparent` (Firefox) and `::-webkit-scrollbar-thumb { background: var(--accent) }` (Chromium/Electron).

---

## 11. i18n System

### How it works

1. `TRANSLATIONS[langId]` returns a flat object of string keys
2. `tr(key)` — shortcut that reads `state.options.appLanguageId` and returns `TRANSLATIONS[langId][key]`
3. `applyUiLanguage(langId)` — iterates DOM:
   - `[data-i18n="key"]` → sets `element.textContent = t[key]`
   - `[data-i18n-ph="key"]` → sets `element.placeholder = t[key]`
4. Called at `init()` and on every `appLanguageSelect` change event

### Special key types

| Type | Example | Usage |
|---|---|---|
| `string` | `"navGrammar": "Grammar"` | Static label |
| `function(name)` | `"typingIndicator": (name) => \`${name} is typing...\`` | Dynamic string with param |
| `function(count)` | `"footerMemory": (count) => \`Memories: ${count}\`` | Dynamic string with param |

### Adding a new language

1. Add the language to `config.json` `languages[]` with `id`, `label`, `iso6391`
2. Add a complete entry to `TRANSLATIONS` in `GUI/i18n/translations.js`
3. The language will now appear in the **App Language** selector in Options

> UI language and training language are independent. A user can practice Japanese while the app interface is in Portuguese.

---

<p align="center">
  <sub>SpeakAI Technical Reference — maintained alongside the source code</sub>
</p>
