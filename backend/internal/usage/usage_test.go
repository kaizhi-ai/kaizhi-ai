package usage_test

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"testing"
	"time"

	"kaizhi/backend/internal/modelprices"
	"kaizhi/backend/internal/testutil"
	appusage "kaizhi/backend/internal/usage"
	"kaizhi/backend/internal/users"
)

func TestUsageEndpoints(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "usage@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "usage key")
	reasoningPrice := "3"
	if _, err := env.PriceStore.Create(context.Background(), modelprices.SaveParams{
		Model:                  "gpt-test",
		InputUSDPerMillion:     "1",
		CacheReadUSDPerMillion: stringPtr("0.5"),
		OutputUSDPerMillion:    "2",
		ReasoningUSDPerMillion: &reasoningPrice,
	}); err != nil {
		t.Fatalf("create model price: %v", err)
	}
	requestedAt := testutil.InsertUsageEvent(t, env.UsageStore, user.User.ID, createdKey.ID)
	otherUser := testutil.SeedUser(t, env, "usage-other@example.com", "password123")
	otherKey := testutil.CreateAPIKey(t, env.Router, otherUser.AccessToken, "other usage key")
	testutil.InsertUsageEvent(t, env.UsageStore, otherUser.User.ID, otherKey.ID)
	from := requestedAt.AddDate(0, 0, -1).Format("2006-01-02")
	to := requestedAt.AddDate(0, 0, 1).Format("2006-01-02")

	deletedUserUsageResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage?from="+from+"&to="+to, user.AccessToken, nil)
	if deletedUserUsageResp.Code != http.StatusNotFound {
		t.Fatalf("deleted user usage status = %d, want 404, body = %s", deletedUserUsageResp.Code, deletedUserUsageResp.Body.String())
	}

	adminDeniedResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage?from="+from+"&to="+to, user.AccessToken, nil)
	if adminDeniedResp.Code != http.StatusForbidden {
		t.Fatalf("admin usage regular user status = %d, want 403, body = %s", adminDeniedResp.Code, adminDeniedResp.Body.String())
	}

	if err := env.UserStore.UpdateRole(context.Background(), user.User.ID, users.RoleAdmin); err != nil {
		t.Fatalf("promote usage user to admin: %v", err)
	}

	adminSummaryResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage?from="+from+"&to="+to, user.AccessToken, nil)
	if adminSummaryResp.Code != http.StatusOK {
		t.Fatalf("admin usage status = %d, body = %s", adminSummaryResp.Code, adminSummaryResp.Body.String())
	}
	var adminSummaryBody struct {
		Usage appusage.Summary `json:"usage"`
	}
	testutil.DecodeJSON(t, adminSummaryResp, &adminSummaryBody)
	if adminSummaryBody.Usage.RequestCount != 2 || adminSummaryBody.Usage.TotalTokens != 66 {
		t.Fatalf("admin usage summary = %+v, want site-wide 2 requests and 66 tokens", adminSummaryBody.Usage)
	}
	if adminSummaryBody.Usage.CostUSD == "" {
		t.Fatalf("admin usage summary cost is empty")
	}
	assertCost(t, adminSummaryBody.Usage.CostUSD, 0.000116)

	adminByKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage/api-keys?from="+from+"&to="+to, user.AccessToken, nil)
	if adminByKeyResp.Code != http.StatusOK {
		t.Fatalf("admin usage by key status = %d, body = %s", adminByKeyResp.Code, adminByKeyResp.Body.String())
	}
	var adminByKeyBody struct {
		APIKeys []appusage.APIKeyUsage `json:"api_keys"`
	}
	testutil.DecodeJSON(t, adminByKeyResp, &adminByKeyBody)
	if len(adminByKeyBody.APIKeys) != 2 {
		t.Fatalf("admin usage by key = %+v, want both user api keys", adminByKeyBody.APIKeys)
	}

	usageByUserResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage/users?from="+from+"&to="+to, user.AccessToken, nil)
	if usageByUserResp.Code != http.StatusOK {
		t.Fatalf("admin usage by user status = %d, body = %s", usageByUserResp.Code, usageByUserResp.Body.String())
	}
	var usageByUserBody struct {
		Users []appusage.UserUsage `json:"users"`
	}
	testutil.DecodeJSON(t, usageByUserResp, &usageByUserBody)
	if len(usageByUserBody.Users) != 2 {
		t.Fatalf("usage by user = %+v, want both users", usageByUserBody.Users)
	}
	var totalUserTokens int64
	seenUsers := map[string]bool{}
	for _, item := range usageByUserBody.Users {
		totalUserTokens += item.TotalTokens
		seenUsers[item.UserID] = true
		if item.UserEmail == "" || item.RequestCount != 1 || item.TotalTokens != 33 {
			t.Fatalf("usage by user item = %+v, want owner fields and one 33-token request", item)
		}
		assertCost(t, item.CostUSD, 0.000058)
	}
	if totalUserTokens != 66 || !seenUsers[user.User.ID] || !seenUsers[otherUser.User.ID] {
		t.Fatalf("usage by user = %+v, want site-wide users with 66 tokens", usageByUserBody.Users)
	}

	usageByModelResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage/models?from="+from+"&to="+to, user.AccessToken, nil)
	if usageByModelResp.Code != http.StatusOK {
		t.Fatalf("admin usage by model status = %d, body = %s", usageByModelResp.Code, usageByModelResp.Body.String())
	}
	var usageByModelBody struct {
		Models []appusage.ModelUsage `json:"models"`
	}
	testutil.DecodeJSON(t, usageByModelResp, &usageByModelBody)
	if len(usageByModelBody.Models) != 1 || usageByModelBody.Models[0].Model != "gpt-test" || usageByModelBody.Models[0].TotalTokens != 66 {
		t.Fatalf("usage by model = %+v, want site-wide gpt-test with 66 tokens", usageByModelBody.Models)
	}
	if usageByModelBody.Models[0].PriceMissing || usageByModelBody.Models[0].UnpricedTokens != 0 {
		t.Fatalf("usage by model price flags = %+v, want priced", usageByModelBody.Models[0])
	}
	assertCost(t, usageByModelBody.Models[0].CostUSD, 0.000116)
}

