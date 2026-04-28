package users_test

import (
	"context"
	"errors"
	"math"
	"strconv"
	"testing"

	"kaizhi/backend/internal/testutil"
	"kaizhi/backend/internal/users"
)

func TestStoreCreateUserRejectsDuplicateEmail(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	hash, err := users.HashPassword("password123")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	if _, err := env.UserStore.CreateUser(context.Background(), "dup@example.com", hash); err != nil {
		t.Fatalf("first CreateUser: %v", err)
	}

	_, err = env.UserStore.CreateUser(context.Background(), " Dup@Example.COM ", hash)
	if !errors.Is(err, users.ErrEmailExists) {
		t.Fatalf("second CreateUser err = %v, want ErrEmailExists", err)
	}
}

func TestStoreCreateUserUsesDefaultLanguage(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	hash, err := users.HashPassword("password123")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	user, err := env.UserStore.CreateUser(context.Background(), "language@example.com", hash)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if user.Name != "" {
		t.Fatalf("user.Name = %q, want empty", user.Name)
	}
	if user.Language != users.DefaultLanguage {
		t.Fatalf("user.Language = %q, want %q", user.Language, users.DefaultLanguage)
	}
	if user.Usage5HCostUSD != "0.000000000000" || user.Usage7DCostUSD != "0.000000000000" {
		t.Fatalf("usage costs = %s/%s, want zero defaults", user.Usage5HCostUSD, user.Usage7DCostUSD)
	}
	if user.Usage5HStartedAt.IsZero() || user.Usage7DStartedAt.IsZero() {
		t.Fatalf("usage window starts must be populated")
	}
	if user.Usage5HResetAt == nil || user.Usage7DResetAt == nil {
		t.Fatalf("usage reset times = %v/%v, want populated active windows", user.Usage5HResetAt, user.Usage7DResetAt)
	}
	if !user.Usage5HResetAt.After(user.Usage5HStartedAt) || !user.Usage7DResetAt.After(user.Usage7DStartedAt) {
		t.Fatalf("usage reset times = %v/%v, want after starts %v/%v", user.Usage5HResetAt, user.Usage7DResetAt, user.Usage5HStartedAt, user.Usage7DStartedAt)
	}
	if user.Quota5HCostUSD != nil || user.Quota7DCostUSD != nil {
		t.Fatalf("default quotas = %v/%v, want nil", user.Quota5HCostUSD, user.Quota7DCostUSD)
	}
}

func TestStoreNormalizesExpiredUsageWindows(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	hash, err := users.HashPassword("password123")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user, err := env.UserStore.CreateUser(context.Background(), "expired-windows@example.com", hash)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	ctx := context.Background()
	if _, err := env.Pool.Exec(ctx, `
		UPDATE users
		SET usage_5h_cost_usd = 12.34,
		    usage_5h_started_at = now() - interval '6 hours',
		    usage_7d_cost_usd = 56.78,
		    usage_7d_started_at = now() - interval '6 days'
		WHERE id = $1
	`, user.ID); err != nil {
		t.Fatalf("set expired 5h usage window: %v", err)
	}

	reloaded, err := env.UserStore.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	assertCost(t, reloaded.Usage5HCostUSD, 0)
	assertCost(t, reloaded.Usage7DCostUSD, 56.78)
	if reloaded.Usage5HResetAt != nil || reloaded.Usage7DResetAt == nil {
		t.Fatalf("reset times = %v/%v, want nil/active", reloaded.Usage5HResetAt, reloaded.Usage7DResetAt)
	}

	listed, err := env.UserStore.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("len(ListUsers) = %d, want 1", len(listed))
	}
	assertCost(t, listed[0].Usage5HCostUSD, 0)
	assertCost(t, listed[0].Usage7DCostUSD, 56.78)

	if _, err := env.Pool.Exec(ctx, `
		UPDATE users
		SET usage_5h_cost_usd = 12.34,
		    usage_5h_started_at = now(),
		    usage_7d_cost_usd = 56.78,
		    usage_7d_started_at = now() - interval '8 days'
		WHERE id = $1
	`, user.ID); err != nil {
		t.Fatalf("set expired 7d usage window: %v", err)
	}

	reloaded, err = env.UserStore.GetUserByEmail(ctx, user.Email)
	if err != nil {
		t.Fatalf("GetUserByEmail: %v", err)
	}
	assertCost(t, reloaded.Usage5HCostUSD, 12.34)
	assertCost(t, reloaded.Usage7DCostUSD, 0)
	if reloaded.Usage5HResetAt == nil || reloaded.Usage7DResetAt != nil {
		t.Fatalf("reset times = %v/%v, want active/nil", reloaded.Usage5HResetAt, reloaded.Usage7DResetAt)
	}
}

