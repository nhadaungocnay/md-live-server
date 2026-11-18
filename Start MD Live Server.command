#!/usr/bin/env bash
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "🚀 Đang khởi động MD Live Server..."
if command -v node >/dev/null 2>&1; then
  node "./md-server.mjs" --open
else
  echo "❌ Không tìm thấy Node.js. Vui lòng cài đặt Node.js >= 18."
  read -p "Nhấn Enter để đóng..."
  exit 1
fi