func TestUsageDateRangeUsesUTCDayBounds(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "usage-range@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "usage range key")
	insideAt := time.Date(2026, time.April, 7, 23, 59, 59, 0, time.UTC)
	outsideAt := time.Date(2026, time.April, 8, 0, 0, 0, 0, time.UTC)
	insertUsageEventAt(t, env.UsageStore, user.User.ID, createdKey.ID, "range-boundary", insideAt, 11)
	insertUsageEventAt(t, env.UsageStore, user.User.ID, createdKey.ID, "range-boundary", outsideAt, 29)

	summary, err := env.UsageStore.GetSummary(context.Background(), user.User.ID, insideAt, insideAt)
	if err != nil {
		t.Fatalf("GetSummary() error = %v", err)
	}
	if summary.RequestCount != 1 || summary.TotalTokens != 11 {
		t.Fatalf("summary = %+v, want only the event inside the UTC date", summary)
	}

	byKey, err := env.UsageStore.GetByAPIKey(context.Background(), user.User.ID, insideAt, insideAt)
	if err != nil {
		t.Fatalf("GetByAPIKey() error = %v", err)
	}
	if len(byKey) != 1 || byKey[0].APIKeyID != createdKey.ID || byKey[0].RequestCount != 1 || byKey[0].TotalTokens != 11 {
		t.Fatalf("usage by key = %+v, want only the event inside the UTC date", byKey)
	}

	byModel, err := env.UsageStore.GetByModel(context.Background(), user.User.ID, insideAt, insideAt)
	if err != nil {
		t.Fatalf("GetByModel() error = %v", err)
	}
	if len(byModel) != 1 || byModel[0].Model != "range-boundary" || byModel[0].RequestCount != 1 || byModel[0].TotalTokens != 11 {
		t.Fatalf("usage by model = %+v, want only the event inside the UTC date", byModel)
	}
}

