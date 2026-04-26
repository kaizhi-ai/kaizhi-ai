CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active',
	role TEXT NOT NULL DEFAULT 'user',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);

CREATE TABLE IF NOT EXISTS api_keys (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'user',
	key_prefix TEXT NOT NULL,
	key_hash TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL DEFAULT 'active',
	last_used_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	expires_at TIMESTAMPTZ,
	revoked_at TIMESTAMPTZ
);

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'user';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_status_idx ON api_keys(status);
CREATE INDEX IF NOT EXISTS api_keys_key_prefix_idx ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS api_keys_user_kind_idx ON api_keys(user_id, kind);

CREATE TABLE IF NOT EXISTS usage_events (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
	provider TEXT NOT NULL,
	model TEXT NOT NULL,
	upstream_auth_id TEXT,
	upstream_auth_index TEXT,
	upstream_auth_type TEXT,
	source TEXT,
	input_tokens BIGINT NOT NULL DEFAULT 0,
	output_tokens BIGINT NOT NULL DEFAULT 0,
	reasoning_tokens BIGINT NOT NULL DEFAULT 0,
	cached_tokens BIGINT NOT NULL DEFAULT 0,
	total_tokens BIGINT NOT NULL DEFAULT 0,
	latency_ms BIGINT NOT NULL DEFAULT 0,
	failed BOOLEAN NOT NULL DEFAULT false,
	requested_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_user_requested_idx ON usage_events(user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_api_key_requested_idx ON usage_events(api_key_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_model_requested_idx ON usage_events(model, requested_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_requested_idx ON usage_events(requested_at DESC);

CREATE TABLE IF NOT EXISTS usage_daily (
	day DATE NOT NULL,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
	provider TEXT NOT NULL,
	model TEXT NOT NULL,
	request_count BIGINT NOT NULL DEFAULT 0,
	failed_count BIGINT NOT NULL DEFAULT 0,
	input_tokens BIGINT NOT NULL DEFAULT 0,
	output_tokens BIGINT NOT NULL DEFAULT 0,
	reasoning_tokens BIGINT NOT NULL DEFAULT 0,
	cached_tokens BIGINT NOT NULL DEFAULT 0,
	total_tokens BIGINT NOT NULL DEFAULT 0,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (day, user_id, api_key_id, provider, model)
);

CREATE INDEX IF NOT EXISTS usage_daily_user_day_idx ON usage_daily(user_id, day DESC);
CREATE INDEX IF NOT EXISTS usage_daily_api_key_day_idx ON usage_daily(api_key_id, day DESC);

CREATE TABLE IF NOT EXISTS chat_sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx ON chat_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
	role TEXT NOT NULL,
	parts JSONB NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx ON chat_messages(session_id, created_at);
