# Antigravity Tools

## 项目基础信息

- **技术栈**：React 19 + TypeScript 5.8 + Tauri v2 (Rust) + Vite 7 + Ant Design 5 + Tailwind CSS 3 + Zustand 5 + i18next (12 语言)
- **最低支持版本**：Node 20, Rust stable, macOS 10.15+, Windows 10+, Ubuntu 22.04+

## 项目结构

- `src/` — React 前端源码（组件、路由、状态管理、i18n）
- `src/locales/` — 国际化翻译文件（12 种语言）
- `src-tauri/` — Rust 后端（Tauri 应用、API 代理、协议转换）
- `docker/` — Docker 部署（Dockerfile、docker-compose 变体）
- `docs/` — 项目文档（API 参考、高级配置、代理文档）
- `scripts/` — 工具脚本（DMG 打包、PR 管理）
- `deploy/` — 部署脚本（Arch Linux）
- `public/` — 静态资源
- `web_site/` — GitHub Pages 静态站点

## 开发协议

本项目使用 `.claude/skills/protocol-dev/` 中的开发协议 skill，包含完整的工作流规范、commit 规范、调试规范等。生成提交信息时必须遵循 skill 协议中的 commit 规范。

### 关键约束

- 任何代码变更需求，必须先给方案，等待用户明确授权后才能执行
- 禁止使用 `rm` 删除文件，必须使用 `trash`
- `git commit` 流程：先输出 commit 信息供用户审核，用户确认后再执行提交，提交内容必须与展示内容完全一致，禁止附加任何辅助编程标识信息（如 Co-Authored-By 等）
- 禁止使用 Markdown 表格
- `git worktree` 规范：新建 worktree 时，必须将工作树创建在项目同级目录下，目录名格式为 `{项目名}--{分支名}`（分支名中的 `/` 替换为 `-`）。例如项目为 `Antigravity-Manager`，分支为 `feat/login`，则 worktree 路径为 `../Antigravity-Manager--feat-login/`。禁止使用默认的 `.git/worktrees` 或项目内部路径