func TestUsageCostUsesEventTimePriceSnapshot(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "usage-price-snapshot@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "usage key")
	reasoningPrice := "3"
	price, err := env.PriceStore.Create(context.Background(), modelprices.SaveParams{
		Model:                  "gpt-price-snapshot",
		InputUSDPerMillion:     "1",
		CacheReadUSDPerMillion: stringPtr("0.5"),
		OutputUSDPerMillion:    "2",
		ReasoningUSDPerMillion: &reasoningPrice,
	})
	if err != nil {
		t.Fatalf("create model price: %v", err)
	}

	usageID, err := testutil.NewID("use")
	if err != nil {
		t.Fatalf("NewID(use) error = %v", err)
	}
	requestedAt := requestedAtUTC()
	if err := env.UsageStore.InsertEvent(context.Background(), appusage.InsertEventParams{
		ID:                usageID,
		UserID:            user.User.ID,
		APIKeyID:          createdKey.ID,
		Provider:          "openai",
		Model:             "gpt-price-snapshot",
		UpstreamAuthID:    "upstream-auth",
		UpstreamAuthIndex: "upstream-index",
		UpstreamAuthType:  "api-key",
		Source:            "integration",
		InputTokens:       10,
		OutputTokens:      20,
		ReasoningTokens:   3,
		CacheReadTokens:   2,
		CachedTokens:      2,
		TotalTokens:       33,
		LatencyMS:         123,
		Failed:            false,
		RequestedAt:       requestedAt,
	}); err != nil {
		t.Fatalf("InsertEvent() error = %v", err)
	}

	changedReasoningPrice := "300"
	if _, err := env.PriceStore.Update(context.Background(), price.ID, modelprices.SaveParams{
		Model:                  "gpt-price-snapshot",
		InputUSDPerMillion:     "100",
		CacheReadUSDPerMillion: stringPtr("50"),
		OutputUSDPerMillion:    "200",
		ReasoningUSDPerMillion: &changedReasoningPrice,
	}); err != nil {
		t.Fatalf("update model price: %v", err)
	}

	summary, err := env.UsageStore.GetSummary(
		context.Background(),
		user.User.ID,
		requestedAt.AddDate(0, 0, -1),
		requestedAt.AddDate(0, 0, 1),
	)
	if err != nil {
		t.Fatalf("GetSummary() error = %v", err)
	}
	assertCost(t, summary.CostUSD, 0.000058)
	if summary.UnpricedTokens != 0 {
		t.Fatalf("unpriced tokens = %d, want 0", summary.UnpricedTokens)
	}
}

func TestInsertEventUpdatesUserUsageWindows(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "usage-windows@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "usage key")
	reasoningPrice := "3"
	if _, err := env.PriceStore.Create(context.Background(), modelprices.SaveParams{
		Model:                  "gpt-test",
		InputUSDPerMillion:     "1",
		CacheReadUSDPerMillion: stringPtr("0.5"),
		OutputUSDPerMillion:    "2",
		ReasoningUSDPerMillion: &reasoningPrice,
	}); err != nil {
		t.Fatalf("create model price: %v", err)
	}

	testutil.InsertUsageEvent(t, env.UsageStore, user.User.ID, createdKey.ID)
	reloaded, err := env.UserStore.GetUserByID(context.Background(), user.User.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}
	assertCost(t, reloaded.Usage5HCostUSD, 0.000058)
	assertCost(t, reloaded.Usage7DCostUSD, 0.000058)
	if reloaded.Usage5HStartedAt.IsZero() || reloaded.Usage7DStartedAt.IsZero() {
		t.Fatalf("usage window starts must be populated: %+v", reloaded)
	}
}

