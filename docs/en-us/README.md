<p align="center">
  <img src="../../assets/without_background/logo_sem_fundo.png" alt="SpeakAI logo" width="220" />
</p>

<h1 align="center">SpeakAI</h1>

<p align="center">
  Desktop app for language learning through real AI conversation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js 18+" />
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/Electron-desktop-9feaf9?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/OpenAI-Whisper%20%7C%20GPT-412991?logo=openai" alt="OpenAI" />
  <img src="https://img.shields.io/badge/ElevenLabs-TTS-orange" alt="ElevenLabs" />
</p>

<p align="center">
  🌐 &nbsp;
  <a href="README.md"><img src="https://flagcdn.com/20x15/us.png" alt="en-US" /> English</a>
  &nbsp;|&nbsp;
  <a href="../pt-br/README.md"><img src="https://flagcdn.com/20x15/br.png" alt="pt-BR" /> Português</a>
  &nbsp;|&nbsp;
  <a href="../es-es/README.md"><img src="https://flagcdn.com/20x15/es.png" alt="es-ES" /> Español</a>
</p>

<p align="center">
  <a href="TECHNICAL.md">Technical Reference</a>
</p>

---

## What is SpeakAI?

SpeakAI is an Electron desktop app that puts you in a real conversation with an AI that speaks, listens, and corrects your grammar, all in the language you are learning. It combines three OpenAI/ElevenLabs APIs into a single seamless experience:

| Mode | What it does |
|---|---|
| **Text Training** | Chat with the AI; grammar corrections appear in a side panel |
| **Speech Conversation** | Record your voice, get it transcribed, replied to in audio |
| **Options** | Customize AI name, themes, languages, API keys, difficulty |

---

## Features

- **30 languages** for training (English, Portuguese, Spanish, French, German, Italian, Japanese, Chinese, and more)
- **Grammar correction** panel that runs in parallel on every message
- **Typing indicator** with animated dots while the AI thinks
- **Inline translate button** on every AI message, click to reveal, click again to hide
- **Conversation memory**, past conversations are summarized and reused as context
- **3 visual themes**, Studio, Night, Forest, with live preview
- **OS language detection**, app UI language auto-set on first run
- **Collapsible sidebar** with state persisted across sessions
- **API keys via GUI**, no need to edit `.env` manually

---

## Quick Start

**Requirements:** Node.js 18+, an OpenAI API key, an ElevenLabs API key (for voice).

```bash
# 1. Install dependencies
npm install

# 2. Configure API keys
copy .env.example .env
# Edit .env and fill in OPENAI_API_KEY and ELEVENLABS_API_KEY

# 3. Launch
npm run start
```

> **Windows shortcut:** double-click `start_speakai.bat`, it installs and launches automatically.
>
> You can also set API keys directly in the **Options** tab inside the app, without touching `.env`.

---

## Project Structure

```
SpeakAI/
│
├── src/                          # Electron main process (Node.js)
│   ├── main.js                   # App bootstrap, BrowserWindow, IPC handlers
│   ├── preload.js                # Context bridge, exposes speakAI.* to renderer
│   ├── config/
│   │   └── config-loader.js      # Reads and validates config.json
│   ├── clients/
│   │   ├── openai-client.js      # Whisper STT · Responses API LLM · TTS calls
│   │   └── translation-client.js # Google Translate (@vitalets/google-translate-api)
│   └── conversation/
│       ├── session-manager.js    # Orchestrates each conversation turn
│       └── memory-manager.js     # Reads/writes ai_memory/talk_N.txt files
│
├── GUI/                          # Renderer process (HTML + Vanilla JS, no bundler)
│   ├── index.html                # App shell, loads scripts in dependency order
│   ├── renderer.js               # Entry point: bindEvents() + init()
│   ├── core/
│   │   ├── app-state.js          # Global state object, DOM cache, storage keys
│   │   └── ui-utils.js           # setStatus, setBusy, toasts, i18n, sidebar, tabs
│   ├── modules/
│   │   ├── options-manager.js    # Config validation, options form, language chips
│   │   └── chat-session.js       # Chat rendering, typing indicator, session turns, audio
│   └── i18n/
│       └── translations.js       # UI strings for 6 languages (TRANSLATIONS object)
│
├── styles/
│   └── main.css                  # Design tokens (CSS vars), themes, layout, components
│
├── docs/
│   ├── pt-BR/README.md           # Portuguese documentation
│   └── en-US/README.md           # This file
│
├── assets/                       # Logos and icons
├── ai_memory/                    # Auto-generated conversation summaries (talk_N.txt)
├── config.json                   # Central config: prompts, models, languages, themes, voices
├── .env                          # API keys, never commit this file
├── .env.example                  # Template for .env
├── package.json
└── start_speakai.bat             # Windows one-click bootstrap
```

---

## Configuration (`config.json`)

All functional behavior is controlled from `config.json`, no code changes needed:

| Section | What it controls |
|---|---|
| `app` | Default assistant name, language, voice, theme, difficulty |
| `languages` | All 30 training languages (BCP-47 id, label, ISO 639-1 code) |
| `difficultyLevels` | Beginner / Intermediate / Advanced |
| `themes` | Studio / Night / Forest, each with a full set of CSS tokens |
| `voices` | ElevenLabs voices with supported language mappings |
| `prompts` | Base LLM instructions for text mode and speech mode |
| `translation` | Enable by default, default target language |
| `ui` | Auto-play audio, recording MIME type |

---

## GUI Script Loading Order

The renderer uses no bundler, scripts share global scope and must load in this exact order:

```
i18n/translations.js        →  TRANSLATIONS object (strings for 6 languages)
core/app-state.js           →  state, elements, storage key constants
core/ui-utils.js            →  setStatus, setBusy, showToast, tr(), applyUiLanguage
modules/options-manager.js  →  config validation, options form, selects, chips
modules/chat-session.js     →  chat messages, typing indicator, recording, session turns
renderer.js                 →  bindEvents(), init()  ← entry point, loaded last
```

---

## Text Interaction Flow

```
User types → textSendButton.click
  → runSessionTurn()
    → inserts message + typing indicator
    → window.speakAI.processTurn() [IPC]
      → session-manager.js → openai-client.js (LLM)
    → returns assistantText + correction
  → addChatMessage() displays reply with translate button
  → renderCorrectionBox() displays grammar feedback
```

---

## Speech Interaction Flow

```
speechRecordButton.click
  → handleSpeechRecordingToggle()
    → getUserMedia() → MediaRecorder starts
  → [2nd click] MediaRecorder stops
    → audio blob → arrayBuffer
    → window.speakAI.transcribeAudio() [IPC → Whisper]
    → transcript → runSessionTurn() (same as text flow)
      → backend generates audio via ElevenLabs
      → speechAudioPlayer.play() auto-plays response
```

---

## How Conversation Memory Works

1. User clicks **New Conversation** (or closes the app)
2. The current history is sent to `window.speakAI.finalizeConversation()`
3. The LLM generates a compact summary of the session
4. Summary is saved to `ai_memory/talk_N.txt`
5. On the next session, all `talk_*.txt` files are loaded as `memoryContext` and injected into the system prompt

---

## API References

- [OpenAI Speech-to-Text](https://platform.openai.com/docs/guides/speech-to-text)
- [OpenAI Responses API](https://platform.openai.com/docs/guides/responses-vs-chat-completions)
- [ElevenLabs Text-to-Speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/le0nardomartins">le0nardomartins</a>
</p>
