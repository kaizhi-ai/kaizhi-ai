package apikeys

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

type CreateParams struct {
	ID        string
	UserID    string
	Name      string
	KeyPrefix string
	KeyHash   string
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) Create(ctx context.Context, params CreateParams) (*APIKey, error) {
	var key APIKey
	err := s.db.QueryRow(ctx, `
		INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, name, key_prefix, key_hash, status, last_used_at, created_at, revoked_at
	`, params.ID, params.UserID, params.Name, params.KeyPrefix, params.KeyHash).Scan(
		&key.ID,
		&key.UserID,
		&key.Name,
		&key.KeyPrefix,
		&key.KeyHash,
		&key.Status,
		nullTimeScanner(&key.LastUsedAt),
		&key.CreatedAt,
		nullTimeScanner(&key.RevokedAt),
	)
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (s *Store) ListByUser(ctx context.Context, userID string) ([]APIKey, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, name, key_prefix, status, last_used_at, created_at, revoked_at
		FROM api_keys
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := make([]APIKey, 0)
	for rows.Next() {
		var key APIKey
		if err := rows.Scan(
			&key.ID,
			&key.UserID,
			&key.Name,
			&key.KeyPrefix,
			&key.Status,
			nullTimeScanner(&key.LastUsedAt),
			&key.CreatedAt,
			nullTimeScanner(&key.RevokedAt),
		); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s *Store) Revoke(ctx context.Context, userID, keyID string) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE api_keys
		SET status = 'revoked', revoked_at = now()
		WHERE id = $1 AND user_id = $2 AND status <> 'revoked'
	`, keyID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) FindActiveByHash(ctx context.Context, keyHash string) (*APIKey, error) {
	var key APIKey
	err := s.db.QueryRow(ctx, `
		SELECT ak.id, ak.user_id, ak.name, ak.key_prefix, ak.key_hash, ak.status,
		       ak.last_used_at, ak.created_at, ak.revoked_at, u.status
		FROM api_keys ak
		JOIN users u ON u.id = ak.user_id
		WHERE ak.key_hash = $1
		LIMIT 1
	`, keyHash).Scan(
		&key.ID,
		&key.UserID,
		&key.Name,
		&key.KeyPrefix,
		&key.KeyHash,
		&key.Status,
		nullTimeScanner(&key.LastUsedAt),
		&key.CreatedAt,
		nullTimeScanner(&key.RevokedAt),
		&key.UserStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if key.Status != "active" || key.UserStatus != "active" {
		return nil, ErrNotFound
	}
	return &key, nil
}

func (s *Store) GetByID(ctx context.Context, id string) (*APIKey, error) {
	var key APIKey
	err := s.db.QueryRow(ctx, `
		SELECT id, user_id, name, key_prefix, key_hash, status, last_used_at, created_at, revoked_at
		FROM api_keys
		WHERE id = $1
	`, id).Scan(
		&key.ID,
		&key.UserID,
		&key.Name,
		&key.KeyPrefix,
		&key.KeyHash,
		&key.Status,
		nullTimeScanner(&key.LastUsedAt),
		&key.CreatedAt,
		nullTimeScanner(&key.RevokedAt),
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (s *Store) Touch(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE api_keys SET last_used_at = now() WHERE id = $1`, id)
	return err
}

func nullTimeScanner(target **time.Time) any {
	return &nullableTime{target: target}
}

type nullableTime struct {
	target **time.Time
}

func (n *nullableTime) Scan(value any) error {
	var nt sql.NullTime
	if err := nt.Scan(value); err != nil {
		return err
	}
	if nt.Valid {
		t := nt.Time
		*n.target = &t
		return nil
	}
	*n.target = nil
	return nil
}

var ErrNotFound = errors.New("not found")
