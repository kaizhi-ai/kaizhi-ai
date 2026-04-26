package apikeys_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/testutil"
)

func TestAPIKeyCreateListAndRevoke(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "keys@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "integration key")
	if createdKey.ID == "" || createdKey.UserID != user.User.ID {
		t.Fatalf("created api key = %+v, want id and user id", createdKey)
	}
	if createdKey.Kind != apikeys.KindUser {
		t.Fatalf("created kind = %q, want %q", createdKey.Kind, apikeys.KindUser)
	}
	if createdKey.ExpiresAt == nil {
		t.Fatal("expected default expires_at to be set (90 days)")
	}
	if !strings.HasPrefix(createdKey.Key, "kz_live_") {
		t.Fatalf("created raw api key = %q, want kz_live_ prefix", createdKey.Key)
	}
	if createdKey.KeyHash != "" {
		t.Fatal("api key hash must not be returned in JSON")
	}

	listKeysResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/api-keys", user.AccessToken, nil)
	if listKeysResp.Code != http.StatusOK {
		t.Fatalf("list api keys status = %d, body = %s", listKeysResp.Code, listKeysResp.Body.String())
	}
	var listKeysBody struct {
		APIKeys []apikeys.APIKey `json:"api_keys"`
	}
	testutil.DecodeJSON(t, listKeysResp, &listKeysBody)
	if len(listKeysBody.APIKeys) != 1 {
		t.Fatalf("listed api keys = %d, want 1 (session key must be hidden)", len(listKeysBody.APIKeys))
	}
	if listKeysBody.APIKeys[0].ID != createdKey.ID {
		t.Fatalf("listed api key id = %q, want %q", listKeysBody.APIKeys[0].ID, createdKey.ID)
	}
	if listKeysBody.APIKeys[0].KeyHash != "" {
		t.Fatal("listed api key hash must not be returned in JSON")
	}

	revokeResp := testutil.DoJSON(t, env.Router, http.MethodDelete, "/api/v1/api-keys/"+createdKey.ID, user.AccessToken, nil)
	if revokeResp.Code != http.StatusNoContent {
		t.Fatalf("revoke api key status = %d, body = %s", revokeResp.Code, revokeResp.Body.String())
	}

	listAfterRevokeResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/api-keys", user.AccessToken, nil)
	if listAfterRevokeResp.Code != http.StatusOK {
		t.Fatalf("list after revoke status = %d, body = %s", listAfterRevokeResp.Code, listAfterRevokeResp.Body.String())
	}
	var listAfterRevokeBody struct {
		APIKeys []apikeys.APIKey `json:"api_keys"`
	}
	testutil.DecodeJSON(t, listAfterRevokeResp, &listAfterRevokeBody)
	if len(listAfterRevokeBody.APIKeys) != 1 {
		t.Fatalf("listed api keys after revoke = %d, want 1", len(listAfterRevokeBody.APIKeys))
	}
	if listAfterRevokeBody.APIKeys[0].Status != apikeys.StatusRevoked {
		t.Fatalf("listed api key status after revoke = %q, want %q", listAfterRevokeBody.APIKeys[0].Status, apikeys.StatusRevoked)
	}
}

func TestAPIKeyRename(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "rename-key@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "old name")

	renameResp := testutil.DoJSON(t, env.Router, http.MethodPatch, "/api/v1/api-keys/"+createdKey.ID, user.AccessToken, map[string]string{
		"name": "new name",
	})
	if renameResp.Code != http.StatusOK {
		t.Fatalf("rename api key status = %d, body = %s", renameResp.Code, renameResp.Body.String())
	}
	var renamed apikeys.APIKey
	testutil.DecodeJSON(t, renameResp, &renamed)
	if renamed.Name != "new name" {
		t.Fatalf("renamed api key name = %q, want new name", renamed.Name)
	}
	if renamed.KeyHash != "" {
		t.Fatal("renamed api key hash must not be returned in JSON")
	}

	listResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/api-keys", user.AccessToken, nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("list api keys status = %d, body = %s", listResp.Code, listResp.Body.String())
	}
	var listBody struct {
		APIKeys []apikeys.APIKey `json:"api_keys"`
	}
	testutil.DecodeJSON(t, listResp, &listBody)
	if len(listBody.APIKeys) != 1 || listBody.APIKeys[0].Name != "new name" {
		t.Fatalf("listed api keys = %+v, want renamed key", listBody.APIKeys)
	}

	postRenameResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/api-keys/"+createdKey.ID+"/rename", user.AccessToken, map[string]string{
		"name": "post renamed",
	})
	if postRenameResp.Code != http.StatusOK {
		t.Fatalf("post rename api key status = %d, body = %s", postRenameResp.Code, postRenameResp.Body.String())
	}
	var postRenamed apikeys.APIKey
	testutil.DecodeJSON(t, postRenameResp, &postRenamed)
	if postRenamed.Name != "post renamed" {
		t.Fatalf("post renamed api key name = %q, want post renamed", postRenamed.Name)
	}
}

