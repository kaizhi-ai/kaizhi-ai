package auth_test

import (
	"net/http"
	"strings"
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
	if !strings.HasPrefix(loggedIn.AccessToken, "kz_live_") {
		t.Fatalf("access token = %q, want kz_live_ prefix", loggedIn.AccessToken)
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

	user := testutil.SeedUser(t, env, "user-key-me@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "model traffic only")
	userKeyResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", createdKey.Key, nil)
	if userKeyResp.Code != http.StatusUnauthorized {
		t.Fatalf("me with user api key status = %d, want 401", userKeyResp.Code)
	}
}

func TestAuthLogoutRevokesSession(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	testutil.SeedUser(t, env, "logout@example.com", "password123")
	loggedIn := testutil.LoginUser(t, env.Router, "logout@example.com", "password123")

	logoutResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/auth/logout", loggedIn.AccessToken, nil)
	if logoutResp.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d, body = %s", logoutResp.Code, logoutResp.Body.String())
	}

	meResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", loggedIn.AccessToken, nil)
	if meResp.Code != http.StatusUnauthorized {
		t.Fatalf("me after logout status = %d, want 401", meResp.Code)
	}
}
