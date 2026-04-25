package users_test

import (
	"net/http"
	"testing"

	"kaizhi/backend/internal/testutil"
)

func TestAuthRegisterLoginAndMe(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	registered := testutil.RegisterUser(t, env.Router, " User@Example.COM ", "password123")
	if registered.AccessToken == "" {
		t.Fatal("expected register response to include access_token")
	}
	if registered.User.ID == "" {
		t.Fatal("expected register response to include user id")
	}
	if registered.User.Email != "user@example.com" {
		t.Fatalf("registered email = %q, want normalized email", registered.User.Email)
	}

	loggedIn := testutil.LoginUser(t, env.Router, "user@example.com", "password123")
	if loggedIn.AccessToken == "" {
		t.Fatal("expected login response to include access_token")
	}
	if loggedIn.User.ID != registered.User.ID {
		t.Fatalf("login user id = %q, want %q", loggedIn.User.ID, registered.User.ID)
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
	if meBody.User.ID != registered.User.ID || meBody.User.Email != "user@example.com" {
		t.Fatalf("me user = %+v, want registered user", meBody.User)
	}
}

func TestAuthRejectsWrongPassword(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	testutil.RegisterUser(t, env.Router, "wrong-password@example.com", "password123")
	resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email":    "wrong-password@example.com",
		"password": "not-the-password",
	})
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password login status = %d, body = %s", resp.Code, resp.Body.String())
	}
}

func TestAuthRejectsDuplicateRegistration(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	testutil.RegisterUser(t, env.Router, "duplicate@example.com", "password123")
	resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/auth/register", "", map[string]string{
		"email":    "duplicate@example.com",
		"password": "password123",
	})
	if resp.Code != http.StatusConflict {
		t.Fatalf("duplicate register status = %d, body = %s", resp.Code, resp.Body.String())
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
