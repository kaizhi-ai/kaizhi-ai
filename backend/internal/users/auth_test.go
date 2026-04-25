package users_test

import (
	"net/http"
	"testing"

	"kaizhi/backend/internal/testutil"
)

func TestAuthLoginAndMe(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	created := testutil.SeedUser(t, env, " User@Example.COM ", "password123")
	if created.User.Email != "user@example.com" {
		t.Fatalf("created email = %q, want normalized email", created.User.Email)
	}

	loggedIn := testutil.LoginUser(t, env.Router, "user@example.com", "password123")
	if loggedIn.AccessToken == "" {
		t.Fatal("expected login response to include access_token")
	}
	if loggedIn.User.ID != created.User.ID {
		t.Fatalf("login user id = %q, want %q", loggedIn.User.ID, created.User.ID)
	}

	meResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", loggedIn.AccessToken, nil)
	if meResp.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", meResp.Code, meResp.Body.String())
	}
	var meBody struct {
		User struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
	}
	testutil.DecodeJSON(t, meResp, &meBody)
	if meBody.User.ID != created.User.ID || meBody.User.Email != "user@example.com" {
		t.Fatalf("me user = %+v, want created user", meBody.User)
	}
}

func TestAuthRejectsWrongPassword(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	testutil.SeedUser(t, env, "wrong-password@example.com", "password123")
	resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email":    "wrong-password@example.com",
		"password": "not-the-password",
	})
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password login status = %d, body = %s", resp.Code, resp.Body.String())
	}
}

func TestAuthMeRequiresValidToken(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	noTokenResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", "", nil)
	if noTokenResp.Code != http.StatusUnauthorized {
		t.Fatalf("me without token status = %d, body = %s", noTokenResp.Code, noTokenResp.Body.String())
	}

	badTokenResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", "not-a-real-token", nil)
	if badTokenResp.Code != http.StatusUnauthorized {
		t.Fatalf("me with bad token status = %d, body = %s", badTokenResp.Code, badTokenResp.Body.String())
	}
}
