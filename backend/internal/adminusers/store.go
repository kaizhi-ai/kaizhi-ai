package adminusers

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/users"
)

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) ResetPasswordAndRevokeSessions(ctx context.Context, userID, passwordHash string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	tag, err := tx.Exec(ctx, `
		UPDATE users
		SET password_hash = $1, updated_at = now()
		WHERE id = $2
	`, passwordHash, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return users.ErrNotFound
	}
	if err := revokeSessionsForUser(ctx, tx, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) BanUserAndRevokeSessions(ctx context.Context, userID string) (*users.User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	user, err := updateUserStatus(ctx, tx, userID, users.StatusBanned)
	if err != nil {
		return nil, err
	}
	if err := revokeSessionsForUser(ctx, tx, userID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return user, nil
}

func updateUserStatus(ctx context.Context, tx pgx.Tx, userID, status string) (*users.User, error) {
	var user users.User
	err := tx.QueryRow(ctx, `
		UPDATE users
		SET status = $2, updated_at = now()
		WHERE id = $1
		RETURNING id, email, name, language, password_hash, status, role, created_at, updated_at
	`, userID, status).Scan(
		&user.ID,
		&user.Email,
		&user.Name,
		&user.Language,
		&user.PasswordHash,
		&user.Status,
		&user.Role,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, users.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func revokeSessionsForUser(ctx context.Context, tx pgx.Tx, userID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE api_keys
		SET status = $3,
		    revoked_at = COALESCE(revoked_at, now())
		WHERE user_id = $1 AND kind = $2 AND status <> $3
	`, userID, apikeys.KindSession, apikeys.StatusRevoked)
	return err
}
