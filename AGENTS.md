# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains a Go backend and an empty frontend placeholder.

- `backend/`: Go module `kaizhi/backend`.
- `backend/main.go`: application entrypoint; embeds `CLIProxyAPI` and wires custom user, API key, and usage modules.
- `backend/internal/users/`: user CRUD, password hashing, and admin bootstrap.
- `backend/internal/auth/`: login/logout/me handlers and the API key Bearer middleware.
- `backend/internal/apikeys/`: user-managed and session API keys, hashing, expiry, and `cliproxy` access provider.
- `backend/internal/usage/`: usage recording plugin and usage query endpoints.
- `backend/internal/chats/`: chat session and message storage with HTTP handlers.
- `backend/internal/postgres/`: PostgreSQL connection and schema initialization.
- `backend/internal/testutil/`: shared integration test setup.
- `backend/config.yaml`: auto-generated `cliproxy` runtime configuration (recreated on first run if missing).
- `backend/.env.example`: local environment variable template.

Runtime data such as `backend/auths/`, `backend/.env`, and the compiled `backend/backend` binary must stay untracked.

## Build, Test, and Development Commands

Run commands from `backend/` unless noted otherwise.

```bash
go run .
```

Starts the backend using `config.yaml` and variables from `.env`.

```bash
go build ./...
```

Compiles all backend packages.

```bash
go test ./...
```

Runs all tests. PostgreSQL tests skip unless `TEST_DATABASE_URL` is set.

```bash
set -a; source .env; set +a
TEST_DATABASE_URL="$DATABASE_URL" go test ./internal/apikeys ./internal/users ./internal/usage -count=1 -v
```

Runs PostgreSQL-backed integration tests against a temporary schema.

## Coding Style & Naming Conventions

Use standard Go formatting. Run `gofmt` before committing:

```bash
gofmt -w main.go internal/**/*.go
```

Use short, package-oriented names: `users`, `apikeys`, `usage`, `postgres`. Keep HTTP handlers, stores, services, and providers in their owning package. Avoid mixing API key or usage logic back into `users`.

## Testing Guidelines

Tests use Go’s standard `testing` package plus `httptest`. Test files live next to the package they cover, for example:

- `internal/auth/auth_test.go`
- `internal/apikeys/api_keys_test.go`
- `internal/usage/usage_test.go`

Name tests by behavior, such as `TestAuthRejectsWrongPassword` or `TestAPIKeysRequireUserToken`. PostgreSQL tests must create isolated schemas through `internal/testutil` and clean them up.

## Commit & Pull Request Guidelines

The current history uses concise imperative commit messages, for example `Add CLIProxy backend`. Prefer messages like:

- `Add user API key store`
- `Split usage handlers`
- `Fix auth token validation`

Pull requests should include a brief summary, test commands run, configuration changes, and any API route changes. Include screenshots only for frontend changes.

## Security & Configuration Tips

Do not commit `.env`, generated auth files, or compiled binaries. Required backend variables are:

```bash
DATABASE_URL=postgres://...
API_KEY_PEPPER=...
```

Authentication uses opaque API keys end to end. Login mints a `kind='session'` key with an initial 7-day expiry that slides forward by 24 hours when used near expiry; the web client uses it both for account management / chat / usage APIs and for in-app model calls through the CLIProxy access provider. `kind='user'` keys are created in the API keys UI for external/programmatic clients (scripts, SDKs); they carry an optional `expires_at` (default 90 days) and are accepted only by the CLIProxy access provider, not by the account management / chat / usage APIs. The `/api/v1/usage/api-keys` breakdown lists only `kind='user'` keys — model traffic from the web chat (session keys) is rolled into the totals at `/api/v1/usage` but does not appear as its own row.
