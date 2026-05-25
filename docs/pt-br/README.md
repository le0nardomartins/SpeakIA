<p align="center">
  <img src="../../assets/without_background/logo_sem_fundo.png" alt="SpeakAI logo" width="220" />
</p>

<h1 align="center">SpeakAI</h1>

<p align="center">
  App desktop para aprendizado de idiomas através de conversação real com IA.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/licença-MIT-green" alt="Licença: MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js 18+" />
  <img src="https://img.shields.io/badge/plataforma-Windows-blue" alt="Plataforma: Windows" />
  <img src="https://img.shields.io/badge/Electron-desktop-9feaf9?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/OpenAI-Whisper%20%7C%20GPT-412991?logo=openai" alt="OpenAI" />
  <img src="https://img.shields.io/badge/ElevenLabs-TTS-orange" alt="ElevenLabs" />
</p>

<p align="center">
  🌐 &nbsp;
  <a href="../en-us/README.md"><img src="https://flagcdn.com/20x15/us.png" alt="en-US" /> English</a>
  &nbsp;|&nbsp;
  <a href="README.md"><img src="https://flagcdn.com/20x15/br.png" alt="pt-BR" /> Português</a>
  &nbsp;|&nbsp;
  <a href="../es-es/README.md"><img src="https://flagcdn.com/20x15/es.png" alt="es-ES" /> Español</a>
</p>

<p align="center">
  <a href="TECHNICAL.md">Referência Técnica</a>
</p>

---

## O que é o SpeakAI?

SpeakAI é um app desktop em Electron que coloca você em uma conversa real com uma IA que fala, ouve e corrige sua gramática — tudo no idioma que você está aprendendo. Ele combina três APIs (OpenAI e ElevenLabs) em uma única experiência integrada:

| Modo | O que faz |
|---|---|
| **Treino Textual** | Chat com a IA; correções gramaticais aparecem em um painel lateral |
| **Conversação por Voz** | Grave sua voz, seja transcrito, receba resposta em áudio |
| **Opções** | Personalize nome da IA, temas, idiomas, chaves de API, dificuldade |

---

## Funcionalidades

- **30 idiomas** para treino (inglês, português, espanhol, francês, alemão, italiano, japonês, chinês e mais)
- **Painel de correção gramatical** que roda em paralelo a cada mensagem
- **Indicador de digitação** com bolinhas animadas enquanto a IA processa
- **Botão de tradução inline** em cada mensagem da IA — clique para revelar, clique de novo para esconder
- **Memória de conversas** — sessões anteriores são resumidas e reutilizadas como contexto
- **3 temas visuais** — Studio, Night, Forest — com preview em tempo real
- **Detecção de idioma do SO** — idioma da interface configurado automaticamente na primeira execução
- **Sidebar colapsável** com estado persistido entre sessões
- **Chaves de API pela GUI** — sem precisar editar o `.env` manualmente

---

## Início Rápido

**Requisitos:** Node.js 18+, uma chave da OpenAI, uma chave da ElevenLabs (para voz).

```bash
# 1. Instalar dependências
npm install

# 2. Configurar chaves de API
copy .env.example .env
# Edite o .env e preencha OPENAI_API_KEY e ELEVENLABS_API_KEY

# 3. Iniciar
npm run start
```

> **Atalho Windows:** dê duplo clique em `start_speakai.bat` — ele instala e inicia automaticamente.
>
> Você também pode configurar as chaves diretamente na aba **Opções** dentro do app, sem tocar no `.env`.

---

## Estrutura do Projeto

