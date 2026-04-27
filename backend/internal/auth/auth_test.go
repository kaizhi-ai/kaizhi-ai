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
	if loggedIn.User.Language != "zh-CN" {
		t.Fatalf("login user language = %q, want zh-CN", loggedIn.User.Language)
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

func TestAuthUpdateMe(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	loggedIn := testutil.SeedUser(t, env, "profile@example.com", "password123")
	updateResp := testutil.DoJSON(t, env.Router, http.MethodPatch, "/api/v1/auth/me", loggedIn.AccessToken, map[string]string{
		"name":     "  Kaizhi User  ",
		"language": "en-US",
	})
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update me status = %d, body = %s", updateResp.Code, updateResp.Body.String())
	}
	var updateBody struct {
		User struct {
			Name     string `json:"name"`
			Language string `json:"language"`
		} `json:"user"`
	}
	testutil.DecodeJSON(t, updateResp, &updateBody)
	if updateBody.User.Name != "Kaizhi User" || updateBody.User.Language != "en-US" {
		t.Fatalf("updated profile = %+v, want trimmed name and en-US", updateBody.User)
	}

	meResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", loggedIn.AccessToken, nil)
	if meResp.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", meResp.Code, meResp.Body.String())
	}
	var meBody struct {
		User struct {
			Name     string `json:"name"`
			Language string `json:"language"`
		} `json:"user"`
	}
	testutil.DecodeJSON(t, meResp, &meBody)
	if meBody.User.Name != "Kaizhi User" || meBody.User.Language != "en-US" {
		t.Fatalf("me profile = %+v, want persisted profile", meBody.User)
	}

	invalidResp := testutil.DoJSON(t, env.Router, http.MethodPatch, "/api/v1/auth/me", loggedIn.AccessToken, map[string]string{
		"language": "klingon",
	})
	if invalidResp.Code != http.StatusBadRequest {
		t.Fatalf("invalid language status = %d, want 400, body = %s", invalidResp.Code, invalidResp.Body.String())
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
