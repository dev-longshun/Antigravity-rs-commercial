#!/bin/bash
cd "$(dirname "$0")"

# 隔离本地服务环境：使用独立数据目录和端口，避免与正式版/开发版冲突
export ABV_DATA_DIR="$HOME/.antigravity_tools_local"
export PORT=8047
export ABV_BIND_LOCAL_ONLY=false
export ABV_DIST_PATH="$(pwd)/dist"

# 首次运行时初始化数据目录
if [ ! -d "$ABV_DATA_DIR" ]; then
    mkdir -p "$ABV_DATA_DIR"
    echo "首次运行，已创建本地服务数据目录: $ABV_DATA_DIR"
fi

echo ""
echo "正在启动 Antigravity Tools 本地服务..."
echo "  分支: $(git branch --show-current)"
echo "  数据目录: $ABV_DATA_DIR"
echo "  服务端口: $PORT"
echo "  模式: headless (无 GUI)"
echo "按 Ctrl+C 停止服务"
echo "---"

# 构建前端
echo "📦 构建前端资源..."
npm run build || { echo "❌ 前端构建失败"; exit 1; }

# 编译后端（如果 binary 不存在或源码有更新）
BINARY="src-tauri/target/release/antigravity_tools"
if [ ! -f "$BINARY" ] || [ "$(find src-tauri/src -newer "$BINARY" -print -quit 2>/dev/null)" ]; then
    echo "🔨 编译 Rust 后端..."
    cd src-tauri && cargo build --release && cd ..
    if [ $? -ne 0 ]; then
        echo "❌ 后端编译失败"
        exit 1
    fi
fi

# 以 headless 模式启动服务
echo "🚀 启动 headless 服务..."
echo ""
"$BINARY" --headless
