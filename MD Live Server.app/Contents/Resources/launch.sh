#!/usr/bin/env bash
APP_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
if [ ! -f "$APP_ROOT/md-server.mjs" ]; then
  APP_ROOT="/Volumes/Data/App/MD Live Server"
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.volta/bin:$HOME/.fnm/current/bin:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_LATEST="$(ls -1d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -n 1)"
  [ -n "$NVM_LATEST" ] && export PATH="$NVM_LATEST:$PATH"
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  osascript -e 'display alert "MD Live Server" message "Không tìm thấy Node.js. Vui lòng cài đặt Node.js >= 18." as critical'
  exit 1
fi

PORT="3456"
if [ -f "$APP_ROOT/.env" ]; then
  ENV_PORT="$(grep -E '^PORT=' "$APP_ROOT/.env" | head -n 1 | cut -d '=' -f2 | tr -d '[:space:]"'\''')"
  [ -n "$ENV_PORT" ] && PORT="$ENV_PORT"
fi

if curl -fsS --max-time 1 "http://localhost:${PORT}/api/workspace" 2>/dev/null | grep -q '"md-live-server"'; then
  exit 0
fi

cd "$APP_ROOT"
nohup "$NODE_BIN" "$APP_ROOT/md-server.mjs" > "$APP_ROOT/.server.log" 2>&1 < /dev/null &
exit 0
