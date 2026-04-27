# Kaizhi

English | [简体中文](./README.zh.md)

A multi-purpose AI platform for teams: web chat, account management, API key distribution, usage tracking, provider management, OAuth authorization, and proxy support — all in one service.

## Features

- **Web Chat**: session list, message history, file attachments, Markdown/code rendering.
- **Account Management**: admin bootstrap, user creation, suspension, password reset.
- **API Keys**: users self-manage keys for third-party tools (Claude, Codex, Gemini, Droid, etc.), with 30/90/365-day or never-expire options.
- **Provider Management**: admins configure OAuth, API key, and OpenAI-compatible providers; maintain model lists and routing.
- **Usage Stats**: view usage by time range, API key, or model.
- **Xray Proxy**: built-in xray-core, supports `vless://`, `socks5://`, `http(s)://` upstream proxies.

## Environment Variables

```bash
DATABASE_URL=postgres://kaizhi:kaizhi@127.0.0.1:5432/kaizhi?sslmode=disable
API_KEY_PEPPER=change-this-api-key-pepper
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-admin-password
KAIZHI_DATA_DIR=/data
KAIZHI_PROXY_URL=
```

- `API_KEY_PEPPER`: must be a sufficiently long random value in production; do not change after deployment.
- `KAIZHI_DATA_DIR`: runtime data directory (`config.yaml`, OAuth files, attachments, etc.).
- `KAIZHI_PROXY_URL`: optional upstream proxy, routed through the built-in xray SOCKS5 outbound.

## Running

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

### Binary

Download the archive matching your architecture from [Releases](https://github.com/kaizhi-ai/kaizhi-ai/releases):

```bash
tar -xzf kaizhi-backend-vX.Y.Z-linux-amd64.tar.gz
cd kaizhi-backend-vX.Y.Z-linux-amd64
cp .env.example .env  # edit as needed

set -a; source .env; set +a
./kaizhi-backend
```

Once running, open `http://127.0.0.1:8317` and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
