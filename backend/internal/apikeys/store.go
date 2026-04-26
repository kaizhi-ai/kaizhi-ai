package apikeys

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"kaizhi/backend/internal/users"
)

type Store struct {
	db *pgxpool.Pool
}

type CreateParams struct {
	ID        string
	UserID    string
	Name      string
	Kind      string
	KeyPrefix string
	KeyHash   string
	ExpiresAt *time.Time
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) Create(ctx context.Context, params CreateParams) (*APIKey, error) {
	if params.Kind == "" {
		params.Kind = KindUser
	}
	var key APIKey
	err := s.db.QueryRow(ctx, `
		INSERT INTO api_keys (id, user_id, name, kind, key_prefix, key_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, user_id, name, kind, key_prefix, key_hash, status, last_used_at, created_at, expires_at, revoked_at
	`, params.ID, params.UserID, params.Name, params.Kind, params.KeyPrefix, params.KeyHash, params.ExpiresAt).Scan(
		&key.ID,
		&key.UserID,
		&key.Name,
		&key.Kind,
		&key.KeyPrefix,
		&key.KeyHash,
		&key.Status,
		nullTimeScanner(&key.LastUsedAt),
		&key.CreatedAt,
		nullTimeScanner(&key.ExpiresAt),
		nullTimeScanner(&key.RevokedAt),
	)
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (s *Store) ListUserKeys(ctx context.Context, userID string) ([]APIKey, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, name, kind, key_prefix, status, last_used_at, created_at, expires_at, revoked_at
		FROM api_keys
		WHERE user_id = $1 AND kind = $2
		ORDER BY created_at DESC
	`, userID, KindUser)
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
			&key.Kind,
			&key.KeyPrefix,
			&key.Status,
			nullTimeScanner(&key.LastUsedAt),
			&key.CreatedAt,
			nullTimeScanner(&key.ExpiresAt),
			nullTimeScanner(&key.RevokedAt),
		); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s *Store) RevokeUserKey(ctx context.Context, userID, keyID string) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE api_keys
		SET status = 'revoked', revoked_at = now()
		WHERE id = $1 AND user_id = $2 AND kind = $3 AND status <> 'revoked'
	`, keyID, userID, KindUser)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RenameUserKey(ctx context.Context, userID, keyID, name string) (*APIKey, error) {
	var key APIKey
	err := s.db.QueryRow(ctx, `
		UPDATE api_keys
		SET name = $3
		WHERE id = $1 AND user_id = $2 AND kind = $4 AND status <> 'revoked'
		RETURNING id, user_id, name, kind, key_prefix, key_hash, status, last_used_at, created_at, expires_at, revoked_at
	`, keyID, userID, name, KindUser).Scan(
		&key.ID,
		&key.UserID,
		&key.Name,
		&key.Kind,
		&key.KeyPrefix,
		&key.KeyHash,
		&key.Status,
		nullTimeScanner(&key.LastUsedAt),
		&key.CreatedAt,
		nullTimeScanner(&key.ExpiresAt),
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

func (s *Store) RevokeByID(ctx context.Context, keyID string) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE api_keys
		SET status = 'revoked', revoked_at = now()
		WHERE id = $1 AND status <> 'revoked'
	`, keyID)
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
		SELECT ak.id, ak.user_id, ak.name, ak.kind, ak.key_prefix, ak.key_hash, ak.status,
		       ak.last_used_at, ak.created_at, ak.expires_at, ak.revoked_at, u.status
		FROM api_keys ak
		JOIN users u ON u.id = ak.user_id
		WHERE ak.key_hash = $1
		LIMIT 1
	`, keyHash).Scan(
		&key.ID,
		&key.UserID,
		&key.Name,
		&key.Kind,
		&key.KeyPrefix,
		&key.KeyHash,
		&key.Status,
		nullTimeScanner(&key.LastUsedAt),
		&key.CreatedAt,
		nullTimeScanner(&key.ExpiresAt),
		nullTimeScanner(&key.RevokedAt),
		&key.UserStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if key.Status != StatusActive || key.UserStatus != users.StatusActive {
		return nil, ErrNotFound
	}
	if key.ExpiresAt != nil && !key.ExpiresAt.After(time.Now().UTC()) {
		return nil, ErrExpired
	}
	return &key, nil
}

func (s *Store) GetByID(ctx context.Context, id string) (*APIKey, error) {
	var key APIKey
	err := s.db.QueryRow(ctx, `
		SELECT id, user_id, name, kind, key_prefix, key_hash, status, last_used_at, created_at, expires_at, revoked_at
		FROM api_keys
		WHERE id = $1
	`, id).Scan(
		&key.ID,
		&key.UserID,
		&key.Name,
		&key.Kind,
		&key.KeyPrefix,
		&key.KeyHash,
		&key.Status,
		nullTimeScanner(&key.LastUsedAt),
		&key.CreatedAt,
		nullTimeScanner(&key.ExpiresAt),
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

// SetExpiresAt overwrites expires_at for the given key. Pass nil to mark the
// key as never-expiring. Used by rotation flows and tests.
func (s *Store) SetExpiresAt(ctx context.Context, id string, expiresAt *time.Time) error {
	tag, err := s.db.Exec(ctx, `UPDATE api_keys SET expires_at = $2 WHERE id = $1`, id, expiresAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// TouchAndExtend marks the key as used and, when expiresAt is non-nil, pushes
// expires_at out to that time. It only extends; it never shortens.
func (s *Store) TouchAndExtend(ctx context.Context, id string, expiresAt *time.Time) error {
	if expiresAt == nil {
		return s.Touch(ctx, id)
	}
	_, err := s.db.Exec(ctx, `
		UPDATE api_keys
		SET last_used_at = now(),
		    expires_at = CASE
		        WHEN expires_at IS NULL THEN expires_at
		        WHEN expires_at < $2 THEN $2
		        ELSE expires_at
		    END
		WHERE id = $1
	`, id, expiresAt)
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

var (
	ErrNotFound = errors.New("not found")
	ErrExpired  = errors.New("expired")
)
