package users

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"kaizhi/backend/internal/ids"
)

type Store struct {
	db              *pgxpool.Pool
	defaultLanguage string
}

type StoreOption func(*Store)

func WithDefaultLanguage(language string) StoreOption {
	return func(s *Store) {
		s.defaultLanguage = ResolveDefaultLanguage(language)
	}
}

func NewStore(db *pgxpool.Pool, opts ...StoreOption) *Store {
	store := &Store{
		db:              db,
		defaultLanguage: DefaultLanguage,
	}
	for _, opt := range opts {
		opt(store)
	}
	return store
}

type UpdateUserParams struct {
	Email    *string
	Name     *string
	Language *string
	Role     *string
	Status   *string
}

func (s *Store) CreateUser(ctx context.Context, email, passwordHash string) (*User, error) {
	return s.CreateUserWithRole(ctx, email, passwordHash, RoleUser)
}

func (s *Store) CreateUserWithRole(ctx context.Context, email, passwordHash, role string) (*User, error) {
	return s.CreateUserWithRoleAndProfile(ctx, email, passwordHash, role, "", "")
}

func (s *Store) CreateUserWithRoleAndProfile(ctx context.Context, email, passwordHash, role, name, language string) (*User, error) {
	id, err := ids.New("usr")
	if err != nil {
		return nil, err
	}
	if role != RoleAdmin {
		role = RoleUser
	}
	name, ok := NormalizeName(name)
	if !ok {
		name = ""
	}
	if normalized, ok := NormalizeLanguage(language); ok {
		language = normalized
	} else {
		language = s.defaultLanguage
	}

	var user User
	err = s.db.QueryRow(ctx, `
		INSERT INTO users (id, email, name, password_hash, role, language)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, email, name, language, password_hash, status, role, created_at, updated_at
	`, id, NormalizeEmail(email), name, passwordHash, role, language).Scan(
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
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrEmailExists
		}
		return nil, err
	}
	return &user, nil
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, email, name, language, password_hash, status, role, created_at, updated_at
		FROM users
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]User, 0)
	for rows.Next() {
		var user User
		if err := rows.Scan(
			&user.ID,
			&user.Email,
			&user.Name,
			&user.Language,
			&user.PasswordHash,
			&user.Status,
			&user.Role,
			&user.CreatedAt,
			&user.UpdatedAt,
		); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		SELECT id, email, name, language, password_hash, status, role, created_at, updated_at
		FROM users
		WHERE email = $1
	`, NormalizeEmail(email)).Scan(
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
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Store) UpdatePasswordHash(ctx context.Context, id, passwordHash string) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE users
		SET password_hash = $1, updated_at = now()
		WHERE id = $2
	`, passwordHash, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UpdateUser(ctx context.Context, id string, params UpdateUserParams) (*User, error) {
	if params.Email == nil && params.Name == nil && params.Language == nil && params.Role == nil && params.Status == nil {
		return s.GetUserByID(ctx, id)
	}

	var email any
	if params.Email != nil {
		normalized := NormalizeEmail(*params.Email)
		email = normalized
	}
	var name any
	if params.Name != nil {
		name = *params.Name
	}
	var language any
	if params.Language != nil {
		nextLanguage := DefaultLanguage
		if normalized, ok := NormalizeLanguage(*params.Language); ok {
			nextLanguage = normalized
		}
		language = nextLanguage
	}
	var role any
	if params.Role != nil {
		nextRole := RoleUser
		if *params.Role == RoleAdmin {
			nextRole = RoleAdmin
		}
		role = nextRole
	}
	var status any
	if params.Status != nil {
		nextStatus := StatusActive
		if *params.Status == StatusBanned {
			nextStatus = StatusBanned
		}
		status = nextStatus
	}

	var user User
	err := s.db.QueryRow(ctx, `
		UPDATE users
		SET email = COALESCE($2, email),
		    name = COALESCE($3, name),
		    language = COALESCE($4, language),
		    role = COALESCE($5, role),
		    status = COALESCE($6, status),
		    updated_at = now()
		WHERE id = $1
		RETURNING id, email, name, language, password_hash, status, role, created_at, updated_at
	`, id, email, name, language, role, status).Scan(
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
		return nil, ErrNotFound
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrEmailExists
		}
		return nil, err
	}
	return &user, nil
}

func (s *Store) UpdateRole(ctx context.Context, id, role string) error {
	if role != RoleAdmin {
		role = RoleUser
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE users
		SET role = $1, updated_at = now()
		WHERE id = $2
	`, role, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetUserByID(ctx context.Context, id string) (*User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		SELECT id, email, name, language, password_hash, status, role, created_at, updated_at
		FROM users
		WHERE id = $1
	`, id).Scan(
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
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

var (
	ErrNotFound    = errors.New("not found")
	ErrEmailExists = errors.New("email already exists")
)
