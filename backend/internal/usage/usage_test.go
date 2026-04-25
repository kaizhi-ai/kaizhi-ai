package usage_test

import (
	"net/http"
	"testing"

	"kaizhi/backend/internal/testutil"
	appusage "kaizhi/backend/internal/usage"
)

func TestUsageEndpoints(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.RegisterUser(t, env.Router, "usage@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "usage key")
	requestedAt := testutil.InsertUsageEvent(t, env.UsageStore, user.User.ID, createdKey.ID)
	from := requestedAt.AddDate(0, 0, -1).Format("2006-01-02")
	to := requestedAt.AddDate(0, 0, 1).Format("2006-01-02")

	usageResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage?from="+from+"&to="+to, user.AccessToken, nil)
	if usageResp.Code != http.StatusOK {
		t.Fatalf("usage status = %d, body = %s", usageResp.Code, usageResp.Body.String())
	}
	var usageBody struct {
		Usage appusage.Summary `json:"usage"`
	}
	testutil.DecodeJSON(t, usageResp, &usageBody)
	if usageBody.Usage.RequestCount != 1 || usageBody.Usage.TotalTokens != 33 {
		t.Fatalf("usage summary = %+v, want 1 request and 33 tokens", usageBody.Usage)
	}

	usageByKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage/api-keys?from="+from+"&to="+to, user.AccessToken, nil)
	if usageByKeyResp.Code != http.StatusOK {
		t.Fatalf("usage by key status = %d, body = %s", usageByKeyResp.Code, usageByKeyResp.Body.String())
	}
	var usageByKeyBody struct {
		APIKeys []appusage.APIKeyUsage `json:"api_keys"`
	}
	testutil.DecodeJSON(t, usageByKeyResp, &usageByKeyBody)
	if len(usageByKeyBody.APIKeys) != 1 || usageByKeyBody.APIKeys[0].APIKeyID != createdKey.ID || usageByKeyBody.APIKeys[0].TotalTokens != 33 {
		t.Fatalf("usage by key = %+v, want created key with 33 tokens", usageByKeyBody.APIKeys)
	}

	usageByModelResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage/models?from="+from+"&to="+to, user.AccessToken, nil)
	if usageByModelResp.Code != http.StatusOK {
		t.Fatalf("usage by model status = %d, body = %s", usageByModelResp.Code, usageByModelResp.Body.String())
	}
	var usageByModelBody struct {
		Models []appusage.ModelUsage `json:"models"`
	}
	testutil.DecodeJSON(t, usageByModelResp, &usageByModelBody)
	if len(usageByModelBody.Models) != 1 || usageByModelBody.Models[0].Model != "gpt-test" || usageByModelBody.Models[0].TotalTokens != 33 {
		t.Fatalf("usage by model = %+v, want gpt-test with 33 tokens", usageByModelBody.Models)
	}
}

func TestUsageRequiresUserToken(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	resp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage", "", nil)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("usage without token status = %d, body = %s", resp.Code, resp.Body.String())
	}
}
