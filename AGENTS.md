# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains a Go backend and an empty frontend placeholder.

- `backend/`: Go module `kaizhi/backend`.
- `backend/main.go`: application entrypoint; embeds `CLIProxyAPI` and wires custom user, API key, and usage modules.
- `backend/internal/users/`: user registration, login, JWT, password hashing, and user storage.
- `backend/internal/apikeys/`: user API key creation, revocation, hashing, and `cliproxy` access provider.
- `backend/internal/usage/`: usage recording plugin and usage query endpoints.
- `backend/internal/postgres/`: PostgreSQL connection and schema initialization.
- `backend/internal/testutil/`: shared integration test setup.
- `backend/config.yaml`: `cliproxy` runtime configuration.
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

- `internal/users/auth_test.go`
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
JWT_SECRET=...
API_KEY_PEPPER=...
```

Use `MANAGEMENT_PASSWORD` only for administrator access to `cliproxy` management APIs. Production should keep `api-keys: []` in `config.yaml` so all model traffic goes through user-owned API keys and usage tracking.
