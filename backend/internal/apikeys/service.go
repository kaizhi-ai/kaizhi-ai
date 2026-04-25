package apikeys

import (
	"context"
	"fmt"
	"strings"

	"kaizhi/backend/internal/ids"
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

func (s *Service) Create(ctx context.Context, userID, name string) (*CreatedAPIKey, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Default"
	}
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
		UserID:    userID,
		Name:      name,
		KeyPrefix: prefix,
		KeyHash:   keyHash,
	})
	if err != nil {
		return nil, err
	}
	return &CreatedAPIKey{APIKey: *apiKey, Key: rawKey}, nil
}

func (s *Service) Authenticate(ctx context.Context, rawKey string) (*APIKey, error) {
	keyHash, err := HashAPIKey(s.pepper, rawKey)
	if err != nil {
		return nil, err
	}
	return s.store.FindActiveByHash(ctx, keyHash)
}