func TestAPIKeyCreateNeverExpires(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "never@example.com", "password123")
	resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/api-keys", user.AccessToken, map[string]string{
		"name":       "no-expiry",
		"expires_in": "never",
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("create api key status = %d, body = %s", resp.Code, resp.Body.String())
	}
	var created apikeys.CreatedAPIKey
	testutil.DecodeJSON(t, resp, &created)
	if created.ExpiresAt != nil {
		t.Fatalf("expires_at = %v, want nil for never", created.ExpiresAt)
	}
}

func TestAPIKeyCreateRejectsInvalidExpiresIn(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "bad-expiry@example.com", "password123")
	resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/api-keys", user.AccessToken, map[string]string{
		"expires_in": "forever",
	})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.Code)
	}
}

func TestAPIKeyAuthenticateRejectsExpired(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "expired@example.com", "password123")
	created, err := env.APIKeys.CreateUserKey(context.Background(), user.User.ID, apikeys.CreateUserKeyOptions{
		Name:      "soon",
		ExpiresAt: timePtr(time.Now().UTC().AddDate(0, 0, 1)),
	})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}

	if _, err := env.APIKeys.Authenticate(context.Background(), created.Key); err != nil {
		t.Fatalf("authenticate before expiry: %v", err)
	}

	if err := env.APIKeyStore.SetExpiresAt(context.Background(), created.ID, timePtr(time.Now().UTC().Add(-time.Minute))); err != nil {
		t.Fatalf("force expiry: %v", err)
	}

	_, err = env.APIKeys.Authenticate(context.Background(), created.Key)
	if !errors.Is(err, apikeys.ErrExpired) {
		t.Fatalf("authenticate after expiry err = %v, want ErrExpired", err)
	}
}

func TestSessionKeyExpirySlidesOnUse(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "slide@example.com", "password123")
	original, err := env.APIKeyStore.GetByID(context.Background(), user.SessionKeyID)
	if err != nil {
		t.Fatalf("load session key: %v", err)
	}
	if original.ExpiresAt == nil {
		t.Fatal("session key must have expires_at")
	}

	// Force expires_at into the past relative to "after extension" so we can
	// see the sliding window push it forward. We push it to now+1h, then call
	// Authenticate, and assert it moved out toward now+24h.
	near := time.Now().UTC().Add(time.Hour)
	if err := env.APIKeyStore.SetExpiresAt(context.Background(), original.ID, &near); err != nil {
		t.Fatalf("seed near expiry: %v", err)
	}

	if _, err := env.APIKeys.Authenticate(context.Background(), user.AccessToken); err != nil {
		t.Fatalf("authenticate session: %v", err)
	}

	updated, err := env.APIKeyStore.GetByID(context.Background(), original.ID)
	if err != nil {
		t.Fatalf("reload session key: %v", err)
	}
	if updated.ExpiresAt == nil || !updated.ExpiresAt.After(near.Add(time.Hour)) {
		t.Fatalf("expires_at = %v, want pushed past %v", updated.ExpiresAt, near.Add(time.Hour))
	}
}

func TestAPIKeysRequireSessionToken(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	listResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/api-keys", "", nil)
	if listResp.Code != http.StatusUnauthorized {
		t.Fatalf("list without token status = %d, body = %s", listResp.Code, listResp.Body.String())
	}

	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/api-keys", "", map[string]string{"name": "no auth"})
	if createResp.Code != http.StatusUnauthorized {
		t.Fatalf("create without token status = %d, body = %s", createResp.Code, createResp.Body.String())
	}

	user := testutil.SeedUser(t, env, "user-key-blocked@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "model traffic only")
	userKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/api-keys", createdKey.Key, nil)
	if userKeyResp.Code != http.StatusUnauthorized {
		t.Fatalf("list with user api key status = %d, want 401", userKeyResp.Code)
	}
}

func timePtr(t time.Time) *time.Time { return &t }
