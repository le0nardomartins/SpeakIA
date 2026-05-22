# SpeakAI

Aplicativo desktop em Electron para treino de idiomas com:
- transcrição de voz (OpenAI),
- conversa com LLM (OpenAI),
- resposta em voz (ElevenLabs),
- modo paralelo de correção/coach,
- memória de conversas em `ai_memory/talk_n.txt`.
- menu lateral com abas: texto, fala e opções.

## Setup rápido

1. Instale dependências:
   - `npm install`
2. Crie o `.env`:
   - copie `.env.example` para `.env`
3. Preencha no `.env`:
   - `OPENAI_API_KEY=...`
   - `ELEVENLABS_API_KEY=...`
4. Rode:
   - `npm run start`

No Windows, use `start_speakai.bat` para instalar e iniciar automaticamente.

## Configuração central

Toda configuração funcional (prompts, modelos, dificuldade, temas, vozes, idiomas, modos, memória) está em:
- [config.json](C:/Users/leona/Desktop/SpeakIA/config.json)

As chaves de API ficam somente no `.env` e podem ser salvas direto pela aba `Opções` da GUI.

## Funcionalidades principais

- Nome da IA alterável na GUI.
- Prompt base principal em inglês, com instrução para responder sempre no idioma do usuário.
- Dificuldade selecionável (`Iniciante`, `Intermediário`, `Avançado`) e enviada para o prompt.
- Tradução opcional da resposta da IA por biblioteca JS (`@vitalets/google-translate-api`).
- Idioma treinado solicitado em toda interação (texto e fala).
- Idioma nativo, idiomas sempre treinados e diagnósticos de fala configuráveis em `Opções`.
- Ao iniciar nova conversa:
  - a conversa atual é resumida pela IA,
  - o resumo é salvo em `ai_memory/talk_n.txt`,
  - os `talk_n` existentes viram contexto para a próxima conversa.
- Mensagem textual da IA aparece no chat ao mesmo tempo em que o áudio toca.

## Estrutura

- GUI: [GUI/index.html](C:/Users/leona/Desktop/SpeakIA/GUI/index.html), [GUI/renderer.js](C:/Users/leona/Desktop/SpeakIA/GUI/renderer.js)
- Estilos: [styles/main.css](C:/Users/leona/Desktop/SpeakIA/styles/main.css)
- Electron main/preload: [src/main.js](C:/Users/leona/Desktop/SpeakIA/src/main.js), [src/preload.js](C:/Users/leona/Desktop/SpeakIA/src/preload.js)
- Config: [src/config](C:/Users/leona/Desktop/SpeakIA/src/config)
- Clients: [src/clients](C:/Users/leona/Desktop/SpeakIA/src/clients)
- Conversation: [src/conversation](C:/Users/leona/Desktop/SpeakIA/src/conversation)
- Bootstrap Windows: [start_speakai.bat](C:/Users/leona/Desktop/SpeakIA/start_speakai.bat)

## Referencias de API

- OpenAI Speech-to-Text: https://platform.openai.com/docs/guides/speech-to-text
- OpenAI Responses API: https://platform.openai.com/docs/guides/responses-vs-chat-completions
- ElevenLabs Text-to-Speech: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