func TestUsageCostDoesNotDoubleCountReasoningIncludedOutput(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "usage-reasoning-included@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "usage key")
	reasoningPrice := "3"
	if _, err := env.PriceStore.Create(context.Background(), modelprices.SaveParams{
		Model:                  "gpt-reasoning-included",
		InputUSDPerMillion:     "1",
		CacheReadUSDPerMillion: stringPtr("0.5"),
		OutputUSDPerMillion:    "2",
		ReasoningUSDPerMillion: &reasoningPrice,
	}); err != nil {
		t.Fatalf("create model price: %v", err)
	}

	usageID, err := testutil.NewID("use")
	if err != nil {
		t.Fatalf("NewID(use) error = %v", err)
	}
	requestedAt := requestedAtUTC()
	if err := env.UsageStore.InsertEvent(context.Background(), appusage.InsertEventParams{
		ID:                usageID,
		UserID:            user.User.ID,
		APIKeyID:          createdKey.ID,
		Provider:          "openai",
		Model:             "gpt-reasoning-included",
		UpstreamAuthID:    "upstream-auth",
		UpstreamAuthIndex: "upstream-index",
		UpstreamAuthType:  "api-key",
		Source:            "integration",
		InputTokens:       10,
		OutputTokens:      20,
		ReasoningTokens:   3,
		CacheReadTokens:   2,
		CachedTokens:      2,
		TotalTokens:       30,
		LatencyMS:         123,
		Failed:            false,
		RequestedAt:       requestedAt,
	}); err != nil {
		t.Fatalf("InsertEvent() error = %v", err)
	}

	from := requestedAt.AddDate(0, 0, -1)
	to := requestedAt.AddDate(0, 0, 1)
	summary, err := env.UsageStore.GetSummary(context.Background(), user.User.ID, from, to)
	if err != nil {
		t.Fatalf("GetSummary() error = %v", err)
	}
	assertCost(t, summary.CostUSD, 0.000052)

	byModel, err := env.UsageStore.GetByModel(context.Background(), user.User.ID, from, to)
	if err != nil {
		t.Fatalf("GetByModel() error = %v", err)
	}
	if len(byModel) != 1 || byModel[0].Model != "gpt-reasoning-included" {
		t.Fatalf("usage by model = %+v, want gpt-reasoning-included", byModel)
	}
	assertCost(t, byModel[0].CostUSD, 0.000052)
}

func TestUsageCostUsesSeparateCacheReadAndWritePrices(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "usage-cache-split@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "usage key")
	if _, err := env.PriceStore.Create(context.Background(), modelprices.SaveParams{
		Model:                   "cache-split-test",
		InputUSDPerMillion:      "1",
		CacheReadUSDPerMillion:  stringPtr("0.1"),
		CacheWriteUSDPerMillion: stringPtr("1.25"),
		OutputUSDPerMillion:     "2",
	}); err != nil {
		t.Fatalf("create model price: %v", err)
	}

	usageID, err := testutil.NewID("use")
	if err != nil {
		t.Fatalf("NewID(use) error = %v", err)
	}
	requestedAt := requestedAtUTC()
	if err := env.UsageStore.InsertEvent(context.Background(), appusage.InsertEventParams{
		ID:                usageID,
		UserID:            user.User.ID,
		APIKeyID:          createdKey.ID,
		Provider:          "claude",
		Model:             "cache-split-test",
		UpstreamAuthID:    "upstream-auth",
		UpstreamAuthIndex: "upstream-index",
		UpstreamAuthType:  "api-key",
		Source:            "integration",
		InputTokens:       120,
		OutputTokens:      50,
		CacheReadTokens:   40,
		CacheWriteTokens:  10,
		CachedTokens:      50,
		TotalTokens:       170,
		LatencyMS:         123,
		Failed:            false,
		RequestedAt:       requestedAt,
	}); err != nil {
		t.Fatalf("InsertEvent() error = %v", err)
	}

	from := requestedAt.AddDate(0, 0, -1)
	to := requestedAt.AddDate(0, 0, 1)
	summary, err := env.UsageStore.GetSummary(context.Background(), user.User.ID, from, to)
	if err != nil {
		t.Fatalf("GetSummary() error = %v", err)
	}
	assertCost(t, summary.CostUSD, 0.0001865)

	byModel, err := env.UsageStore.GetByModel(context.Background(), user.User.ID, from, to)
	if err != nil {
		t.Fatalf("GetByModel() error = %v", err)
	}
	if len(byModel) != 1 || byModel[0].Provider != "claude" || byModel[0].CacheReadTokens != 40 || byModel[0].CacheWriteTokens != 10 || byModel[0].CachedTokens != 50 {
		t.Fatalf("usage by model = %+v, want claude usage with split cache tokens", byModel)
	}
	assertCost(t, byModel[0].CostUSD, 0.0001865)
}

