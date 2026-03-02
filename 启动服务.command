#!/bin/bash
cd "$(dirname "$0")"

# 隔离本地服务环境：使用独立数据目录和端口，避免与正式版/开发版冲突
export ABV_DATA_DIR="$HOME/.antigravity_tools_local"
export PORT=8047
export ABV_BIND_LOCAL_ONLY=false

# 首次运行时初始化数据目录
if [ ! -d "$ABV_DATA_DIR" ]; then
    mkdir -p "$ABV_DATA_DIR"
    echo "首次运行，已创建本地服务数据目录: $ABV_DATA_DIR"
fi

echo ""
echo "正在启动 Antigravity Tools 本地服务..."
echo "  分支: $(git branch --show-current)"
echo "  数据目录: $ABV_DATA_DIR"
echo "  代理端口: $PORT"
echo "  模式: GUI 桌面应用"
echo "按 Ctrl+C 停止服务"
echo "---"

npm run tauri dev -- --config src-tauri/tauri.local.conf.json
EXIT_CODE=$?

# 异常退出时保留窗口
if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "❌ 服务异常退出，退出码: $EXIT_CODE"
    read -p "按 Enter 键关闭窗口..."
fi
