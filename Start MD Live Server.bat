@echo off
cd /d "%~dp0"
echo Starting MD Live Server...
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js not found. Please install Node.js 18 or higher from https://nodejs.org/
  pause
  exit /b 1
)
node "%~dp0md-server.mjs" --open
if %errorlevel% neq 0 pause
