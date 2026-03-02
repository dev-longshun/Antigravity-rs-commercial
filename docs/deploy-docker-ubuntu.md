# Docker 部署指南（Ubuntu / 狗云等云服务器）

本文档提供在 Ubuntu 云服务器（如狗云、腾讯云、阿里云等）上通过 Docker 部署 Antigravity Manager 的完整步骤。

适用于将 Antigravity Manager 与 New API 等中转站部署在同一台或同机房服务器上，以消除中间跳转层、降低 SSE 流式响应的首字延迟。

## 前置条件

- Ubuntu 22.04+ 云服务器
- 已开放端口 `8045`（在云平台控制台的安全组/防火墙中放行）
- 已通过 SSH 登录到服务器

## 第一步：SSH 登录服务器

密码登录：

```bash
ssh root@你的服务器IP
```

密钥登录：

```bash
ssh -i /path/to/your-key.pem root@你的服务器IP
```

## 第二步：更新系统

```bash
apt update && apt upgrade -y
```

## 第三步：安装 Docker

```bash
# 一键安装 Docker
curl -fsSL https://get.docker.com | sh

# 设置 Docker 开机自启并立即启动
systemctl enable docker
systemctl start docker

# 验证安装成功（正常输出类似 Docker version 27.x.x）
docker --version
```

> **国内服务器注意**：如果 `get.docker.com` 下载缓慢，可使用阿里云镜像：
> ```bash
> curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun
> ```

## 第四步：启动 Antigravity Manager 容器

```bash
docker run -d \
  --name antigravity-manager \
  -p 8045:8045 \
  -e API_KEY=你的API密钥 \
  -e WEB_PASSWORD=你的管理后台密码 \
  -e ABV_MAX_BODY_SIZE=104857600 \
  -e ABV_BIND_LOCAL_ONLY=false \
  -v ~/.antigravity_tools:/root/.antigravity_tools \
  --restart unless-stopped \
  lbjlaq/antigravity-manager:latest
```

**参数说明：**

- `-d` — 后台运行容器
- `--name antigravity-manager` — 容器名称，后续管理时使用
- `-p 8045:8045` — 端口映射，将宿主机 8045 端口映射到容器的 8045 端口
- `-e API_KEY=你的API密钥` — 客户端（如 New API 中转站）调用 API 时使用的鉴权密钥，请设置一个强密码
- `-e WEB_PASSWORD=你的管理后台密码` — Web 管理界面登录密码，建议与 API_KEY 不同
- `-e ABV_MAX_BODY_SIZE=104857600` — 最大请求体限制为 100MB，避免传大图时出现 413 错误
- `-e ABV_BIND_LOCAL_ONLY=false` — 绑定 0.0.0.0，允许外部访问
- `-v ~/.antigravity_tools:/root/.antigravity_tools` — **关键！数据持久化挂载**，账号和配置存储在此目录下，不挂载则容器重启后数据丢失
- `--restart unless-stopped` — 容器异常退出或服务器重启后自动拉起

**鉴权逻辑：**

- **仅设置 API_KEY**：Web 登录和 API 调用都使用 API_KEY
- **同时设置 API_KEY + WEB_PASSWORD（推荐）**：Web 登录必须使用 WEB_PASSWORD，API 调用使用 API_KEY，实现管理权限与调用权限隔离

## 第五步：验证服务是否正常运行

```bash
# 查看容器运行状态（应显示 Status 为 Up）
docker ps

# 查看启动日志，确认无报错
docker logs antigravity-manager

# 测试服务是否响应
curl http://localhost:8045
```

用浏览器访问 `http://你的服务器IP:8045`，能看到管理界面说明部署成功。

## 第六步：在管理界面中导入账号

1. 浏览器打开 `http://你的服务器IP:8045`
2. 输入你设置的 `WEB_PASSWORD` 登录
3. 进入账号管理页面，添加你的 Claude 账号
4. 确认账号状态正常

## 第七步：修改 New API 中转站的上游地址

在 New API 中转站管理界面中，将上游渠道的 Base URL 修改为：

**Antigravity 与 New API 在同一台服务器上（推荐）：**

```
http://127.0.0.1:8045/v1
```

**Antigravity 与 New API 在不同服务器上：**

```
http://你的狗云服务器IP:8045/v1
```

上游密钥填写第四步中设置的 `API_KEY`。

## 防火墙配置

如果 `curl localhost:8045` 正常但外部无法访问，需要检查防火墙：

```bash
# Ubuntu UFW 防火墙放行 8045 端口
ufw allow 8045/tcp
ufw reload

# 确认端口已放行
ufw status
```

同时检查云平台控制台的安全组规则，确保入方向已放行 TCP 8045 端口。

## 可选：配置 HTTPS（Nginx 反代 + Let's Encrypt）

如果你有域名并且需要 HTTPS 访问：

### 安装 Nginx 和 Certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
```

### 创建 Nginx 配置

```bash
cat > /etc/nginx/sites-available/antigravity <<'EOF'
server {
    listen 80;
    server_name 你的域名;

    location / {
        proxy_pass http://127.0.0.1:8045;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 流式传输关键配置 - 禁用缓冲，降低首字延迟
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding on;

        # 超时设置（流式响应可能持续较长时间）
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF
```

> **重点**：`proxy_buffering off` 是降低 SSE 首字延迟的关键配置，它禁止 Nginx 缓冲流式数据，实现实时透传。

### 启用配置并申请 SSL 证书

```bash
# 启用站点配置
ln -s /etc/nginx/sites-available/antigravity /etc/nginx/sites-enabled/

# 检查配置语法并重载
nginx -t && systemctl reload nginx

# 申请 SSL 证书（自动配置 HTTPS）
certbot --nginx -d 你的域名
```

配置完成后，将 New API 的上游地址改为 `https://你的域名/v1`。

## 日常运维命令

```bash
# 查看实时日志
docker logs -f --tail=100 antigravity-manager

# 停止容器
docker stop antigravity-manager

# 启动容器
docker start antigravity-manager

# 重启容器
docker restart antigravity-manager

# 查看容器资源占用（CPU、内存等）
docker stats antigravity-manager
```

## 更新到最新版本

```bash
# 停止并删除旧容器（数据不会丢失，已通过 volume 挂载持久化）
docker stop antigravity-manager
docker rm antigravity-manager

# 拉取最新镜像
docker pull lbjlaq/antigravity-manager:latest

# 重新启动（使用第四步相同的 docker run 命令）
docker run -d \
  --name antigravity-manager \
  -p 8045:8045 \
  -e API_KEY=你的API密钥 \
  -e WEB_PASSWORD=你的管理后台密码 \
  -e ABV_MAX_BODY_SIZE=104857600 \
  -e ABV_BIND_LOCAL_ONLY=false \
  -v ~/.antigravity_tools:/root/.antigravity_tools \
  --restart unless-stopped \
  lbjlaq/antigravity-manager:latest
```

> **注意**：因为数据目录 `~/.antigravity_tools` 已挂载到宿主机，删除容器不会丢失账号和配置数据。

## 架构对比

部署到同机房服务器后，请求链路从：

```
用户 -> New API(香港) -> Zeabur(台北) -> Claude API -> 原路返回
                         ↑ 多一跳 + SSE 被平台缓冲
```

优化为：

```
用户 -> New API(香港) -> Antigravity(同机/本地) -> Claude API -> 原路返回
                         ↑ 本地通信，零额外延迟
```

首字延迟预计从 40-50 秒降至 Antigravity 本身的 6-8 秒。
