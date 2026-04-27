# Repository Guidelines

## Project Purpose

Kaizhi is a multi-purpose AI platform for teams. A single service combines web chat, account management, user-issued API keys for third-party tools (Claude, Codex, Gemini, Droid, etc.), provider management (OAuth / API key / OpenAI-compatible), usage tracking, and an embedded xray-core proxy. The Go backend embeds CLIProxyAPI as the unified model entrypoint and serves the built React SPA from a single binary.

## Tech Stack

- **Backend**: Go (module `kaizhi/backend`), embeds CLIProxyAPI as the unified model entrypoint, PostgreSQL for persistence, embedded xray-core for upstream proxy support.
- **Frontend**: Vite + React 19 + TypeScript + Tailwind 4, with shadcn/ui and prompt-kit components; Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`) for chat streaming. `pnpm build` writes the SPA bundle to `backend/web/dist`, which is embedded into the Go binary through `backend/web/`.
- **Packaging**: single Go binary serving both the API and the SPA; multi-stage `Dockerfile` builds frontend then backend.

## Build, Test, and Development Commands

Backend commands run from `backend/` unless noted; frontend commands run from `frontend/`.

```bash
# backend: run with .env; runtime data lives under backend/data/
go run .

# backend: compile all packages
go build ./...

# backend: run all tests (PostgreSQL tests skip without TEST_DATABASE_URL)
go test ./...

# backend: PostgreSQL-backed integration tests
set -a; source .env; set +a
TEST_DATABASE_URL="$DATABASE_URL" go test ./... -count=1 -v

# frontend: dev server, production build, lint, format
pnpm dev
pnpm build
pnpm lint
pnpm format
```

The production binary embeds `backend/web/dist`, so run `pnpm build` from `frontend/` before `go build` from `backend/` when shipping.

Tests use Go's standard `testing` package plus `httptest`, colocated with the package they cover, named by behavior (e.g. `TestAuthRejectsWrongPassword`). PostgreSQL-backed tests must create isolated schemas through `internal/testutil` and clean them up.

## Coding Style & Naming Conventions

Go: standard formatting via `go fmt ./...`. Use short, package-oriented names (`users`, `apikeys`, `usage`, `postgres`, `provider`, `xrayproxy`). Keep HTTP handlers, stores, services, and providers in their owning package. Avoid mixing API key, usage, or provider logic back into `users`.

Frontend: TypeScript + React 19 with Prettier (`pnpm format`) and ESLint (`pnpm lint`). UI components live under `src/components/ui` (Radix/Base UI primitives); feature components are colocated by area (`chat`, `settings`, `admin`).

## Commit & Pull Request Guidelines

Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>)?: <subject>`. Keep the subject in lowercase imperative mood, under ~72 chars. Common types:

- `feat`: user-facing feature (`feat(apikeys): add user-managed key store`)
- `fix`: bug fix (`fix(auth): reject expired session keys`)
- `refactor`: code change without behavior change (`refactor(usage): split handlers`)
- `docs`, `test`, `chore`, `build`, `ci`, `perf`, `style`

Use scopes that match package or area names (`apikeys`, `provider`, `chat`, `frontend`, `docker`). Append `!` after the type/scope for breaking changes (`feat(apikeys)!: change key format`).

Pull requests should include a brief summary, test commands run, configuration changes, and any API route changes. Include screenshots only for frontend changes.

## Security & Configuration Tips

Never commit `.env`, `backend/data/`, generated data-dir contents, or compiled binaries. See `backend/.env.example` for required variables.

API key boundaries (don't break these):

- `kind='session'` keys (minted at login, 7-day sliding expiry) are accepted by both account/chat/usage APIs and the CLIProxy model entrypoint.
- `kind='user'` keys (created in the API keys UI, for external clients) are accepted **only** by the CLIProxy access provider — never by account/chat/usage APIs.
- `/api/v1/usage/api-keys` lists only `user` keys; web chat (session) traffic is rolled into `/api/v1/usage` totals without its own row.

## References

- shadcn/ui: https://ui.shadcn.com/llms.txt
- prompt-kit: https://www.prompt-kit.com/llms.txt
- Vercel AI SDK: https://ai-sdk.dev/llms.txt
