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

	var estimatedCostUSD string
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
				) / 1000000 AS estimated_cost_usd,
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
			estimated_cost_usd, price_missing
		)
		SELECT
			$1, $2, $3, $4, $5, $6, $7,
			$8, $9, $10, $11, $12,
			$13, $14, $15, $16, $17, $18, $19,
			input_usd_per_million, cache_read_usd_per_million, cache_write_usd_per_million,
			output_usd_per_million, reasoning_usd_per_million,
			estimated_cost_usd, price_missing
		FROM priced
		RETURNING estimated_cost_usd::text, price_missing
	`, params.ID, params.UserID, params.APIKeyID, params.Provider, params.Model, params.UpstreamAuthID,
		params.UpstreamAuthIndex, params.UpstreamAuthType, params.Source, params.InputTokens,
		params.OutputTokens, params.ReasoningTokens, params.CacheReadTokens, params.CacheWriteTokens,
		params.CachedTokens, params.TotalTokens,
		params.LatencyMS, params.Failed, params.RequestedAt).Scan(&estimatedCostUSD, &priceMissing)
	if err != nil {
		return err
	}

	unpricedTokens := int64(0)
	if priceMissing {
		unpricedTokens = params.TotalTokens
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO usage_daily (
			day, user_id, api_key_id, provider, model, request_count, failed_count,
			input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
			cached_tokens, total_tokens,
			estimated_cost_usd, unpriced_tokens, updated_at
		)
		VALUES (
			$1, $2, $3, $4, $5, 1, CASE WHEN $6 THEN 1 ELSE 0 END,
			$7, $8, $9, $10, $11, $12, $13, $14::numeric, $15, now()
		)
		ON CONFLICT (day, user_id, api_key_id, provider, model)
		DO UPDATE SET
			request_count = usage_daily.request_count + 1,
			failed_count = usage_daily.failed_count + EXCLUDED.failed_count,
			input_tokens = usage_daily.input_tokens + EXCLUDED.input_tokens,
			output_tokens = usage_daily.output_tokens + EXCLUDED.output_tokens,
			reasoning_tokens = usage_daily.reasoning_tokens + EXCLUDED.reasoning_tokens,
			cache_read_tokens = usage_daily.cache_read_tokens + EXCLUDED.cache_read_tokens,
			cache_write_tokens = usage_daily.cache_write_tokens + EXCLUDED.cache_write_tokens,
			cached_tokens = usage_daily.cached_tokens + EXCLUDED.cached_tokens,
			total_tokens = usage_daily.total_tokens + EXCLUDED.total_tokens,
			estimated_cost_usd = usage_daily.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
			unpriced_tokens = usage_daily.unpriced_tokens + EXCLUDED.unpriced_tokens,
			updated_at = now()
	`, params.RequestedAt.UTC().Format("2006-01-02"), params.UserID, params.APIKeyID, params.Provider,
		params.Model, params.Failed, params.InputTokens, params.OutputTokens, params.ReasoningTokens,
		params.CacheReadTokens, params.CacheWriteTokens, params.CachedTokens, params.TotalTokens,
		estimatedCostUSD, unpricedTokens)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Store) GetSummary(ctx context.Context, userID string, from, to time.Time) (*Summary, error) {
	var summary Summary
	err := s.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(request_count), 0),
			COALESCE(SUM(failed_count), 0),
			COALESCE(SUM(input_tokens), 0),
			COALESCE(SUM(output_tokens), 0),
			COALESCE(SUM(reasoning_tokens), 0),
			COALESCE(SUM(cache_read_tokens), 0),
			COALESCE(SUM(cache_write_tokens), 0),
			COALESCE(SUM(cached_tokens), 0),
			COALESCE(SUM(total_tokens), 0),
			COALESCE(SUM(estimated_cost_usd), 0)::text,
			COALESCE(SUM(unpriced_tokens), 0)
		FROM usage_daily
		WHERE user_id = $1 AND day >= $2 AND day <= $3
	`, userID, from.Format("2006-01-02"), to.Format("2006-01-02")).Scan(
		&summary.RequestCount,
		&summary.FailedCount,
		&summary.InputTokens,
		&summary.OutputTokens,
		&summary.ReasoningTokens,
		&summary.CacheReadTokens,
		&summary.CacheWriteTokens,
		&summary.CachedTokens,
		&summary.TotalTokens,
		&summary.EstimatedCostUSD,
		&summary.UnpricedTokens,
	)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (s *Store) GetByAPIKey(ctx context.Context, userID string, from, to time.Time) ([]APIKeyUsage, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			ak.id,
			ak.name,
			ak.key_prefix,
			COALESCE(SUM(ud.request_count), 0),
			COALESCE(SUM(ud.failed_count), 0),
			COALESCE(SUM(ud.total_tokens), 0)
		FROM api_keys ak
		LEFT JOIN usage_daily ud ON ud.api_key_id = ak.id
			AND ud.day >= $2 AND ud.day <= $3
		WHERE ak.user_id = $1 AND ak.kind = 'user'
		GROUP BY ak.id, ak.name, ak.key_prefix
		ORDER BY COALESCE(SUM(ud.total_tokens), 0) DESC, ak.created_at DESC
	`, userID, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]APIKeyUsage, 0)
	for rows.Next() {
		var item APIKeyUsage
		if err := rows.Scan(
			&item.APIKeyID,
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

func (s *Store) GetByModel(ctx context.Context, userID string, from, to time.Time) ([]ModelUsage, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			provider,
			model,
			SUM(request_count),
			SUM(failed_count),
			SUM(input_tokens),
			SUM(output_tokens),
			SUM(reasoning_tokens),
			SUM(cache_read_tokens),
			SUM(cache_write_tokens),
			SUM(cached_tokens),
			SUM(total_tokens),
			COALESCE(SUM(estimated_cost_usd), 0)::text,
			BOOL_OR(unpriced_tokens > 0),
			COALESCE(SUM(unpriced_tokens), 0)
		FROM usage_daily
		WHERE user_id = $1 AND day >= $2 AND day <= $3
		GROUP BY provider, model
		ORDER BY SUM(total_tokens) DESC
	`, userID, from.Format("2006-01-02"), to.Format("2006-01-02"))
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
			&item.EstimatedCostUSD,
			&item.PriceMissing,
			&item.UnpricedTokens,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
