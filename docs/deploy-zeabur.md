# Zeabur 部署指南

## 镜像地址

```
ghcr.io/dev-longshun/antigravity-manager:latest
```

## 部署步骤

### 1. 创建服务

Add Service → Prebuilt Image → 输入上方镜像地址

### 2. 挂载持久化卷

- Mount Directory：`/root/.antigravity_tools`
- 作用：保存账号数据与配置，防止重启丢失

### 3. 添加环境变量

在 Variables 中配置：

- `API_KEY` — 代理 API 密钥，客户端请求鉴权用（必填）
- `WEB_PASSWORD` — Web 管理后台登录密码（不设置则回退使用 API_KEY）
- `LOG_LEVEL` — 日志等级，可选 `debug` / `info` / `warn` / `error`，默认 `info`

以下变量已在镜像中预设，通常不需要修改：

- `PORT` — 默认 `8045`，支持通过环境变量覆盖（Zeabur 会自动注入）
- `ABV_BIND_LOCAL_ONLY` — 默认 `false`，已绑定 0.0.0.0
- `ABV_DIST_PATH` — 默认 `/app/dist`

### 4. 开放网络端口

在 Networking 中开放端口 `8045`（若通过环境变量修改了 PORT，则开放对应端口）

### 5. 健康检查（可选）

服务提供以下健康检查端点（均免鉴权）：

- `/health`
- `/healthz`
- `/api/health`

可在 Zeabur 的 Health Check 配置中填入 `/health`。

### 不需要配置的项

- **启动命令（Command）** — 镜像内置 `--headless` 模式，无需填写
- **Dockerfile** — 预构建镜像部署不适用

## 版本标签

- `latest` — 打 `v*` tag 时更新（正式版本）
- `beta` — 每次推送到 `main` 分支时更新

## 常见问题

### 账号数据重启后丢失

确保持久化卷正确挂载到 `/root/.antigravity_tools`。Zeabur 容器默认无状态，不挂载卷的话每次重启/重新部署数据都会清空。

### 镜像显示损坏

确认使用的标签存在。首次部署前需要先打一个 `v*` tag 触发 CI 构建才会生成 `latest` 标签。如果只推送了 main 分支，请使用 `beta` 标签。
