ALTER TABLE users
	ADD COLUMN IF NOT EXISTS quota_5h_cost_usd NUMERIC(30, 12),
	ADD COLUMN IF NOT EXISTS quota_7d_cost_usd NUMERIC(30, 12);

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'usage_events'
		  AND column_name = 'estimated_cost_usd'
	) AND NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'usage_events'
		  AND column_name = 'cost_usd'
	) THEN
		ALTER TABLE usage_events RENAME COLUMN estimated_cost_usd TO cost_usd;
	ELSIF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'usage_events'
		  AND column_name = 'estimated_cost_usd'
	) AND EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'usage_events'
		  AND column_name = 'cost_usd'
	) THEN
		UPDATE usage_events
		SET cost_usd = estimated_cost_usd
		WHERE cost_usd = 0
		  AND estimated_cost_usd <> 0;

		ALTER TABLE usage_events DROP COLUMN estimated_cost_usd;
	END IF;
END $$;

ALTER TABLE usage_events
	ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(30, 12) NOT NULL DEFAULT 0;
