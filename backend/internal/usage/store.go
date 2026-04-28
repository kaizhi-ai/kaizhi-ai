package usage

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

type InsertEventParams struct {
	ID                string
	UserID            string
	APIKeyID          string
	Provider          string
	Model             string
	UpstreamAuthID    string
	UpstreamAuthIndex string
	UpstreamAuthType  string
	Source            string
	InputTokens       int64
	OutputTokens      int64
	ReasoningTokens   int64
	CacheReadTokens   int64
	CacheWriteTokens  int64
	CachedTokens      int64
	TotalTokens       int64
	LatencyMS         int64
	Failed            bool
	RequestedAt       time.Time
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) InsertEvent(ctx context.Context, params InsertEventParams) error {
	if params.RequestedAt.IsZero() {
		params.RequestedAt = time.Now().UTC()
	}
	if params.CacheReadTokens == 0 && params.CacheWriteTokens == 0 && params.CachedTokens > 0 {
		params.CacheReadTokens = params.CachedTokens
	}
	params.CachedTokens = params.CacheReadTokens + params.CacheWriteTokens
	if params.TotalTokens == 0 {
		params.TotalTokens = params.InputTokens + params.OutputTokens + params.ReasoningTokens
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var costUSD string
	var priceMissing bool
	err = tx.QueryRow(ctx, `
		WITH price AS (
			SELECT
				input_usd_per_million,
				COALESCE(cache_read_usd_per_million, input_usd_per_million) AS cache_read_usd_per_million,
				COALESCE(cache_write_usd_per_million, input_usd_per_million) AS cache_write_usd_per_million,
				output_usd_per_million,
				COALESCE(reasoning_usd_per_million, output_usd_per_million) AS reasoning_usd_per_million
			FROM model_prices
			WHERE model = $5
		),
		priced AS (
			SELECT
				input_usd_per_million,
				cache_read_usd_per_million,
				cache_write_usd_per_million,
				output_usd_per_million,
				reasoning_usd_per_million,
				(
					GREATEST($10::bigint - $13::bigint - $14::bigint, 0)::numeric * input_usd_per_million
					+ $13::bigint::numeric * cache_read_usd_per_million
					+ $14::bigint::numeric * cache_write_usd_per_million
					+ (
						CASE
						WHEN $12::bigint > 0 AND $16::bigint < $10::bigint + $11::bigint + $12::bigint
							THEN GREATEST($11::bigint - $12::bigint, 0)
						ELSE $11::bigint
						END
					)::numeric * output_usd_per_million
					+ $12::bigint::numeric * reasoning_usd_per_million
				) / 1000000 AS cost_usd,
				false AS price_missing
			FROM price
			UNION ALL
			SELECT
				NULL::numeric,
				NULL::numeric,
				NULL::numeric,
				NULL::numeric,
				NULL::numeric,
				0::numeric,
				true
			WHERE NOT EXISTS (SELECT 1 FROM price)
		)
		INSERT INTO usage_events (
			id, user_id, api_key_id, provider, model, upstream_auth_id, upstream_auth_index,
			upstream_auth_type, source, input_tokens, output_tokens, reasoning_tokens,
			cache_read_tokens, cache_write_tokens, cached_tokens, total_tokens,
			latency_ms, failed, requested_at,
			input_usd_per_million_snapshot, cache_read_usd_per_million_snapshot,
			cache_write_usd_per_million_snapshot,
			output_usd_per_million_snapshot, reasoning_usd_per_million_snapshot,
			cost_usd, price_missing
		)
		SELECT
			$1, $2, $3, $4, $5, $6, $7,
			$8, $9, $10, $11, $12,
			$13, $14, $15, $16, $17, $18, $19,
			input_usd_per_million, cache_read_usd_per_million, cache_write_usd_per_million,
			output_usd_per_million, reasoning_usd_per_million,
			cost_usd, price_missing
		FROM priced
		RETURNING cost_usd::text, price_missing
	`, params.ID, params.UserID, params.APIKeyID, params.Provider, params.Model, params.UpstreamAuthID,
		params.UpstreamAuthIndex, params.UpstreamAuthType, params.Source, params.InputTokens,
		params.OutputTokens, params.ReasoningTokens, params.CacheReadTokens, params.CacheWriteTokens,
		params.CachedTokens, params.TotalTokens,
		params.LatencyMS, params.Failed, params.RequestedAt).Scan(&costUSD, &priceMissing)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		UPDATE users
		SET
			usage_5h_cost_usd = CASE
				WHEN $2::timestamptz < usage_5h_started_at THEN usage_5h_cost_usd
				WHEN $2::timestamptz >= usage_5h_started_at + interval '5 hours' THEN $3::numeric
				ELSE usage_5h_cost_usd + $3::numeric
			END,
			usage_5h_started_at = CASE
				WHEN $2::timestamptz < usage_5h_started_at THEN usage_5h_started_at
				WHEN $2::timestamptz >= usage_5h_started_at + interval '5 hours' THEN $2::timestamptz
				ELSE usage_5h_started_at
			END,
			usage_7d_cost_usd = CASE
				WHEN $2::timestamptz < usage_7d_started_at THEN usage_7d_cost_usd
				WHEN $2::timestamptz >= usage_7d_started_at + interval '7 days' THEN $3::numeric
				ELSE usage_7d_cost_usd + $3::numeric
			END,
			usage_7d_started_at = CASE
				WHEN $2::timestamptz < usage_7d_started_at THEN usage_7d_started_at
				WHEN $2::timestamptz >= usage_7d_started_at + interval '7 days' THEN $2::timestamptz
				ELSE usage_7d_started_at
			END
		WHERE id = $1
	`, params.UserID, params.RequestedAt, costUSD)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Store) GetSummary(ctx context.Context, userID string, from, to time.Time) (*Summary, error) {
	return s.getSummary(ctx, userID, from, to)
}

func (s *Store) GetSiteSummary(ctx context.Context, from, to time.Time) (*Summary, error) {
	return s.getSummary(ctx, "", from, to)
}

func (s *Store) getSummary(ctx context.Context, userID string, from, to time.Time) (*Summary, error) {
	var summary Summary
	err := s.db.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN failed THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(input_tokens), 0),
			COALESCE(SUM(output_tokens), 0),
			COALESCE(SUM(reasoning_tokens), 0),
			COALESCE(SUM(cache_read_tokens), 0),
			COALESCE(SUM(cache_write_tokens), 0),
			COALESCE(SUM(cached_tokens), 0),
			COALESCE(SUM(total_tokens), 0),
			COALESCE(SUM(cost_usd), 0)::text,
			COALESCE(SUM(CASE WHEN price_missing THEN total_tokens ELSE 0 END), 0)
		FROM usage_events
		WHERE ($1 = '' OR user_id = $1)
		  AND requested_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
		  AND requested_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
	`, userID, dateOnly(from), dateOnly(to)).Scan(
		&summary.RequestCount,
		&summary.FailedCount,
		&summary.InputTokens,
		&summary.OutputTokens,
		&summary.ReasoningTokens,
		&summary.CacheReadTokens,
		&summary.CacheWriteTokens,
		&summary.CachedTokens,
		&summary.TotalTokens,
		&summary.CostUSD,
		&summary.UnpricedTokens,
	)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (s *Store) GetSiteByAPIKey(ctx context.Context, from, to time.Time) ([]APIKeyUsage, error) {
	return s.getByAPIKey(ctx, "", from, to)
}

func (s *Store) GetByAPIKey(ctx context.Context, userID string, from, to time.Time) ([]APIKeyUsage, error) {
	return s.getByAPIKey(ctx, userID, from, to)
}

func (s *Store) GetSiteByUser(ctx context.Context, from, to time.Time) ([]UserUsage, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			u.id,
			u.email,
			u.name,
			COUNT(ue.id),
			COALESCE(SUM(CASE WHEN ue.failed THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(ue.input_tokens), 0),
			COALESCE(SUM(ue.output_tokens), 0),
			COALESCE(SUM(ue.reasoning_tokens), 0),
			COALESCE(SUM(ue.cache_read_tokens), 0),
			COALESCE(SUM(ue.cache_write_tokens), 0),
			COALESCE(SUM(ue.cached_tokens), 0),
			COALESCE(SUM(ue.total_tokens), 0),
			COALESCE(SUM(ue.cost_usd), 0)::text,
			COALESCE(SUM(CASE WHEN ue.price_missing THEN ue.total_tokens ELSE 0 END), 0)
		FROM users u
		LEFT JOIN usage_events ue ON ue.user_id = u.id
			AND ue.requested_at >= ($1::date::timestamp AT TIME ZONE 'UTC')
			AND ue.requested_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
		GROUP BY u.id, u.email, u.name
		ORDER BY COALESCE(SUM(ue.total_tokens), 0) DESC, u.email ASC
	`, dateOnly(from), dateOnly(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]UserUsage, 0)
	for rows.Next() {
		var item UserUsage
		if err := rows.Scan(
			&item.UserID,
			&item.UserEmail,
			&item.UserName,
			&item.RequestCount,
			&item.FailedCount,
			&item.InputTokens,
			&item.OutputTokens,
			&item.ReasoningTokens,
			&item.CacheReadTokens,
			&item.CacheWriteTokens,
			&item.CachedTokens,
			&item.TotalTokens,
			&item.CostUSD,
			&item.UnpricedTokens,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) getByAPIKey(ctx context.Context, userID string, from, to time.Time) ([]APIKeyUsage, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			ak.id,
			ak.user_id,
			u.email,
			u.name,
			ak.name,
			ak.key_prefix,
			COUNT(ue.id),
			COALESCE(SUM(CASE WHEN ue.failed THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(ue.total_tokens), 0)
		FROM api_keys ak
		JOIN users u ON u.id = ak.user_id
		LEFT JOIN usage_events ue ON ue.api_key_id = ak.id
			AND ue.requested_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
			AND ue.requested_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
		WHERE ($1 = '' OR ak.user_id = $1) AND ak.kind = 'user'
		GROUP BY ak.id, ak.user_id, u.email, u.name, ak.name, ak.key_prefix
		ORDER BY COALESCE(SUM(ue.total_tokens), 0) DESC, u.email ASC, ak.created_at DESC
	`, userID, dateOnly(from), dateOnly(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]APIKeyUsage, 0)
	for rows.Next() {
		var item APIKeyUsage
		if err := rows.Scan(
			&item.APIKeyID,
			&item.UserID,
			&item.UserEmail,
			&item.UserName,
			&item.Name,
			&item.KeyPrefix,
			&item.RequestCount,
			&item.FailedCount,
			&item.TotalTokens,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetSiteByModel(ctx context.Context, from, to time.Time) ([]ModelUsage, error) {
	return s.getByModel(ctx, "", from, to)
}

func (s *Store) GetByModel(ctx context.Context, userID string, from, to time.Time) ([]ModelUsage, error) {
	return s.getByModel(ctx, userID, from, to)
}

func (s *Store) getByModel(ctx context.Context, userID string, from, to time.Time) ([]ModelUsage, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			provider,
			model,
			COUNT(*),
			COALESCE(SUM(CASE WHEN failed THEN 1 ELSE 0 END), 0),
			SUM(input_tokens),
			SUM(output_tokens),
			SUM(reasoning_tokens),
			SUM(cache_read_tokens),
			SUM(cache_write_tokens),
			SUM(cached_tokens),
			SUM(total_tokens),
			COALESCE(SUM(cost_usd), 0)::text,
			BOOL_OR(price_missing),
			COALESCE(SUM(CASE WHEN price_missing THEN total_tokens ELSE 0 END), 0)
		FROM usage_events
		WHERE ($1 = '' OR user_id = $1)
		  AND requested_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
		  AND requested_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
		GROUP BY provider, model
		ORDER BY SUM(total_tokens) DESC
	`, userID, dateOnly(from), dateOnly(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ModelUsage, 0)
	for rows.Next() {
		var item ModelUsage
		if err := rows.Scan(
			&item.Provider,
			&item.Model,
			&item.RequestCount,
			&item.FailedCount,
			&item.InputTokens,
			&item.OutputTokens,
			&item.ReasoningTokens,
			&item.CacheReadTokens,
			&item.CacheWriteTokens,
			&item.CachedTokens,
			&item.TotalTokens,
			&item.CostUSD,
			&item.PriceMissing,
			&item.UnpricedTokens,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func dateOnly(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}
