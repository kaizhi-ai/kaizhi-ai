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
	if usageBody.Usage.RequestCount != 1 || usageBody.Usage.TotalTokens != 33 || usageBody.Usage.UnpricedTokens != 0 {
		t.Fatalf("usage summary = %+v, want 1 request, 33 tokens and priced usage", usageBody.Usage)
	}
	assertCost(t, usageBody.Usage.EstimatedCostUSD, 0.000058)
	if usageBody.Usage.EstimatedCostUSD == "" {
		t.Fatalf("usage summary estimated cost is empty")
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
	if usageByModelBody.Models[0].PriceMissing || usageByModelBody.Models[0].UnpricedTokens != 0 {
		t.Fatalf("usage by model price flags = %+v, want priced", usageByModelBody.Models[0])
	}
	assertCost(t, usageByModelBody.Models[0].EstimatedCostUSD, 0.000058)
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
	assertCost(t, summary.EstimatedCostUSD, 0.000058)
	if summary.UnpricedTokens != 0 {
		t.Fatalf("unpriced tokens = %d, want 0", summary.UnpricedTokens)
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
	assertCost(t, summary.EstimatedCostUSD, 0.000052)

	byModel, err := env.UsageStore.GetByModel(context.Background(), user.User.ID, from, to)
	if err != nil {
		t.Fatalf("GetByModel() error = %v", err)
	}
	if len(byModel) != 1 || byModel[0].Model != "gpt-reasoning-included" {
		t.Fatalf("usage by model = %+v, want gpt-reasoning-included", byModel)
	}
	assertCost(t, byModel[0].EstimatedCostUSD, 0.000052)
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
	assertCost(t, summary.EstimatedCostUSD, 0.0001865)

	byModel, err := env.UsageStore.GetByModel(context.Background(), user.User.ID, from, to)
	if err != nil {
		t.Fatalf("GetByModel() error = %v", err)
	}
	if len(byModel) != 1 || byModel[0].Provider != "claude" || byModel[0].CacheReadTokens != 40 || byModel[0].CacheWriteTokens != 10 || byModel[0].CachedTokens != 50 {
		t.Fatalf("usage by model = %+v, want claude usage with split cache tokens", byModel)
	}
	assertCost(t, byModel[0].EstimatedCostUSD, 0.0001865)
}

func TestUsageHidesSessionKeysFromBreakdown(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	// SeedUser issues a session key under the hood. Recording usage against it
	// proves the session row is excluded from the per-api-key breakdown — chat
	// traffic is summed in /api/v1/usage but never appears as its own row.
	user := testutil.SeedUser(t, env, "session-usage@example.com", "password123")
	requestedAt := testutil.InsertUsageEvent(t, env.UsageStore, user.User.ID, user.SessionKeyID)
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

	byKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage/api-keys?from="+from+"&to="+to, user.AccessToken, nil)
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

func TestUsageRequiresSessionToken(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	resp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage", "", nil)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("usage without token status = %d, body = %s", resp.Code, resp.Body.String())
	}

	user := testutil.SeedUser(t, env, "usage-user-key@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "model traffic only")
	userKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/usage", createdKey.Key, nil)
	if userKeyResp.Code != http.StatusUnauthorized {
		t.Fatalf("usage with user api key status = %d, want 401", userKeyResp.Code)
	}
}