```
SpeakAI/
│
├── src/                          # Processo principal do Electron (Node.js)
│   ├── main.js                   # Bootstrap, BrowserWindow, handlers IPC
│   ├── preload.js                # Bridge de contexto — expõe speakAI.* ao renderer
│   ├── config/
│   │   └── config-loader.js      # Lê e valida o config.json
│   ├── clients/
│   │   ├── openai-client.js      # Whisper STT · Responses API LLM · TTS
│   │   └── translation-client.js # Google Translate (@vitalets/google-translate-api)
│   └── conversation/
│       ├── session-manager.js    # Orquestra cada turno de conversa
│       └── memory-manager.js     # Lê/escreve ai_memory/talk_N.txt
│
├── GUI/                          # Processo renderer (HTML + Vanilla JS, sem bundler)
│   ├── index.html                # Shell do app — carrega scripts na ordem correta
│   ├── renderer.js               # Ponto de entrada: bindEvents() + init()
│   ├── core/
│   │   ├── app-state.js          # Objeto de estado global, cache DOM, constantes
│   │   └── ui-utils.js           # setStatus, setBusy, toasts, i18n, sidebar, abas
│   ├── modules/
│   │   ├── options-manager.js    # Validação de config, formulário de opções, chips
│   │   └── chat-session.js       # Mensagens, indicador de digitação, gravação, turnos
│   └── i18n/
│       └── translations.js       # Strings de UI para 6 idiomas (objeto TRANSLATIONS)
│
├── styles/
│   └── main.css                  # Tokens de design (CSS vars), temas, layout, componentes
│
├── docs/
│   ├── pt-BR/README.md           # Esta documentação (Português)
│   └── en-US/README.md           # Documentação em inglês
│
├── assets/                       # Logos e ícones
├── ai_memory/                    # Resumos de conversas gerados automaticamente (talk_N.txt)
├── config.json                   # Config central: prompts, modelos, idiomas, temas, vozes
├── .env                          # Chaves de API — nunca commitar este arquivo
├── .env.example                  # Template do .env
├── package.json
└── start_speakai.bat             # Bootstrap Windows com um clique
```

---

## Configuração (`config.json`)

Todo o comportamento funcional é controlado pelo `config.json` — sem precisar alterar código:

| Seção | O que controla |
|---|---|
| `app` | Nome padrão da IA, idioma, voz, tema e dificuldade padrão |
| `languages` | Os 30 idiomas de treino (BCP-47, label, código ISO 639-1) |
| `difficultyLevels` | Iniciante / Intermediário / Avançado |
| `themes` | Studio / Night / Forest — cada um com tokens CSS completos |
| `voices` | Vozes ElevenLabs com mapeamento de idiomas suportados |
| `prompts` | Instruções base do LLM para modo texto e modo fala |
| `translation` | Habilitado por padrão, idioma alvo padrão |
| `ui` | Auto-play de áudio, MIME type da gravação |

---

## Ordem de Carregamento dos Scripts (GUI)

O renderer não usa bundler — os scripts compartilham escopo global e devem carregar nesta ordem exata:

```
i18n/translations.js        →  objeto TRANSLATIONS (strings para 6 idiomas)
core/app-state.js           →  state, elements, constantes de storage
core/ui-utils.js            →  setStatus, setBusy, showToast, tr(), applyUiLanguage
modules/options-manager.js  →  validação de config, formulário, selects, chips
modules/chat-session.js     →  mensagens, indicador de digitação, gravação, turnos
renderer.js                 →  bindEvents(), init()  ← ponto de entrada, carregado por último
```

---

## Como Funciona a Memória de Conversas

1. Usuário clica em **Nova Conversa** (ou fecha o app)
2. O histórico atual é enviado para `window.speakAI.finalizeConversation()`
3. O LLM gera um resumo compacto da sessão
4. O resumo é salvo em `ai_memory/talk_N.txt`
5. Na próxima sessão, todos os `talk_*.txt` são carregados como `memoryContext` e injetados no system prompt

---

## Fluxo de uma Interação (Modo Texto)

```
Usuário digita → textSendButton.click
  → runSessionTurn()
    → insere mensagem + indicador de digitação
    → window.speakAI.processTurn() [IPC]
      → session-manager.js → openai-client.js (LLM)
    → retorna assistantText + correction
  → addChatMessage() exibe resposta com botão de tradução
  → renderCorrectionBox() exibe feedback gramatical
```

---

## Fluxo de uma Interação (Modo Fala)

```
speechRecordButton.click
  → handleSpeechRecordingToggle()
    → getUserMedia() → MediaRecorder inicia
  → [2º clique] MediaRecorder para
    → blob de áudio → arrayBuffer
    → window.speakAI.transcribeAudio() [IPC → Whisper]
    → transcrição → runSessionTurn() (mesmo fluxo do modo texto)
      → backend gera áudio via ElevenLabs
      → speechAudioPlayer.play() reproduz automaticamente
```

---

## Referências de API

- [OpenAI Speech-to-Text](https://platform.openai.com/docs/guides/speech-to-text)
- [OpenAI Responses API](https://platform.openai.com/docs/guides/responses-vs-chat-completions)
- [ElevenLabs Text-to-Speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

---

<p align="center">
  Feito com ❤️ por <a href="https://github.com/le0nardomartins">le0nardomartins</a>
</p>