func TestStoreUpdatesUserQuotasAndQuotaState(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	hash, err := users.HashPassword("password123")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user, err := env.UserStore.CreateUser(context.Background(), "quota@example.com", hash)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	quota5H := "1.25"
	quota7D := "10"
	updated, err := env.UserStore.UpdateUser(context.Background(), user.ID, users.UpdateUserParams{
		Quota5HCostUSDSet: true,
		Quota5HCostUSD:    &quota5H,
		Quota7DCostUSDSet: true,
		Quota7DCostUSD:    &quota7D,
	})
	if err != nil {
		t.Fatalf("UpdateUser quotas: %v", err)
	}
	if updated.Quota5HCostUSD == nil || *updated.Quota5HCostUSD != "1.250000000000" {
		t.Fatalf("Quota5HCostUSD = %v, want 1.250000000000", updated.Quota5HCostUSD)
	}
	if updated.Quota7DCostUSD == nil || *updated.Quota7DCostUSD != "10.000000000000" {
		t.Fatalf("Quota7DCostUSD = %v, want 10.000000000000", updated.Quota7DCostUSD)
	}

	ctx := context.Background()
	if _, err := env.Pool.Exec(ctx, `
		UPDATE users
		SET usage_5h_cost_usd = 1.25,
		    usage_5h_started_at = now(),
		    usage_7d_cost_usd = 9.99,
		    usage_7d_started_at = now()
		WHERE id = $1
	`, user.ID); err != nil {
		t.Fatalf("set usage counters: %v", err)
	}
	state, err := env.UserStore.GetQuotaState(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetQuotaState: %v", err)
	}
	if !state.Exceeded() || !state.Exceeded5H || state.Exceeded7D {
		t.Fatalf("quota state = %+v, want 5h exceeded only", state)
	}

	updated, err = env.UserStore.UpdateUser(ctx, user.ID, users.UpdateUserParams{
		Quota5HCostUSDSet: true,
	})
	if err != nil {
		t.Fatalf("clear 5h quota: %v", err)
	}
	if updated.Quota5HCostUSD != nil || updated.Quota7DCostUSD == nil {
		t.Fatalf("quotas after clear = %v/%v, want nil/10", updated.Quota5HCostUSD, updated.Quota7DCostUSD)
	}

	if _, err := env.Pool.Exec(ctx, `
		UPDATE users
		SET usage_5h_cost_usd = 99,
		    usage_5h_started_at = now() - interval '6 hours'
		WHERE id = $1
	`, user.ID); err != nil {
		t.Fatalf("expire 5h usage window: %v", err)
	}
	state, err = env.UserStore.GetQuotaState(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetQuotaState after expiry: %v", err)
	}
	if state.Exceeded5H {
		t.Fatalf("expired 5h quota state = %+v, want not exceeded", state)
	}
}

func assertCost(t *testing.T, got string, want float64) {
	t.Helper()
	value, err := strconv.ParseFloat(got, 64)
	if err != nil {
		t.Fatalf("cost %q is not numeric: %v", got, err)
	}
	if math.Abs(value-want) > 0.000000001 {
		t.Fatalf("cost = %s, want %.12f", got, want)
	}
}
