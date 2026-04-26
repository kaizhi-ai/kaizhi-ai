package apikeys

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"kaizhi/backend/internal/ids"
)

const (
	// SessionTTL is the absolute lifetime of a freshly minted session key.
	SessionTTL = 7 * 24 * time.Hour
	// SessionSlidingExtension is how far expires_at is pushed on each use.
	// Active users stay logged in indefinitely; idle ones drop after this.
	SessionSlidingExtension = 24 * time.Hour
)

type Service struct {
	store  *Store
	pepper string
}

func NewService(store *Store, pepper string) (*Service, error) {
	pepper = strings.TrimSpace(pepper)
	if pepper == "" {
		return nil, fmt.Errorf("API_KEY_PEPPER is required")
	}
	return &Service{store: store, pepper: pepper}, nil
}

type CreateUserKeyOptions struct {
	Name      string
	ExpiresAt *time.Time
}

func (s *Service) CreateUserKey(ctx context.Context, userID string, opts CreateUserKeyOptions) (*CreatedAPIKey, error) {
	name := strings.TrimSpace(opts.Name)
	if name == "" {
		name = "Default"
	}
	return s.create(ctx, createParams{
		UserID:    userID,
		Name:      name,
		Kind:      KindUser,
		ExpiresAt: opts.ExpiresAt,
	})
}

// IssueSession mints a session key for the given user. Returns the plaintext
// once; only the hash is stored.
func (s *Service) IssueSession(ctx context.Context, userID string) (*CreatedAPIKey, error) {
	expiresAt := time.Now().UTC().Add(SessionTTL)
	return s.create(ctx, createParams{
		UserID:    userID,
		Name:      "Session",
		Kind:      KindSession,
		ExpiresAt: &expiresAt,
	})
}

type createParams struct {
	UserID    string
	Name      string
	Kind      string
	ExpiresAt *time.Time
}

func (s *Service) create(ctx context.Context, params createParams) (*CreatedAPIKey, error) {
	id, err := ids.New("ak")
	if err != nil {
		return nil, err
	}
	rawKey, prefix, err := GenerateRawAPIKey()
	if err != nil {
		return nil, err
	}
	keyHash, err := HashAPIKey(s.pepper, rawKey)
	if err != nil {
		return nil, err
	}
	apiKey, err := s.store.Create(ctx, CreateParams{
		ID:        id,
		UserID:    params.UserID,
		Name:      params.Name,
		Kind:      params.Kind,
		KeyPrefix: prefix,
		KeyHash:   keyHash,
		ExpiresAt: params.ExpiresAt,
	})
	if err != nil {
		return nil, err
	}
	return &CreatedAPIKey{APIKey: *apiKey, Key: rawKey}, nil
}

// Authenticate verifies the raw key and returns the matching api key. For
// kind='session', expires_at is slid forward asynchronously of the caller via
// TouchAndExtend; for kind='user', only last_used_at is bumped.
func (s *Service) Authenticate(ctx context.Context, rawKey string) (*APIKey, error) {
	keyHash, err := HashAPIKey(s.pepper, rawKey)
	if err != nil {
		return nil, err
	}
	key, err := s.store.FindActiveByHash(ctx, keyHash)
	if err != nil {
		return nil, err
	}
	touchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if key.Kind == KindSession {
		extended := time.Now().UTC().Add(SessionSlidingExtension)
		_ = s.store.TouchAndExtend(touchCtx, key.ID, &extended)
	} else {
		_ = s.store.Touch(touchCtx, key.ID)
	}
	return key, nil
}

func (s *Service) RevokeSession(ctx context.Context, keyID string) error {
	if err := s.store.RevokeByID(ctx, keyID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}
	return nil
}
