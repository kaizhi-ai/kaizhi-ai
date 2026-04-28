package users

import (
	"context"
	"database/sql"
	"errors"
	"time"

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
	Email             *string
	Name              *string
	Language          *string
	Role              *string
	Status            *string
	Quota5HCostUSD    *string
	Quota5HCostUSDSet bool
	Quota7DCostUSD    *string
	Quota7DCostUSDSet bool
}

const NormalizedUserColumnsSQL = `
	id, email, name, language, password_hash, status, role,
	quota_5h_cost_usd::text,
	quota_7d_cost_usd::text,
	CASE
		WHEN now() >= usage_5h_started_at + interval '5 hours' THEN 0::numeric(30, 12)
		ELSE usage_5h_cost_usd
	END::text,
	CASE
		WHEN now() >= usage_7d_started_at + interval '7 days' THEN 0::numeric(30, 12)
		ELSE usage_7d_cost_usd
	END::text,
	usage_5h_started_at, usage_7d_started_at,
	CASE
		WHEN now() >= usage_5h_started_at + interval '5 hours' THEN NULL
		ELSE usage_5h_started_at + interval '5 hours'
	END,
	CASE
		WHEN now() >= usage_7d_started_at + interval '7 days' THEN NULL
		ELSE usage_7d_started_at + interval '7 days'
	END,
	created_at, updated_at
`

type QuotaState struct {
	Usage5HCostUSD string
	Usage7DCostUSD string
	Quota5HCostUSD *string
	Quota7DCostUSD *string
	Exceeded5H     bool
	Exceeded7D     bool
}

func (q *QuotaState) Exceeded() bool {
	return q != nil && (q.Exceeded5H || q.Exceeded7D)
}

func ScanUser(row interface{ Scan(dest ...any) error }, user *User) error {
	if user == nil {
		return errors.New("user scan target is nil")
	}
	return row.Scan(userScanDest(user)...)
}

func userScanDest(user *User) []any {
	return []any{
		&user.ID,
		&user.Email,
		&user.Name,
		&user.Language,
		&user.PasswordHash,
		&user.Status,
		&user.Role,
		nullStringScanner(&user.Quota5HCostUSD),
		nullStringScanner(&user.Quota7DCostUSD),
		&user.Usage5HCostUSD,
		&user.Usage7DCostUSD,
		&user.Usage5HStartedAt,
		&user.Usage7DStartedAt,
		nullTimeScanner(&user.Usage5HResetAt),
		nullTimeScanner(&user.Usage7DResetAt),
		&user.CreatedAt,
		&user.UpdatedAt,
	}
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
	err = ScanUser(s.db.QueryRow(ctx, `
		INSERT INTO users (id, email, name, password_hash, role, language)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+NormalizedUserColumnsSQL+`
	`, id, NormalizeEmail(email), name, passwordHash, role, language), &user)
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
		SELECT `+NormalizedUserColumnsSQL+`
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
		if err := ScanUser(rows, &user); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	err := ScanUser(s.db.QueryRow(ctx, `
		SELECT `+NormalizedUserColumnsSQL+`
		FROM users
		WHERE email = $1
	`, NormalizeEmail(email)), &user)
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
	if params.Email == nil && params.Name == nil && params.Language == nil && params.Role == nil && params.Status == nil && !params.Quota5HCostUSDSet && !params.Quota7DCostUSDSet {
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
	var quota5H any
	if params.Quota5HCostUSDSet && params.Quota5HCostUSD != nil {
		quota5H = *params.Quota5HCostUSD
	}
	var quota7D any
	if params.Quota7DCostUSDSet && params.Quota7DCostUSD != nil {
		quota7D = *params.Quota7DCostUSD
	}

	var user User
	err := ScanUser(s.db.QueryRow(ctx, `
		UPDATE users
		SET email = COALESCE($2, email),
		    name = COALESCE($3, name),
		    language = COALESCE($4, language),
		    role = COALESCE($5, role),
		    status = COALESCE($6, status),
		    quota_5h_cost_usd = CASE WHEN $7::boolean THEN $8::numeric ELSE quota_5h_cost_usd END,
		    quota_7d_cost_usd = CASE WHEN $9::boolean THEN $10::numeric ELSE quota_7d_cost_usd END,
		    updated_at = now()
		WHERE id = $1
		RETURNING `+NormalizedUserColumnsSQL+`
	`, id, email, name, language, role, status, params.Quota5HCostUSDSet, quota5H, params.Quota7DCostUSDSet, quota7D), &user)
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
	err := ScanUser(s.db.QueryRow(ctx, `
		SELECT `+NormalizedUserColumnsSQL+`
		FROM users
		WHERE id = $1
	`, id), &user)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Store) GetQuotaState(ctx context.Context, id string) (*QuotaState, error) {
	var state QuotaState
	err := s.db.QueryRow(ctx, `
		WITH normalized AS (
			SELECT
				CASE
					WHEN now() >= usage_5h_started_at + interval '5 hours' THEN 0::numeric(30, 12)
					ELSE usage_5h_cost_usd
				END AS usage_5h_cost_usd,
				CASE
					WHEN now() >= usage_7d_started_at + interval '7 days' THEN 0::numeric(30, 12)
					ELSE usage_7d_cost_usd
				END AS usage_7d_cost_usd,
				quota_5h_cost_usd,
				quota_7d_cost_usd
			FROM users
			WHERE id = $1
		)
		SELECT
			usage_5h_cost_usd::text,
			usage_7d_cost_usd::text,
			quota_5h_cost_usd::text,
			quota_7d_cost_usd::text,
			quota_5h_cost_usd IS NOT NULL AND usage_5h_cost_usd >= quota_5h_cost_usd,
			quota_7d_cost_usd IS NOT NULL AND usage_7d_cost_usd >= quota_7d_cost_usd
		FROM normalized
	`, id).Scan(
		&state.Usage5HCostUSD,
		&state.Usage7DCostUSD,
		nullStringScanner(&state.Quota5HCostUSD),
		nullStringScanner(&state.Quota7DCostUSD),
		&state.Exceeded5H,
		&state.Exceeded7D,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &state, nil
}

func nullStringScanner(target **string) any {
	return &nullableString{target: target}
}

func nullTimeScanner(target **time.Time) any {
	return &nullableTime{target: target}
}

type nullableString struct {
	target **string
}

func (n *nullableString) Scan(value any) error {
	var ns sql.NullString
	if err := ns.Scan(value); err != nil {
		return err
	}
	if ns.Valid {
		v := ns.String
		*n.target = &v
		return nil
	}
	*n.target = nil
	return nil
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
		v := nt.Time
		*n.target = &v
		return nil
	}
	*n.target = nil
	return nil
}

var (
	ErrNotFound    = errors.New("not found")
	ErrEmailExists = errors.New("email already exists")
)
