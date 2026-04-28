package modelprices

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"kaizhi/backend/internal/ids"
)

var (
	ErrNotFound = errors.New("model price not found")
	ErrConflict = errors.New("model price already exists")
)

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) List(ctx context.Context, params ListParams) ([]Price, error) {
	query := strings.TrimSpace(params.Query)
	rows, err := s.db.Query(ctx, `
			SELECT
				id,
				model,
				input_usd_per_million::text,
				cache_read_usd_per_million::text,
				cache_write_usd_per_million::text,
				output_usd_per_million::text,
				reasoning_usd_per_million::text,
				note,
				created_at,
				updated_at
		FROM model_prices
		WHERE ($1 = '' OR model ILIKE '%' || $1 || '%')
		ORDER BY model ASC, created_at DESC
	`, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]Price, 0)
	for rows.Next() {
		price, err := scanPrice(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, price)
	}
	return items, rows.Err()
}

func (s *Store) Create(ctx context.Context, params SaveParams) (*Price, error) {
	id, err := ids.New("mpr")
	if err != nil {
		return nil, err
	}
	return s.save(ctx, id, params, true)
}

func (s *Store) Update(ctx context.Context, id string, params SaveParams) (*Price, error) {
	return s.save(ctx, strings.TrimSpace(id), params, false)
}

func (s *Store) save(ctx context.Context, id string, params SaveParams, create bool) (*Price, error) {
	if create {
		price, err := scanPrice(s.db.QueryRow(ctx, `
				INSERT INTO model_prices (
					id, model, input_usd_per_million,
					cache_read_usd_per_million, cache_write_usd_per_million,
					output_usd_per_million, reasoning_usd_per_million, note
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				RETURNING
					id, model, input_usd_per_million::text,
					cache_read_usd_per_million::text, cache_write_usd_per_million::text,
					output_usd_per_million::text,
					reasoning_usd_per_million::text, note, created_at, updated_at
			`, id, params.Model, params.InputUSDPerMillion,
			nullableString(params.CacheReadUSDPerMillion), nullableString(params.CacheWriteUSDPerMillion), params.OutputUSDPerMillion,
			nullableString(params.ReasoningUSDPerMillion), params.Note))
		if err != nil {
			return nil, normalizeStoreError(err)
		}
		return &price, nil
	}

	price, err := scanPrice(s.db.QueryRow(ctx, `
		UPDATE model_prices
		SET model = $2,
		    input_usd_per_million = $3,
		    cache_read_usd_per_million = $4,
		    cache_write_usd_per_million = $5,
		    output_usd_per_million = $6,
		    reasoning_usd_per_million = $7,
		    note = $8,
		    updated_at = now()
		WHERE id = $1
		RETURNING
			id, model, input_usd_per_million::text,
			cache_read_usd_per_million::text, cache_write_usd_per_million::text,
			output_usd_per_million::text,
			reasoning_usd_per_million::text, note, created_at, updated_at
	`, id, params.Model, params.InputUSDPerMillion,
		nullableString(params.CacheReadUSDPerMillion), nullableString(params.CacheWriteUSDPerMillion), params.OutputUSDPerMillion,
		nullableString(params.ReasoningUSDPerMillion), params.Note))
	if err != nil {
		return nil, normalizeStoreError(err)
	}
	return &price, nil
}

func (s *Store) Delete(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM model_prices
		WHERE id = $1
	`, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ImportDefaultPrices(ctx context.Context) (ImportResult, error) {
	return s.ImportPrices(ctx, DefaultPrices())
}

func (s *Store) ImportPrices(ctx context.Context, prices []SaveParams) (ImportResult, error) {
	result := ImportResult{Total: len(prices)}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)

	for _, params := range prices {
		model := strings.TrimSpace(params.Model)
		if model == "" {
			result.Skipped++
			continue
		}
		id, err := ids.New("mpr")
		if err != nil {
			return result, err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO model_prices (
				id, model, input_usd_per_million,
				cache_read_usd_per_million, cache_write_usd_per_million,
				output_usd_per_million, reasoning_usd_per_million, note
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (model) DO NOTHING
		`, id, model, params.InputUSDPerMillion,
			nullableString(params.CacheReadUSDPerMillion), nullableString(params.CacheWriteUSDPerMillion), params.OutputUSDPerMillion,
			nullableString(params.ReasoningUSDPerMillion), strings.TrimSpace(params.Note))
		if err != nil {
			return result, normalizeStoreError(err)
		}
		if tag.RowsAffected() == 0 {
			result.Skipped++
			continue
		}
		result.Created++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func (s *Store) ListUnmatched(ctx context.Context, from, to time.Time) ([]UnmatchedModel, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			ud.model,
			SUM(ud.request_count),
			SUM(ud.total_tokens),
			MIN(ud.day),
			MAX(ud.day)
		FROM usage_daily ud
		WHERE ud.day >= $1 AND ud.day <= $2
		  AND NOT EXISTS (
			SELECT 1
			FROM model_prices mp
			WHERE mp.model = ud.model
		  )
		GROUP BY ud.model
		ORDER BY SUM(ud.total_tokens) DESC, ud.model ASC
	`, dateOnly(from), dateOnly(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]UnmatchedModel, 0)
	for rows.Next() {
		var item UnmatchedModel
		var firstSeen time.Time
		var lastSeen time.Time
		if err := rows.Scan(
			&item.Model,
			&item.RequestCount,
			&item.TotalTokens,
			&firstSeen,
			&lastSeen,
		); err != nil {
			return nil, err
		}
		item.FirstSeen = firstSeen.Format("2006-01-02")
		item.LastSeen = lastSeen.Format("2006-01-02")
		items = append(items, item)
	}
	return items, rows.Err()
}

type priceScanner interface {
	Scan(dest ...any) error
}

func scanPrice(row priceScanner) (Price, error) {
	var price Price
	var cacheRead sql.NullString
	var cacheWrite sql.NullString
	var reasoning sql.NullString
	err := row.Scan(
		&price.ID,
		&price.Model,
		&price.InputUSDPerMillion,
		&cacheRead,
		&cacheWrite,
		&price.OutputUSDPerMillion,
		&reasoning,
		&price.Note,
		&price.CreatedAt,
		&price.UpdatedAt,
	)
	if cacheRead.Valid {
		price.CacheReadUSDPerMillion = &cacheRead.String
	}
	if cacheWrite.Valid {
		price.CacheWriteUSDPerMillion = &cacheWrite.String
	}
	if reasoning.Valid {
		price.ReasoningUSDPerMillion = &reasoning.String
	}
	return price, err
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func dateOnly(value time.Time) string {
	return value.Format("2006-01-02")
}

func normalizeStoreError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrConflict
	}
	return err
}
