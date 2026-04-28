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
