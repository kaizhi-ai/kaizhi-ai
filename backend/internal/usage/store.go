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

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	_, err = tx.Exec(ctx, `
		INSERT INTO usage_events (
			id, user_id, api_key_id, provider, model, upstream_auth_id, upstream_auth_index,
			upstream_auth_type, source, input_tokens, output_tokens, reasoning_tokens,
			cached_tokens, total_tokens, latency_ms, failed, requested_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
	`, params.ID, params.UserID, params.APIKeyID, params.Provider, params.Model, params.UpstreamAuthID,
		params.UpstreamAuthIndex, params.UpstreamAuthType, params.Source, params.InputTokens,
		params.OutputTokens, params.ReasoningTokens, params.CachedTokens, params.TotalTokens,
		params.LatencyMS, params.Failed, params.RequestedAt)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO usage_daily (
			day, user_id, api_key_id, provider, model, request_count, failed_count,
			input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, updated_at
		)
		VALUES (
			$1, $2, $3, $4, $5, 1, CASE WHEN $6 THEN 1 ELSE 0 END,
			$7, $8, $9, $10, $11, now()
		)
		ON CONFLICT (day, user_id, api_key_id, provider, model)
		DO UPDATE SET
			request_count = usage_daily.request_count + 1,
			failed_count = usage_daily.failed_count + EXCLUDED.failed_count,
			input_tokens = usage_daily.input_tokens + EXCLUDED.input_tokens,
			output_tokens = usage_daily.output_tokens + EXCLUDED.output_tokens,
			reasoning_tokens = usage_daily.reasoning_tokens + EXCLUDED.reasoning_tokens,
			cached_tokens = usage_daily.cached_tokens + EXCLUDED.cached_tokens,
			total_tokens = usage_daily.total_tokens + EXCLUDED.total_tokens,
			updated_at = now()
	`, params.RequestedAt.UTC().Format("2006-01-02"), params.UserID, params.APIKeyID, params.Provider,
		params.Model, params.Failed, params.InputTokens, params.OutputTokens, params.ReasoningTokens,
		params.CachedTokens, params.TotalTokens)
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
			COALESCE(SUM(cached_tokens), 0),
			COALESCE(SUM(total_tokens), 0)
		FROM usage_daily
		WHERE user_id = $1 AND day >= $2 AND day <= $3
	`, userID, from.Format("2006-01-02"), to.Format("2006-01-02")).Scan(
		&summary.RequestCount,
		&summary.FailedCount,
		&summary.InputTokens,
		&summary.OutputTokens,
		&summary.ReasoningTokens,
		&summary.CachedTokens,
		&summary.TotalTokens,
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
		WHERE ak.user_id = $1
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
			SUM(total_tokens)
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
			&item.TotalTokens,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
