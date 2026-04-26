package apikeys

import (
	"context"
	"net/http"

	"github.com/router-for-me/CLIProxyAPI/v6/sdk/access"
)

type AccessProvider struct {
	apiKeys *Service
}

func NewAccessProvider(apiKeys *Service) *AccessProvider {
	return &AccessProvider{apiKeys: apiKeys}
}

func (p *AccessProvider) Identifier() string {
	return "kaizhi-api-key"
}

func (p *AccessProvider) Authenticate(ctx context.Context, r *http.Request) (*access.Result, *access.AuthError) {
	if p == nil || p.apiKeys == nil {
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
