CREATE TABLE IF NOT EXISTS model_prices (
	id TEXT PRIMARY KEY,
	model TEXT NOT NULL,
	input_usd_per_million NUMERIC(20, 8) NOT NULL DEFAULT 0,
	cache_read_usd_per_million NUMERIC(20, 8),
	cache_write_usd_per_million NUMERIC(20, 8),
	output_usd_per_million NUMERIC(20, 8) NOT NULL DEFAULT 0,
	reasoning_usd_per_million NUMERIC(20, 8),
	note TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS model_prices_model_idx
	ON model_prices(model);

ALTER TABLE usage_events
	ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS cache_write_tokens BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS input_usd_per_million_snapshot NUMERIC(20, 8),
	ADD COLUMN IF NOT EXISTS cache_read_usd_per_million_snapshot NUMERIC(20, 8),
	ADD COLUMN IF NOT EXISTS cache_write_usd_per_million_snapshot NUMERIC(20, 8),
	ADD COLUMN IF NOT EXISTS output_usd_per_million_snapshot NUMERIC(20, 8),
	ADD COLUMN IF NOT EXISTS reasoning_usd_per_million_snapshot NUMERIC(20, 8),
	ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(30, 12) NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS price_missing BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE usage_daily
	ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS cache_write_tokens BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(30, 12) NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS unpriced_tokens BIGINT NOT NULL DEFAULT 0;

UPDATE usage_events
SET cache_read_tokens = cached_tokens
WHERE cached_tokens > 0
  AND cache_read_tokens = 0
  AND cache_write_tokens = 0;

UPDATE usage_daily
SET cache_read_tokens = cached_tokens
WHERE cached_tokens > 0
  AND cache_read_tokens = 0
  AND cache_write_tokens = 0;

UPDATE usage_events ue
SET input_usd_per_million_snapshot = mp.input_usd_per_million,
	cache_read_usd_per_million_snapshot = COALESCE(mp.cache_read_usd_per_million, mp.input_usd_per_million),
	cache_write_usd_per_million_snapshot = COALESCE(mp.cache_write_usd_per_million, mp.input_usd_per_million),
	output_usd_per_million_snapshot = mp.output_usd_per_million,
	reasoning_usd_per_million_snapshot = COALESCE(mp.reasoning_usd_per_million, mp.output_usd_per_million),
	estimated_cost_usd = (
		GREATEST(ue.input_tokens - ue.cache_read_tokens - ue.cache_write_tokens, 0)::numeric * mp.input_usd_per_million
		+ ue.cache_read_tokens::numeric * COALESCE(mp.cache_read_usd_per_million, mp.input_usd_per_million)
		+ ue.cache_write_tokens::numeric * COALESCE(mp.cache_write_usd_per_million, mp.input_usd_per_million)
		+ (
			CASE
			WHEN ue.reasoning_tokens > 0 AND ue.total_tokens < ue.input_tokens + ue.output_tokens + ue.reasoning_tokens
				THEN GREATEST(ue.output_tokens - ue.reasoning_tokens, 0)
			ELSE ue.output_tokens
			END
		)::numeric * mp.output_usd_per_million
		+ ue.reasoning_tokens::numeric * COALESCE(mp.reasoning_usd_per_million, mp.output_usd_per_million)
	) / 1000000,
	price_missing = false
FROM model_prices mp
WHERE mp.model = ue.model;

WITH event_daily AS (
	SELECT
		(requested_at AT TIME ZONE 'UTC')::date AS day,
		user_id,
		api_key_id,
		provider,
		model,
		SUM(estimated_cost_usd) AS estimated_cost_usd,
		SUM(CASE WHEN price_missing THEN total_tokens ELSE 0 END) AS unpriced_tokens
	FROM usage_events
	GROUP BY (requested_at AT TIME ZONE 'UTC')::date, user_id, api_key_id, provider, model
)
UPDATE usage_daily ud
SET estimated_cost_usd = ed.estimated_cost_usd,
	unpriced_tokens = ed.unpriced_tokens
FROM event_daily ed
WHERE ud.day = ed.day
  AND ud.user_id = ed.user_id
  AND ud.api_key_id = ed.api_key_id
  AND ud.provider = ed.provider
  AND ud.model = ed.model;

UPDATE usage_daily ud
SET estimated_cost_usd = (
		GREATEST(ud.input_tokens - ud.cache_read_tokens - ud.cache_write_tokens, 0)::numeric * mp.input_usd_per_million
		+ ud.cache_read_tokens::numeric * COALESCE(mp.cache_read_usd_per_million, mp.input_usd_per_million)
		+ ud.cache_write_tokens::numeric * COALESCE(mp.cache_write_usd_per_million, mp.input_usd_per_million)
		+ (
			CASE
			WHEN ud.reasoning_tokens > 0 AND ud.total_tokens < ud.input_tokens + ud.output_tokens + ud.reasoning_tokens
				THEN GREATEST(ud.output_tokens - ud.reasoning_tokens, 0)
			ELSE ud.output_tokens
			END
		)::numeric * mp.output_usd_per_million
		+ ud.reasoning_tokens::numeric * COALESCE(mp.reasoning_usd_per_million, mp.output_usd_per_million)
	) / 1000000,
	unpriced_tokens = 0
FROM model_prices mp
WHERE mp.model = ud.model
  AND NOT EXISTS (
	SELECT 1
	FROM usage_events ue
	WHERE (ue.requested_at AT TIME ZONE 'UTC')::date = ud.day
	  AND ue.user_id = ud.user_id
	  AND ue.api_key_id = ud.api_key_id
	  AND ue.provider = ud.provider
	  AND ue.model = ud.model
  );

UPDATE usage_daily ud
SET estimated_cost_usd = 0,
	unpriced_tokens = ud.total_tokens
WHERE NOT EXISTS (
	SELECT 1
	FROM usage_events ue
	WHERE (ue.requested_at AT TIME ZONE 'UTC')::date = ud.day
	  AND ue.user_id = ud.user_id
	  AND ue.api_key_id = ud.api_key_id
	  AND ue.provider = ud.provider
	  AND ue.model = ud.model
)
  AND NOT EXISTS (
	SELECT 1
	FROM model_prices mp
	WHERE mp.model = ud.model
  );
