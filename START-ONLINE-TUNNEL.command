#!/bin/bash
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if [ -x "/usr/local/bin/node" ]; then
    NODE_CMD="/usr/local/bin/node"
else
    NODE_CMD="node"
fi

# Reset old ports
for p in 3000 8080; do
    PIDS=$(lsof -ti -sTCP:LISTEN :$p 2>/dev/null)
    if [ -n "$PIDS" ]; then
        kill -9 $PIDS 2>/dev/null
    fi
done
sleep 1

clear
echo "=================================================================="
echo "    🌐 I&hmong-mobile : เซิร์ฟเวอร์ออนไลน์ (มือถือเข้าได้ 100% ทุกที่)   "
echo "=================================================================="
echo ""

# Start server in background
$NODE_CMD server.js &
SERVER_PID=$!

cleanup() {
    echo ""
    echo "กำลังปิดระบบ..."
    kill $SERVER_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

sleep 1
open "http://localhost:3000" 2>/dev/null &

echo "🚀 เซิร์ฟเวอร์บ้านใหญ่ & บ้านเล็ก เริ่มทำงานแล้ว!"
echo "กำลังเชื่อมต่อระบบออนไลน์เพื่อสร้างลิงก์ HTTPS ให้มือถือเปิดกล้องสแกนได้..."
echo "------------------------------------------------------------------"
echo "💡 เมื่อเห็นลิงก์ https://...trycloudflare.com ปรากฏขึ้นมาด้านล่างนี้"
echo "   ให้เติม /scanner ต่อท้าย (เช่น https://...trycloudflare.com/scanner)"
echo "   แล้วเปิดใน Google Chrome หรือ Safari บนมือถือได้เลยทันที!"
echo "------------------------------------------------------------------"
echo ""

npx -y cloudflared tunnel --url http://localhost:3000
