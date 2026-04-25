package apikeys_test

import (
	"net/http"
	"strings"
	"testing"

	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/testutil"
)

func TestAPIKeyCreateListAndRevoke(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.RegisterUser(t, env.Router, "keys@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "integration key")
	if createdKey.ID == "" || createdKey.UserID != user.User.ID {
		t.Fatalf("created api key = %+v, want id and user id", createdKey)
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
		t.Fatalf("listed api keys = %d, want 1", len(listKeysBody.APIKeys))
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
}

func TestAPIKeysRequireUserToken(t *testing.T) {
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
}
