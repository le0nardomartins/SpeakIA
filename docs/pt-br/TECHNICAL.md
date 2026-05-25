# SpeakAI — Referência Técnica

> Mergulho profundo na arquitetura, fluxos de dados, bridge IPC, engenharia de prompts e internals dos módulos.

<p align="center">
  🌐 &nbsp;
  <a href="../en-us/TECHNICAL.md"><img src="https://flagcdn.com/20x15/us.png" alt="en-US" /> English</a>
  &nbsp;|&nbsp;
  <a href="TECHNICAL.md"><img src="https://flagcdn.com/20x15/br.png" alt="pt-BR" /> Português</a>
  &nbsp;|&nbsp;
  <a href="../es-es/TECHNICAL.md"><img src="https://flagcdn.com/20x15/es.png" alt="es-ES" /> Español</a>
</p>

---

## Índice

1. [Modelo de Processos](#1-modelo-de-processos)
2. [Bridge IPC](#2-bridge-ipc)
3. [Backend — `src/`](#3-backend--src)
4. [Renderer — `GUI/`](#4-renderer--gui)
5. [Turno de Conversa — Fluxo Completo de Dados](#5-turno-de-conversa--fluxo-completo-de-dados)
6. [Sistema de Memória](#6-sistema-de-memória)
7. [Motor de Correção Gramatical](#7-motor-de-correção-gramatical)
8. [Engenharia de Prompts](#8-engenharia-de-prompts)
9. [Esquema de Referência do `config.json`](#9-esquema-de-referência-do-configjson)
10. [Sistema de Tokens CSS](#10-sistema-de-tokens-css)
11. [Sistema de i18n](#11-sistema-de-i18n)

---

## 1. Modelo de Processos

O SpeakAI é um app Electron padrão de dois processos. Os dois processos não podem compartilhar memória — eles se comunicam exclusivamente via IPC.

```
┌─────────────────────────────────────────────────────────────────┐
│  Processo Principal  (Node.js — src/)                           │
│                                                                 │
│  bootstrap()                                                    │
│    loadConfig()          — lê config.json para a memória        │
│    registerIpcHandlers() — registra os canais IPC speakai:*     │
│    createMainWindow()    — BrowserWindow, carrega GUI/index.html│
│                                                                 │
│  Em execução:                                                   │
│    ipcMain.handle("speakai:*", handler)                         │
│    → openai-client.js    (Whisper, Responses API)               │
│    → elevenlabs-client.js (TTS)                                 │
│    → translation-client.js (Google Translate)                   │
│    → memory-store.js     (leitura/escrita de talk_N.txt)        │
└────────────────────────────┬────────────────────────────────────┘
                             │  contextBridge (preload.js)
                             │  contextIsolation: true
                             │  nodeIntegration: false
                             │  sandbox: true
┌────────────────────────────▼────────────────────────────────────┐
│  Processo Renderer  (Vanilla JS — GUI/)                         │
│                                                                 │
│  window.speakAI.*  ← única superfície de API disponível        │
│                                                                 │
│  Ordem de carregamento dos scripts (index.html):                │
│    i18n/translations.js                                         │
│    core/app-state.js                                            │
│    core/ui-utils.js                                             │
│    modules/options-manager.js                                   │
│    modules/chat-session.js                                      │
│    renderer.js  ← init() chamado aqui                           │
└─────────────────────────────────────────────────────────────────┘
```

**Restrições de segurança:**
- `contextIsolation: true` — o renderer não tem acesso às APIs Node
- `nodeIntegration: false` — sem `require()` no renderer
- `sandbox: true` — o renderer roda em sandbox ao nível do SO
- `preload.js` é a única ponte e expõe exatamente 10 métodos

---

## 2. Bridge IPC

`preload.js` expõe `window.speakAI` via `contextBridge.exposeInMainWorld`. Cada chamada é um `ipcRenderer.invoke()` que mapeia para um `ipcMain.handle()` no `main.js`.

| `window.speakAI.*` | Canal IPC | Handler | Descrição |
|---|---|---|---|
| `getConfig()` | `speakai:get-config` | `getPublicConfig()` | Retorna config sanitizada (sem segredos) |
| `reloadConfig()` | `speakai:reload-config` | `loadConfig()` + `getPublicConfig()` | Recarrega `config.json` sem reiniciar |
| `transcribeAudio(payload)` | `speakai:transcribe-audio` | `transcribeAudio()` em openai-client | Envia blob de áudio ao Whisper STT |
| `processTurn(payload)` | `speakai:process-turn` | `processTurn()` no orchestrator | Turno completo (LLM + correção + TTS) |
| `getMemorySnapshot()` | `speakai:get-memory-snapshot` | `getMemorySnapshot()` | Retorna string `memoryContext` + `talkCount` |
| `finalizeConversation(payload)` | `speakai:finalize-conversation` | `finalizeConversation()` | Resume o histórico e salva em `talk_N.txt` |
| `listConversations()` | `speakai:list-conversations` | `loadAllTalkSummaries()` | Retorna lista de conversas salvas com preview |
| `getApiSettings()` | `speakai:get-api-settings` | `getApiKeySettings()` | Retorna quais chaves estão configuradas (não os valores) |
| `saveApiSettings(payload)` | `speakai:save-api-settings` | `saveApiKeySettings()` | Escreve as chaves no arquivo `.env` |
| `translateText(payload)` | `speakai:translate-text` | `translateText()` | Tradução de texto sob demanda |

### Formato do payload de `processTurn`

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

### Formato da resposta de `processTurn`

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
    "correctnessMessage": "Sua fala foi entendida e está correta."
  }
}
```

### Formato da resposta de `listConversations`

```json
[
  {
    "talkNumber": 1,
    "fileName": "talk_1.txt",
    "preview": "Primeiros 300 caracteres do resumo..."
  }
]
```

---

## 3. Backend — `src/`

### `main.js`

Ponto de entrada do bootstrap. Executa sequencialmente:

```
bootstrap()
  loadConfig()             — valida e faz cache do config.json
  registerIpcHandlers()    — registra 10 ipcMain.handle()
  app.whenReady()
  createMainWindow()       — BrowserWindow(1200×820, mín 980×680)
```

Configuração do `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `preload: src/preload.js`.

---

### `src/config/config-store.js`

Lê `config.json` uma vez na inicialização em um cache na memória. `getPublicConfig()` remove `providers.openai.apiKey` (se presente) antes de enviar ao renderer. `loadConfig()` pode ser chamado em tempo de execução para recarga a quente sem reiniciar.

---

### `src/config/env-file-store.js`

Lê e escreve `.env` usando `fs.readFileSync`/`fs.writeFileSync`. `saveApiKeySettings()` faz parse do arquivo existente, altera as linhas relevantes e sobrescreve — preservando todos os outros valores.

---

### `src/clients/openai-client.js`

Todas as chamadas OpenAI passam por `callResponsesApi()` que faz POST em `{baseUrl}/responses`:

```javascript
// Formato da requisição (OpenAI Responses API)
{
  model: "gpt-5-mini",
  instructions: "<system prompt>",
  input: "User: ...\nAssistant:",
  store: false
}
```

**Três chamadores:**

| Função | Chave de modelo no config | O que faz |
|---|---|---|
| `generateAssistantReply()` | `conversationModel` | Chamada principal ao LLM de conversa |
| `generateGrammarWithLlm()` | `grammarModel` | Coach gramatical baseado em LLM (opcional) |
| `generateTalkSummary()` | `summaryModel` | Resume o histórico para arquivo de memória |

**`transcribeAudio()`** faz POST em `{baseUrl}/audio/transcriptions` como `multipart/form-data` com o blob de áudio, modelo (`gpt-4o-mini-transcribe`) e código ISO 639-1 do idioma.

**`buildBaseSpeechInstructions()`** monta o system prompt concatenando seções na ordem:
1. Prompt base (`config.prompts.speechBaseEnglish`) com `{{assistantName}}` substituído
2. `TRAINING LANGUAGE FOR THIS SESSION: {label}. You MUST respond only in this language.`
3. `User's native language (for your context only, do NOT use it to respond): {label}.`
4. `Learner level: {difficultyHint}`
5. `Context from previous conversations:\n{memoryContext}` (se houver)

---

### `src/clients/elevenlabs-client.js`

Chama `POST {baseUrl}/text-to-speech/{voiceId}` com:

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

Retorna uma URL `data:audio/mp3;base64,...` pronta para o player de áudio customizado.

---

### `src/clients/translation-client.js`

Envolve `@vitalets/google-translate-api`. Sem necessidade de chave de API — usa o endpoint público do Google Translate. Usado para:
- Tradução automática das respostas da IA (se `translateAssistantReply: true`)
- Tradução da fala do usuário para o idioma nativo (modo fala)
- Tradução inline sob demanda pelo botão de tradução no chat

---

### `src/conversation/orchestrator.js`

`processTurn()` é o núcleo do app. Executa nesta sequência:

```
1. Resolve objetos de idioma, dificuldade e idioma nativo a partir do config
2. Corta o histórico para maxHistoryMessages (padrão 20)
3. EM PARALELO:
   a. generateAssistantReply()  — chamada ao LLM
   b. generateCorrection()      — verificação gramatical (heurística local ou LLM)
4. await Promise.all([assistantPromise, correctionPromise])
5. maybeTranslate(assistantText)  — apenas se translateAssistantReply=true
6. Se sessionType === "speech":
   a. Executa correção no texto do usuário (se ainda não feito)
   b. maybeTranslate(userText) → idioma nativo
   c. buildSpeechDiagnostics()
7. Se assistantVoiceEnabled && voiceId:
   a. synthesizeSpeech() → audioDataUrl
8. Retorna objeto de resultado completo
```

Os passos 3a e 3b executam **em paralelo** via `Promise.all` — a verificação gramatical não bloqueia a resposta da IA.

---

### `src/conversation/conversation-memory-orchestrator.js`

Camada fina sobre `memory-store.js`:

- `getMemorySnapshot(config)` — retorna `{ memoryContext: string, talkCount: number }`
- `finalizeConversation({ config, history, assistantName })`:
  1. Sanitiza o histórico (remove turnos que não são user/assistant, textos vazios)
  2. Se o histórico tem < 2 itens → pula o salvamento, retorna snapshot
  3. Chama `generateTalkSummary()` → string de resumo do LLM
  4. Chama `saveTalkSummary(config, summary)` → escreve `talk_N.txt`
  5. Retorna `{ saved, summary, fileName, memoryContext, talkCount }`

---

### `src/conversation/memory-store.js`

Operações puras de sistema de arquivos em `ai_memory/` (caminho a partir de `config.memory.folder`):

| Função | O que faz |
|---|---|
| `listTalkFiles(config)` | Lê o diretório, filtra padrão `talk_N.txt`, ordena por N |
| `loadAllTalkSummaries(config)` | Lê o conteúdo de cada arquivo, filtra os vazios |
| `buildMemoryContext(config)` | Junta todos os resumos como `"Talk N summary:\n{conteúdo}"` |
| `saveTalkSummary(config, summary)` | Escreve `talk_{max+1}.txt` com o resumo |

O `talkPrefix` (`talk_`) é configurável em `config.json`.

---

### `src/conversation/local-grammar-engine.js`

Verificador gramatical baseado em regras determinísticas. Executa quando `config.correction.engine = "local_heuristic"` (padrão). Retorna:

```json
{
  "original": "...",
  "corrected": "...",
  "changed": true,
  "notes": ["Possível problema: ..."]
}
```

Sem chamada de API — latência zero. O motor LLM (`config.correction.engine = "llm"`) chama `generateGrammarWithLlm()` em vez disso.

---

## 4. Renderer — `GUI/`

Sem bundler. Seis tags `<script>` no `index.html`. Todos os módulos compartilham o **escopo global do browser** — as funções exportadas de cada arquivo ficam disponíveis para todos os scripts carregados depois dele.

### `GUI/i18n/translations.js`

Exporta `TRANSLATIONS` — um objeto simples com chave no id BCP-47 do idioma:

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

**6 idiomas** têm traduções completas da interface. Todos os 30 idiomas de treinamento podem ser usados para conversação — apenas esses 6 traduzem a própria interface.

---

### `GUI/core/app-state.js`

Define dois globais compartilhados por todos os outros módulos:

**`state`** — o único objeto mutável da aplicação. Nunca armazene estado do app fora daqui.

```javascript
const state = {
  config: null,          // payload do config.json vindo do processo principal
  activeTab: "text",     // "text" | "speech" | "options"
  isBusy: false,         // bloqueia a UI durante o processamento da IA
  memoryContext: "",     // injetado em cada chamada processTurn
  memoryCount: 0,        // número de arquivos talk_N.txt
  options: null,         // preferências do usuário (do localStorage)
  optionsDirty: false,   // flag de opções com alterações não salvas
  sessions: {
    text:   { history: [] },
    speech: { history: [] }
  },
  speechRecording: {
    recorder: null,      // instância do MediaRecorder
    chunks:   [],        // fragmentos de Blob coletados
    stream:   null,      // stream do getUserMedia
    active:   false
  }
}
```

**`elements`** — cache DOM. Todas as chamadas `getElementById` / `querySelectorAll` acontecem uma vez no momento do parse, armazenadas aqui.

**Chaves de storage:**
- `speakai_user_options_v2` — chave localStorage para preferências do usuário
- `speakai_sidebar_collapsed_v1` — chave localStorage para estado da sidebar

---

### `GUI/core/ui-utils.js`

Funções utilitárias sem estado. As principais:

| Função | Propósito |
|---|---|
| `tr(key)` | Retorna string traduzida para `state.options.appLanguageId` |
| `applyUiLanguage(langId)` | Atualiza todos os elementos `[data-i18n]` e `[data-i18n-ph]` |
| `setStatus(message, type)` | Atualiza o badge de status no rodapé (ok = verde, error = âmbar) |
| `setBusy(value)` | Alterna `state.isBusy` + desabilita/habilita todos os controles interativos |
| `setMemoryBadge(count)` | Atualiza a exibição da contagem de memórias no rodapé |
| `showToast(message, type)` | Cria notificação temporária (auto-dismiss em 3,2s) |
| `setActiveTab(tabId)` | Troca o painel visível + botão de nav ativo |
| `openUnsavedModal(tab)` / `closeUnsavedModal()` | Controla o diálogo de alterações não salvas |
| `applySidebarCollapsed(bool)` | Alterna a classe `sidebar-collapsed` no `#layoutShell` |

---

### `GUI/modules/options-manager.js`

Gerencia o ciclo de vida das preferências do usuário:

```
loadStoredOptions()
  → localStorage.getItem(USER_OPTIONS_STORAGE_KEY)
  → normalizeOptions(raw)
    → getDefaultOptionsFromConfig()
      → detectDeviceLanguageId()   — combina navigator.languages com config.languages
      → hasAppLanguage(id)         — verifica se TRANSLATIONS[id] existe
    → valida cada campo no config (hasLanguage, hasDifficulty, hasTheme)
    → preenche campos ausentes com valores padrão
```

**Gerenciamento do estado das chaves de API:**
- `renderApiKeysState(settings)` — exibe um indicador verde "Chave configurada" abaixo de cada input quando a chave existe; atualiza o texto do placeholder; armazena o estado atual em `_apiKeysExist`
- `saveApiKeys()` — se chaves existentes seriam sobrescritas, exibe um modal de confirmação vermelho (`#apiKeyOverwriteModal`) antes de prosseguir
- `_doSaveApiKeys(openai, elevenlabs)` — lógica real de salvamento, chamada após confirmação

**UI de chips de idioma:** `renderTrainingLanguageChips()` cria `<button class="lang-chip">` com ícones de bandeira `<span class="fi fi-{code}">`. O clique remove o idioma se houver mais de um selecionado.

**Funções de populate:** `hydrateSelectors()` chama todas as funções de populate uma vez na inicialização (e após reload de config). Cada `populate*()` limpa e reconstrói seu `<select>` a partir de `state.config`.

---

### `GUI/modules/chat-session.js`

**`addChatMessage(container, role, text, translation, animate)`**

Retorna o elemento `div` wrapper. Para `role === "assistant"`:
- Adiciona um botão de tradução com ícone de globo (`<button class="msg-translate-btn">`)
- Se `animate === true`: revela o texto palavra a palavra via `typewriterReveal()` (28ms/palavra); o div de tradução é adicionado após a animação terminar
- Primeiro clique no botão de tradução: chama `window.speakAI.translateText()`, adiciona `<div class="msg-translation-annex">`
- Segundo clique: remove o elemento de anexo

**`addUserCorrectionIcon(wrapper, correction)`**

Chamada após a resposta da IA. Se `correction.original !== correction.corrected`, adiciona um botão com ícone de lápis abaixo da bolha do usuário. Clicar nele alterna um cartão de correção na cor âmbar mostrando a frase corrigida e notas explicativas.

**`typewriterReveal(element, text, onDone, scrollContainer)`**

Divide o texto por espaço, define cada palavra com delay de 28ms. Rola `scrollContainer` para o final a cada passo. Chama `onDone` ao terminar.

**`runSessionTurn({ sessionKey, userText, ... })`**

Lado UI de um turno de conversa:

```
1. Insere userText no session.history
2. userMsgWrapper = addChatMessage(container, "user", userText)
3. clearInputCallback()
4. insertTypingIndicator(container, assistantName)
5. setBusy(true)
6. await window.speakAI.processTurn(payload)
7. removeTypingIndicator(container)
8. addChatMessage(container, "assistant", assistantText, translatedText, true)
9. renderCorrectionBox(correctionBox, correction)
10. addUserCorrectionIcon(userMsgWrapper, correction)
11. se fala: renderSpeechFeedback() + player de áudio carrega src
12. setBusy(false)
```

**`handleSpeechRecordingToggle()`**

Primeira chamada: `navigator.mediaDevices.getUserMedia({ audio: true })` → cria `MediaRecorder` → `recorder.start()`.

Segunda chamada: `recorder.stop()` → `onstop` dispara → `Blob(chunks)` → `arrayBuffer()` → `window.speakAI.transcribeAudio()` → `runSessionTurn()`.

---

### `GUI/renderer.js`

Ponto de entrada. Carregado por último. Contém:

- `bindModalEvents()` — conecta os botões salvar/descartar/cancelar no modal de alterações não salvas
- `bindEvents()` — todos os `addEventListener` do app, incluindo botões de histórico
- `init()` — carrega config → opções → popula seletores → conecta eventos → inicializa player de áudio → atualiza memória
- `initCustomAudioPlayer()` — conecta o UI `#capPlayer` customizado aos eventos do elemento `<audio>` nativo (loadedmetadata, timeupdate, play, pause, ended, emptied)
- `openHistoryModal()` / `closeHistoryModal()` — chama `window.speakAI.listConversations()` e renderiza os resultados em `#historyModalList`
- `window.addEventListener("beforeunload")` — dispara `finalizeConversation` para sessões ativas

Nenhuma lógica de negócio deve estar neste arquivo.

---

## 5. Turno de Conversa — Fluxo Completo de Dados

```
[Renderer] Usuário pressiona Enter
  │
  ▼
runSessionTurn()
  │  monta getCommonPayload()
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
  ├─► generateCorrection()        ──► runLocalCorrection()  (local, sem API)
  │                                ou generateGrammarWithLlm() (LLM, opcional)
  │                                           ← objeto correction
  │
  ├─► [await ambos acima em paralelo]
  │
  ├─► maybeTranslate(assistantText) ──► translateText() ──► Google Translate
  │                                              ← translatedAssistantText
  │
  ├─► [só fala] maybeTranslate(userText) ──► translatedUserText
  │
  ├─► [só fala] buildSpeechDiagnostics()
  │
  └─► [se voiceEnabled] synthesizeSpeech() ──► POST ElevenLabs /text-to-speech
                                                  ← audioDataUrl (base64 mp3)
  │
  ▼
retorna { assistantText, translatedAssistantText, correction, audioDataUrl, speechDiagnostics }
  │
  ▼
[Renderer] removeTypingIndicator()
           addChatMessage("assistant", ..., animate=true)  ← efeito de digitação
           addUserCorrectionIcon(userMsgWrapper, correction)
           renderCorrectionBox(...)
           renderSpeechFeedback(...)     [só fala]
           player customizado carrega src e reproduz  [só fala, se autoPlay]
```

---

## 6. Sistema de Memória

```
Sessão termina (clica em "Nova Conversa" ou fecha a janela)
  │
  ▼
window.speakAI.finalizeConversation({ history, assistantName })
  │
  ▼
conversation-memory-orchestrator.finalizeConversation()
  │
  ├─► sanitizeHistory()   — filtra apenas turnos user/assistant
  │
  ├─► generateTalkSummary()  — LLM resume a conversa
  │     Instruções: "Crie um resumo curto em até 5 linhas.
  │                  Foque nos objetivos do usuário, erros frequentes,
  │                  ajustes solicitados, preferências."
  │
  └─► saveTalkSummary()  — escreve ai_memory/talk_{N+1}.txt
                            N = número máximo existente + 1

Próxima inicialização de sessão:
  ▼
getMemorySnapshot() → buildMemoryContext()
  │
  ├─► listTalkFiles() — lê ai_memory/, ordena por número de talk
  ├─► loadAllTalkSummaries() — lê cada .txt
  └─► junta como:
        "Talk 1 summary:\n{conteúdo}\n\nTalk 2 summary:\n{conteúdo}\n\n..."

  ▼
state.memoryContext = snapshot.memoryContext
  │
  └─► injetado em cada payload processTurn como `memoryContext`
        → adicionado ao system prompt por buildBaseSpeechInstructions()
```

O modal de histórico de conversas (`#historyModal`) chama `window.speakAI.listConversations()` que lê os mesmos arquivos `talk_N.txt` e retorna um preview (primeiros 300 caracteres) de cada um.

---

## 7. Motor de Correção Gramatical

Dois motores, selecionados via `config.correction.engine`:

### `local_heuristic` (padrão)

`src/conversation/local-grammar-engine.js` — executa no processo principal, sem chamada de API, latência quase zero. Aplica regras de padrão de `config.correction.localRules`. Retorna `{ original, corrected, changed, notes }`.

### `llm`

Chama `generateGrammarWithLlm()` que faz POST na Responses API usando `config.prompts.grammarCompanionEnglish` como instruções. Mais lento, mas mais preciso.

Ambos executam **em paralelo** com a chamada principal ao LLM de conversa dentro de `Promise.all`, então não adicionam latência percebida.

Quando `correction.original !== correction.corrected`, um ícone de lápis aparece abaixo da bolha de mensagem do usuário. Clicar nele abre um cartão inline na cor âmbar com a frase corrigida e notas explicativas.

---

## 8. Engenharia de Prompts

### System prompt de conversa (montado por `buildBaseSpeechInstructions`)

```
{speechBaseEnglish com {{assistantName}} substituído}

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

### Regras críticas do prompt base (`config.prompts.speechBaseEnglish`)

1. Responder **exclusivamente** no idioma de treinamento — nunca trocar, mencionar ou oferecer outros idiomas
2. Manter respostas concisas; fazer uma pergunta de acompanhamento
3. Nunca mencionar gramática, correção, modos de prática ou qualquer meta sobre aprendizado
4. Comportar-se como um falante nativo em chat casual
5. Nunca usar hífens (`-`), travessões (`—`), meia-risca (`–`) ou emojis

### Formato de entrada da conversa

```
User: {primeiro turno}
Assistant: {primeira resposta}
User: {mensagem atual}
Assistant:
```

O histórico é cortado para `config.ui.maxHistoryMessages` (padrão 20) para controlar o uso de tokens. A flag `store: false` impede o OpenAI de fazer cache desta conversa.

---

## 9. Esquema de Referência do `config.json`

```jsonc
{
  "app": {
    "name": "SpeakAI",
    "defaultLanguageId": "en-US",        // BCP-47, deve existir em languages[]
    "defaultModeId": "conversation",
    "defaultVoiceId": "...",              // deve existir em voices[]
    "defaultThemeId": "studio",           // deve existir em themes.options[]
    "defaultDifficultyId": "beginner",    // deve existir em difficultyLevels[]
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
        "stability": 0.45,          // 0–1, menor = mais expressivo
        "similarity_boost": 0.75,   // 0–1, maior = mais próximo da voz original
        "style": 0.25,
        "use_speaker_boost": true
      }
    }
  },

  "prompts": {
    "speechBaseEnglish": "...",        // suporta token {{assistantName}}
    "grammarCompanionEnglish": "...",  // suporta token {{assistantName}}
    "talkSummaryEnglish": "..."        // sem tokens
  },

  "languages": [
    // 30 entradas
    { "id": "en-US", "label": "English (US)", "iso6391": "en" }
    // id: tag BCP-47 usada como chave em todo o app
    // iso6391: enviado às APIs Whisper e de tradução
  ],

  "difficultyLevels": [
    { "id": "beginner",     "label": "Iniciante",     "promptHint": "..." },
    { "id": "intermediate", "label": "Intermediário",  "promptHint": "..." },
    { "id": "advanced",     "label": "Avançado",       "promptHint": "..." }
  ],

  "voices": [
    {
      "id": "JBFqnCBsd6RMkjVDRZzb",  // ID de voz ElevenLabs
      "label": "Rachel",
      "languageIds": ["en-US", "en-GB"]  // exibido apenas quando esses idiomas são selecionados
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
          // ... conjunto completo de propriedades CSS customizadas
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
    "talkPrefix": "talk_"          // arquivos: talk_1.txt, talk_2.txt, ...
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

Os temas são definidos inteiramente no `config.json` como mapas de propriedades CSS customizadas. `applyTheme(themeId)` no `options-manager.js` itera o mapa de tokens e chama `document.documentElement.style.setProperty(token, value)`.

Tokens principais usados em todo o `main.css`:

| Token | Papel |
|---|---|
| `--bg` | Background do app |
| `--surface` | Background de cards / painéis |
| `--surface-soft` | Surface sutil (bolhas de mensagens da IA, player de áudio) |
| `--surface-strong` | Surface mais forte (estados de hover, track de progresso) |
| `--border` | Cor de borda padrão |
| `--text-main` | Texto primário |
| `--text-soft` | Texto secundário / placeholder |
| `--accent` | Cor da marca (botões, scrollbars, chips, estados ativos) |
| `--accent-strong` | Accent mais escuro para estados de hover |
| `--ok` | Cor de status de sucesso (também badge de chave confirmada) |
| `--warn` | Cor de erro/aviso (também accent do cartão de correção) |
| `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` | Escala de border-radius |
| `--shadow-sm` / `--shadow-md` | Valores de box-shadow |

Scrollbars usam `scrollbar-color: var(--accent) transparent` (Firefox) e `::-webkit-scrollbar-thumb { background: var(--accent) }` (Chromium/Electron). Aplicado consistentemente em: sidebar, mensagens do chat, coach box, painel de opções, lista de chips de idioma, lista do modal de histórico.

---

## 11. Sistema de i18n

### Como funciona

1. `TRANSLATIONS[langId]` retorna um objeto plano de chaves de string
2. `tr(key)` — atalho que lê `state.options.appLanguageId` e retorna `TRANSLATIONS[langId][key]`
3. `applyUiLanguage(langId)` — itera o DOM:
   - `[data-i18n="key"]` → define `element.textContent = t[key]`
   - `[data-i18n-ph="key"]` → define `element.placeholder = t[key]`
4. Chamada em `init()` e em cada evento de mudança do `appLanguageSelect`

### Tipos especiais de chave

| Tipo | Exemplo | Uso |
|---|---|---|
| `string` | `"navGrammar": "Treino Gramatical"` | Label estático |
| `function(name)` | `"typingIndicator": (name) => \`${name} está digitando...\`` | String dinâmica com parâmetro |
| `function(count)` | `"footerMemory": (count) => \`Memórias: ${count}\`` | String dinâmica com parâmetro |

### Adicionando um novo idioma

1. Adicione o idioma em `config.json` `languages[]` com `id`, `label`, `iso6391`
2. Adicione uma entrada completa em `TRANSLATIONS` no `GUI/i18n/translations.js`
3. O idioma aparecerá no seletor de **Idioma do App** nas Opções

> Idioma da UI e idioma de treinamento são independentes. Um usuário pode praticar japonês enquanto a interface do app está em português.

---

<p align="center">
  <sub>SpeakAI Referência Técnica — mantida junto ao código-fonte</sub>
</p>
