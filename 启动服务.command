#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "正在启动 Antigravity Tools 前端开发服务器..."
echo "  分支: $(git branch --show-current)"
echo "  前端地址: http://localhost:1420"
echo "  仅启动前端热重载，不包含 Rust 后端"
echo "按 Ctrl+C 停止服务"
echo "---"

npm run dev
