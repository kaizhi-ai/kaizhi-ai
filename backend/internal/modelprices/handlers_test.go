package modelprices_test

import (
	"context"
	"net/http"
	"testing"

	"kaizhi/backend/internal/modelprices"
	"kaizhi/backend/internal/testutil"
	"kaizhi/backend/internal/users"
)

func TestAdminModelPriceCRUD(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	admin := seedAdmin(t, env, "prices-admin@example.com")
	payload := map[string]any{
		"model":                       "gpt-test",
		"input_usd_per_million":       "1.25",
		"cache_read_usd_per_million":  "0.125",
		"cache_write_usd_per_million": "1.5625",
		"output_usd_per_million":      "10",
		"reasoning_usd_per_million":   "2.5",
		"note":                        "test price",
	}

	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/model-prices", admin.AccessToken, payload)
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createResp.Code, createResp.Body.String())
	}
	var createdBody struct {
		Price struct {
			ID                      string  `json:"id"`
			Model                   string  `json:"model"`
			InputUSDPerMillion      string  `json:"input_usd_per_million"`
			CacheReadUSDPerMillion  *string `json:"cache_read_usd_per_million"`
			CacheWriteUSDPerMillion *string `json:"cache_write_usd_per_million"`
		} `json:"price"`
	}
	testutil.DecodeJSON(t, createResp, &createdBody)
	if createdBody.Price.ID == "" || createdBody.Price.Model != "gpt-test" {
		t.Fatalf("created price = %+v, want gpt-test with id", createdBody.Price)
	}
	if createdBody.Price.InputUSDPerMillion != "1.25000000" ||
		createdBody.Price.CacheReadUSDPerMillion == nil ||
		*createdBody.Price.CacheReadUSDPerMillion != "0.12500000" ||
		createdBody.Price.CacheWriteUSDPerMillion == nil ||
		*createdBody.Price.CacheWriteUSDPerMillion != "1.56250000" {
		t.Fatalf("created price values = %+v", createdBody.Price)
	}

	payload["output_usd_per_million"] = "12"
	payload["note"] = "updated"
	updateResp := testutil.DoJSON(t, env.Router, http.MethodPatch, "/api/v1/admin/model-prices/"+createdBody.Price.ID, admin.AccessToken, payload)
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", updateResp.Code, updateResp.Body.String())
	}
	var updatedBody struct {
		Price struct {
			OutputUSDPerMillion string `json:"output_usd_per_million"`
			Note                string `json:"note"`
		} `json:"price"`
	}
	testutil.DecodeJSON(t, updateResp, &updatedBody)
	if updatedBody.Price.OutputUSDPerMillion != "12.00000000" || updatedBody.Price.Note != "updated" {
		t.Fatalf("updated price = %+v", updatedBody.Price)
	}

	listResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/model-prices?q=gpt-test", admin.AccessToken, nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", listResp.Code, listResp.Body.String())
	}
	var listBody struct {
		Prices []struct {
			ID string `json:"id"`
		} `json:"prices"`
	}
	testutil.DecodeJSON(t, listResp, &listBody)
	if len(listBody.Prices) != 1 || listBody.Prices[0].ID != createdBody.Price.ID {
		t.Fatalf("listed prices = %+v, want created price", listBody.Prices)
	}

	deleteResp := testutil.DoJSON(t, env.Router, http.MethodDelete, "/api/v1/admin/model-prices/"+createdBody.Price.ID, admin.AccessToken, nil)
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", deleteResp.Code, deleteResp.Body.String())
	}
}

func TestAdminModelPriceRoutesRequireAdmin(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "prices-user@example.com", "password123")
	resp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/model-prices", user.AccessToken, nil)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("non-admin status = %d, want 403", resp.Code)
	}
}

func TestAdminModelPriceRejectsTooLargeDecimal(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	admin := seedAdmin(t, env, "prices-too-large@example.com")
	payload := map[string]any{
		"model":                  "too-large-price",
		"input_usd_per_million":  "1000000000000",
		"output_usd_per_million": "1",
	}

	resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/model-prices", admin.AccessToken, payload)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("too-large decimal status = %d, body = %s", resp.Code, resp.Body.String())
	}
	var body struct {
		Error string `json:"error"`
	}
	testutil.DecodeJSON(t, resp, &body)
	if body.Error == "" {
		t.Fatalf("too-large decimal error is empty")
	}
}

func TestAdminModelPricesListUnmatched(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	admin := seedAdmin(t, env, "prices-unmatched@example.com")
	key := testutil.CreateAPIKey(t, env.Router, admin.AccessToken, "usage key")
	requestedAt := testutil.InsertUsageEvent(t, env.UsageStore, admin.User.ID, key.ID)
	from := requestedAt.AddDate(0, 0, -1).Format("2006-01-02")
	to := requestedAt.AddDate(0, 0, 1).Format("2006-01-02")

	resp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/model-prices/unmatched?from="+from+"&to="+to, admin.AccessToken, nil)
	if resp.Code != http.StatusOK {
		t.Fatalf("unmatched status = %d, body = %s", resp.Code, resp.Body.String())
	}
	var body struct {
		Models []struct {
			Model       string `json:"model"`
			TotalTokens int64  `json:"total_tokens"`
		} `json:"models"`
	}
	testutil.DecodeJSON(t, resp, &body)
	if len(body.Models) != 1 || body.Models[0].Model != "gpt-test" || body.Models[0].TotalTokens != 33 {
		t.Fatalf("unmatched models = %+v, want gpt-test", body.Models)
	}
}

func TestAdminModelPricesImportDefaults(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	admin := seedAdmin(t, env, "prices-import@example.com")
	resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/model-prices/import-defaults", admin.AccessToken, nil)
	if resp.Code != http.StatusOK {
		t.Fatalf("import defaults status = %d, body = %s", resp.Code, resp.Body.String())
	}
	var body struct {
		Result modelprices.ImportResult `json:"result"`
	}
	testutil.DecodeJSON(t, resp, &body)
	if body.Result.Total != 23 || body.Result.Created != 23 || body.Result.Skipped != 0 {
		t.Fatalf("import result = %+v, want 23 created", body.Result)
	}

	secondResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/model-prices/import-defaults", admin.AccessToken, nil)
	if secondResp.Code != http.StatusOK {
		t.Fatalf("second import defaults status = %d, body = %s", secondResp.Code, secondResp.Body.String())
	}
	var secondBody struct {
		Result modelprices.ImportResult `json:"result"`
	}
	testutil.DecodeJSON(t, secondResp, &secondBody)
	if secondBody.Result.Total != 23 || secondBody.Result.Created != 0 || secondBody.Result.Skipped != 23 {
		t.Fatalf("second import result = %+v, want 23 skipped", secondBody.Result)
	}
}

func seedAdmin(t *testing.T, env *testutil.Env, email string) testutil.AuthResponse {
	t.Helper()
	admin := testutil.SeedUser(t, env, email, "password123")
	role := users.RoleAdmin
	if _, err := env.UserStore.UpdateUser(context.Background(), admin.User.ID, users.UpdateUserParams{Role: &role}); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	return admin
}
