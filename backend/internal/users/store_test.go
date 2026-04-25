package users_test

import (
	"context"
	"errors"
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
