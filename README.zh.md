# Kaizhi

[English](./README.md) | 简体中文

面向团队的多功能 AI 网站：网页聊天、账号管理、API Key 分发、用量统计、Provider 管理、OAuth 授权和代理能力一体化。

## 主要功能

- **网页聊天**：会话列表、历史消息、附件上传、Markdown/代码渲染。
- **账号管理**：管理员初始化、用户创建、封禁、重置密码。
- **API Key**：用户自助创建、撤销 Key 用于对接第三方工具（Claude、Codex、Gemini、Droid 等），可设置 30/90/365 天或永不过期。
- **Provider 管理**：管理员配置 OAuth、API Key、OpenAI-compatible Provider，维护模型列表与路由。
- **用量统计**：按时间、API Key、模型查看用量。
- **Xray 代理**：内置 xray-core，支持 `vless://`、`socks5://`、`http(s)://` 上游代理。

## 环境变量

```bash
DATABASE_URL=postgres://kaizhi:kaizhi@127.0.0.1:5432/kaizhi?sslmode=disable
API_KEY_PEPPER=change-this-api-key-pepper
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-admin-password
KAIZHI_DATA_DIR=/data
KAIZHI_PROXY_URL=
KAIZHI_DEFAULT_LANGUAGE=zh-CN
```

- `API_KEY_PEPPER`：生产环境必须使用足够长的随机值，部署后不要更换。
- `KAIZHI_DATA_DIR`：运行时数据目录（`config.yaml`、OAuth 文件、附件等）。
- `KAIZHI_PROXY_URL`：可选上游代理，配置后通过内置 xray SOCKS5 出口。
- `KAIZHI_DEFAULT_LANGUAGE`：新建用户的默认语言，支持 `zh-CN` 或 `en-US`。

## 运行

### Docker

```bash
docker run -d \
  --name kaizhi \
  --restart unless-stopped \
  -p 8317:8317 \
  --env-file .env \
  -v kaizhi-data:/data \
  ghcr.io/kaizhi-ai/kaizhi-ai:latest
```

### 二进制

从 [Releases](https://github.com/kaizhi-ai/kaizhi-ai/releases) 下载对应架构的压缩包：

```bash
tar -xzf kaizhi-backend-vX.Y.Z-linux-amd64.tar.gz
cd kaizhi-backend-vX.Y.Z-linux-amd64
cp .env.example .env  # 按需修改

set -a; source .env; set +a
./kaizhi-backend
```

启动后访问 `http://127.0.0.1:8317`，使用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录。
