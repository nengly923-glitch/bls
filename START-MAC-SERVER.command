#!/bin/bash
cd "$(dirname "$0")"

# Set PATH to find Node.js
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# Auto-detect Node.js binary
if [ -x "/usr/local/bin/node" ]; then
    NODE_CMD="/usr/local/bin/node"
elif [ -x "/opt/homebrew/bin/node" ]; then
    NODE_CMD="/opt/homebrew/bin/node"
elif command -v node &> /dev/null; then
    NODE_CMD="node"
else
    echo "❌ ไม่พบโปรแกรม Node.js ในเครื่อง กรุณาติดตั้ง Node.js ก่อน"
    echo "กดปุ่มใดก็ได้เพื่อปิด..."
    read -n 1
    exit 1
fi

# Kill any old process on port 3000 and 8080 to ensure a clean start
echo "🔄 กำลังรีเซ็ตพอร์ตและเซิร์ฟเวอร์เก่า..."
for p in 3000 8080; do
    PIDS=$(lsof -ti -sTCP:LISTEN :$p 2>/dev/null)
    if [ -n "$PIDS" ]; then
        kill -9 $PIDS 2>/dev/null
    fi
done
sleep 1

# Detect Local Wi-Fi IP
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1)

clear
echo "=================================================================="
echo "    📱 I&hmong-mobile : เซิร์ฟเวอร์ระบบ 2 หน้าจอ (พร้อมใช้งาน)    "
echo "=================================================================="
echo ""
echo "✅ ตรวจพบ Node.js : $($NODE_CMD -v)"
echo "✅ ฐานข้อมูล SQLite : database.sqlite พร้อมใช้งาน"
echo "🚀 เซิร์ฟเวอร์กำลังรันทั้งบ้านใหญ่ (Mac) และบ้านเล็ก (มือถือ)..."
echo ""
echo "------------------------------------------------------------------"
echo "👉 ลิงก์สำหรับเข้าใช้งาน:"
echo ""
echo "   💻 1. บ้านใหญ่ (ระบบคิดเงิน & ฐานข้อมูล บนเครื่อง Mac นี้) :"
echo "         http://localhost:3000"
echo ""
if [ -n "$LOCAL_IP" ]; then
echo "   📱 2. บ้านเล็ก (เครื่องสแกนบาร์โค้ด บนโทรศัพท์มือถือ) :"
echo "         http://$LOCAL_IP:3000/scanner"
echo ""
echo "         (กล้องมือถือส่อง QR Code ที่เด้งขึ้นมาบนจอ Mac ได้เลย)"
fi
echo "------------------------------------------------------------------"
echo ""
echo "💡 หากต้องการหยุดการทำงาน ให้กดปุ่ม [ Ctrl + C ] หรือปิดหน้านี้"
echo "=================================================================="
echo ""

# Auto open Mac Master Station and QR Code Scanner
sleep 1
open "http://localhost:3000" 2>/dev/null &
open "สแกน QR Code เข้าเครื่องสแกนมือถือ.html" 2>/dev/null &

# Run Node.js Server
$NODE_CMD server.js