func TestUsageHidesSessionKeysFromBreakdown(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	// SeedUser issues a session key under the hood. Recording usage against it
	// proves the session row is excluded from the per-api-key breakdown — chat
	// traffic is summed in the admin usage total but never appears as its own row.
	user := testutil.SeedUser(t, env, "session-usage@example.com", "password123")
	requestedAt := testutil.InsertUsageEvent(t, env.UsageStore, user.User.ID, user.SessionKeyID)
	from := requestedAt.AddDate(0, 0, -1).Format("2006-01-02")
	to := requestedAt.AddDate(0, 0, 1).Format("2006-01-02")

	if err := env.UserStore.UpdateRole(context.Background(), user.User.ID, users.RoleAdmin); err != nil {
		t.Fatalf("promote session usage user to admin: %v", err)
	}

	usageResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage?from="+from+"&to="+to, user.AccessToken, nil)
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

	byKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage/api-keys?from="+from+"&to="+to, user.AccessToken, nil)
	if byKeyResp.Code != http.StatusOK {
		t.Fatalf("usage by key status = %d, body = %s", byKeyResp.Code, byKeyResp.Body.String())
	}
	var byKeyBody struct {
		APIKeys []appusage.APIKeyUsage `json:"api_keys"`
	}
	testutil.DecodeJSON(t, byKeyResp, &byKeyBody)
	if len(byKeyBody.APIKeys) != 0 {
		t.Fatalf("usage by key = %+v, want session key hidden", byKeyBody.APIKeys)
	}
}

func insertUsageEventAt(t *testing.T, store *appusage.Store, userID, apiKeyID, model string, requestedAt time.Time, totalTokens int64) {
	t.Helper()
	usageID, err := testutil.NewID("use")
	if err != nil {
		t.Fatalf("NewID(use) error = %v", err)
	}
	if err := store.InsertEvent(context.Background(), appusage.InsertEventParams{
		ID:                usageID,
		UserID:            userID,
		APIKeyID:          apiKeyID,
		Provider:          "openai",
		Model:             model,
		UpstreamAuthID:    "upstream-auth",
		UpstreamAuthIndex: "upstream-index",
		UpstreamAuthType:  "api-key",
		Source:            "integration",
		InputTokens:       totalTokens,
		TotalTokens:       totalTokens,
		LatencyMS:         123,
		RequestedAt:       requestedAt,
	}); err != nil {
		t.Fatalf("InsertEvent() error = %v", err)
	}
}

func stringPtr(value string) *string {
	return &value
}

func requestedAtUTC() time.Time {
	return time.Now().UTC()
}

func assertCost(t *testing.T, raw string, want float64) {
	t.Helper()
	got, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		t.Fatalf("parse cost %q: %v", raw, err)
	}
	if math.Abs(got-want) > 0.000000001 {
		t.Fatalf("cost = %s (%f), want %f", raw, got, want)
	}
}

func TestAdminUsageRequiresSessionToken(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	deletedResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage", "", nil)
	if deletedResp.Code != http.StatusNotFound {
		t.Fatalf("deleted usage status = %d, want 404, body = %s", deletedResp.Code, deletedResp.Body.String())
	}

	resp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage", "", nil)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("admin usage without token status = %d, body = %s", resp.Code, resp.Body.String())
	}

	user := testutil.SeedUser(t, env, "usage-user-key@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "model traffic only")
	userKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/usage", createdKey.Key, nil)
	if userKeyResp.Code != http.StatusUnauthorized {
		t.Fatalf("admin usage with user api key status = %d, want 401", userKeyResp.Code)
	}
}
