@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>nul

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

echo [SpeakAI] Verificando Node.js e npm...

where node >nul 2>nul
if errorlevel 1 (
  echo [SpeakAI] Node.js nao encontrado. Instale Node.js LTS em https://nodejs.org/en/download
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [SpeakAI] npm nao encontrado. Reinstale o Node.js LTS.
  pause
  exit /b 1
)

echo [SpeakAI] Verificando node_modules (npm install)...
call npm.cmd install --silent --no-audit --no-fund
if errorlevel 1 (
  echo [SpeakAI] Falha ao atualizar dependencias.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo [SpeakAI] .env criado com base no .env.example.
  )
)

echo [SpeakAI] Iniciando GUI...
set "ELECTRON_RUN_AS_NODE="
call npm.cmd --silent run start
if errorlevel 1 (
  echo [SpeakAI] Erro ao iniciar a GUI.
  pause
  exit /b 1
)

endlocal
