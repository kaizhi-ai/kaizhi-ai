package apikeys_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/testutil"
	"kaizhi/backend/internal/users"
)

func TestAPIKeyProviderAuthentication(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "provider@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "provider key")

	provider := apikeys.NewAccessProvider(env.APIKeys, env.UserStore)
	authReq := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	authReq.Header.Set("Authorization", "Bearer "+createdKey.Key)
	authResult, authErr := provider.Authenticate(context.Background(), authReq)
	if authErr != nil {
		t.Fatalf("provider auth error = %v", authErr)
	}
	if authResult.Principal != createdKey.ID {
		t.Fatalf("auth principal = %q, want api key id %q", authResult.Principal, createdKey.ID)
	}
	if authResult.Metadata["user_id"] != user.User.ID {
		t.Fatalf("auth user metadata = %q, want %q", authResult.Metadata["user_id"], user.User.ID)
	}

	revokeResp := testutil.DoJSON(t, env.Router, http.MethodDelete, "/api/v1/api-keys/"+createdKey.ID, user.AccessToken, nil)
	if revokeResp.Code != http.StatusNoContent {
		t.Fatalf("revoke api key status = %d, body = %s", revokeResp.Code, revokeResp.Body.String())
	}
	if _, authErr := provider.Authenticate(context.Background(), authReq); authErr == nil {
		t.Fatal("expected revoked api key to fail provider authentication")
	}
}

func TestAPIKeyProviderRejectsMissingAndInvalidCredentials(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	provider := apikeys.NewAccessProvider(env.APIKeys, env.UserStore)
	missingReq := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	if _, authErr := provider.Authenticate(context.Background(), missingReq); authErr == nil {
		t.Fatal("expected missing api key to fail provider authentication")
	}

	invalidReq := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	invalidReq.Header.Set("Authorization", "Bearer kz_live_invalid")
	if _, authErr := provider.Authenticate(context.Background(), invalidReq); authErr == nil {
		t.Fatal("expected invalid api key to fail provider authentication")
	}
}

func TestAPIKeyProviderRejectsExceededUserQuota(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "provider-quota@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "provider key")
	zero := "0"
	if _, err := env.UserStore.UpdateUser(context.Background(), user.User.ID, users.UpdateUserParams{
		Quota5HCostUSDSet: true,
		Quota5HCostUSD:    &zero,
	}); err != nil {
		t.Fatalf("set quota: %v", err)
	}

	provider := apikeys.NewAccessProvider(env.APIKeys, env.UserStore)
	authReq := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	authReq.Header.Set("Authorization", "Bearer "+createdKey.Key)
	if _, authErr := provider.Authenticate(context.Background(), authReq); authErr == nil {
		t.Fatal("expected exceeded quota to fail provider authentication")
	} else if authErr.HTTPStatusCode() != http.StatusTooManyRequests {
		t.Fatalf("quota auth status = %d, want 429", authErr.HTTPStatusCode())
	}
}
