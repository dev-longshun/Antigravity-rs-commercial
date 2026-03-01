#!/bin/bash
cd "$(dirname "$0")"

# 隔离开发环境：使用独立数据目录，避免与正式版冲突
export ABV_DATA_DIR="$HOME/.antigravity_tools_dev"

# 首次运行时初始化开发数据目录，设置代理端口为 8046
if [ ! -d "$ABV_DATA_DIR" ]; then
    mkdir -p "$ABV_DATA_DIR"
    echo "首次运行，已创建开发数据目录: $ABV_DATA_DIR"
fi

echo ""
echo "正在启动 Antigravity Tools 开发模式..."
echo "  分支: $(git branch --show-current)"
echo "  数据目录: $ABV_DATA_DIR"
echo "  代理端口: 请在开发版界面中设置为 8046 以避免与正式版冲突"
echo "  前端地址: http://localhost:1420"
echo "按 Ctrl+C 停止服务"
echo "---"

npm run tauri dev -- --config src-tauri/tauri.dev.conf.json
