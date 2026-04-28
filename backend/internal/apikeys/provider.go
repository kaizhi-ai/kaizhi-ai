package apikeys

import (
	"context"
	"net/http"

	"github.com/router-for-me/CLIProxyAPI/v6/sdk/access"
	"kaizhi/backend/internal/users"
)

type AccessProvider struct {
	apiKeys *Service
	users   *users.Store
}

func NewAccessProvider(apiKeys *Service, userStore *users.Store) *AccessProvider {
	return &AccessProvider{apiKeys: apiKeys, users: userStore}
}

func (p *AccessProvider) Identifier() string {
	return "kaizhi-api-key"
}

func (p *AccessProvider) Authenticate(ctx context.Context, r *http.Request) (*access.Result, *access.AuthError) {
	if p == nil || p.apiKeys == nil || p.users == nil {
		return nil, access.NewInternalAuthError("API key provider is not configured", nil)
	}

	rawKey := ExtractBearer(r.Header.Get("Authorization"))
	if rawKey == "" {
		rawKey = r.Header.Get("X-API-Key")
	}
	if rawKey == "" {
		return nil, access.NewNoCredentialsError()
	}

	apiKey, err := p.apiKeys.Authenticate(ctx, rawKey)
	if err != nil {
		return nil, access.NewInvalidCredentialError()
	}

	quota, err := p.users.GetQuotaState(ctx, apiKey.UserID)
	if err != nil {
		return nil, access.NewInternalAuthError("Failed to check user quota", err)
	}
	if quota.Exceeded() {
		return nil, &access.AuthError{
			Code:       access.AuthErrorCode("quota_exceeded"),
			Message:    "Quota exceeded",
			StatusCode: http.StatusTooManyRequests,
		}
	}

	return &access.Result{
		Provider:  p.Identifier(),
		Principal: apiKey.ID,
		Metadata: map[string]string{
			"user_id":    apiKey.UserID,
			"api_key_id": apiKey.ID,
			"kind":       apiKey.Kind,
		},
	}, nil
}
