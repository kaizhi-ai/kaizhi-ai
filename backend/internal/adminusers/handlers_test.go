package adminusers_test

import (
	"context"
	"net/http"
	"testing"

	"kaizhi/backend/internal/testutil"
	"kaizhi/backend/internal/users"
)

func TestAdminUsersRequireAdmin(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	regular := testutil.SeedUser(t, env, "regular@example.com", "password123")
	resp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/users", regular.AccessToken, nil)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("GET /api/v1/admin/users status = %d, want 403, body = %s", resp.Code, resp.Body.String())
	}
}

func TestAdminUsersCreateUpdateBanUnbanAndResetPassword(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()
	ctx := context.Background()

	admin := testutil.SeedUser(t, env, "admin@example.com", "password123")
	if err := env.UserStore.UpdateRole(ctx, admin.User.ID, users.RoleAdmin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}

	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/users", admin.AccessToken, map[string]string{
		"email":    "New.User@Example.com",
		"password": "initial123",
		"role":     "user",
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create user status = %d, want 201, body = %s", createResp.Code, createResp.Body.String())
	}
	var created struct {
		User users.User `json:"user"`
	}
	testutil.DecodeJSON(t, createResp, &created)
	if created.User.Email != "new.user@example.com" || created.User.Role != users.RoleUser || created.User.Status != users.StatusActive {
		t.Fatalf("created user = %+v, want normalized active user", created.User)
	}

	listResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/admin/users", admin.AccessToken, nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("list users status = %d, want 200, body = %s", listResp.Code, listResp.Body.String())
	}
	var listed struct {
		Users []users.User `json:"users"`
	}
	testutil.DecodeJSON(t, listResp, &listed)
	if len(listed.Users) != 2 {
		t.Fatalf("listed users len = %d, want 2", len(listed.Users))
	}

	updateResp := testutil.DoJSON(t, env.Router, http.MethodPatch, "/api/v1/admin/users/"+created.User.ID, admin.AccessToken, map[string]string{
		"email": "renamed@example.com",
		"role":  "admin",
	})
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update user status = %d, want 200, body = %s", updateResp.Code, updateResp.Body.String())
	}
	var updated struct {
		User users.User `json:"user"`
	}
	testutil.DecodeJSON(t, updateResp, &updated)
	if updated.User.Email != "renamed@example.com" || updated.User.Role != users.RoleAdmin {
		t.Fatalf("updated user = %+v, want renamed admin", updated.User)
	}

	oldPasswordSession := testutil.LoginUser(t, env.Router, "renamed@example.com", "initial123")
	resetResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/users/"+created.User.ID+"/password", admin.AccessToken, map[string]string{
		"password": "changed123",
	})
	if resetResp.Code != http.StatusNoContent {
		t.Fatalf("reset password status = %d, want 204, body = %s", resetResp.Code, resetResp.Body.String())
	}
	meAfterResetResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", oldPasswordSession.AccessToken, nil)
	if meAfterResetResp.Code != http.StatusUnauthorized {
		t.Fatalf("old session after password reset status = %d, want 401", meAfterResetResp.Code)
	}
	targetSession := testutil.LoginUser(t, env.Router, "renamed@example.com", "changed123")

	banResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/users/"+created.User.ID+"/ban", admin.AccessToken, nil)
	if banResp.Code != http.StatusOK {
		t.Fatalf("ban user status = %d, want 200, body = %s", banResp.Code, banResp.Body.String())
	}
	var banned struct {
		User users.User `json:"user"`
	}
	testutil.DecodeJSON(t, banResp, &banned)
	if banned.User.Status != users.StatusBanned {
		t.Fatalf("banned user status = %q, want %q", banned.User.Status, users.StatusBanned)
	}

	meResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", targetSession.AccessToken, nil)
	if meResp.Code != http.StatusUnauthorized {
		t.Fatalf("banned user's old session status = %d, want 401", meResp.Code)
	}
	loginResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email":    "renamed@example.com",
		"password": "changed123",
	})
	if loginResp.Code != http.StatusUnauthorized {
		t.Fatalf("banned user login status = %d, want 401", loginResp.Code)
	}

	unbanResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/users/"+created.User.ID+"/unban", admin.AccessToken, nil)
	if unbanResp.Code != http.StatusOK {
		t.Fatalf("unban user status = %d, want 200, body = %s", unbanResp.Code, unbanResp.Body.String())
	}
	var unbanned struct {
		User users.User `json:"user"`
	}
	testutil.DecodeJSON(t, unbanResp, &unbanned)
	if unbanned.User.Status != users.StatusActive {
		t.Fatalf("unbanned user status = %q, want %q", unbanned.User.Status, users.StatusActive)
	}
	meAfterUnbanResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/auth/me", targetSession.AccessToken, nil)
	if meAfterUnbanResp.Code != http.StatusUnauthorized {
		t.Fatalf("old session after unban status = %d, want 401", meAfterUnbanResp.Code)
	}
	_ = testutil.LoginUser(t, env.Router, "renamed@example.com", "changed123")
}

func TestAdminUsersRejectSelfRoleChangeAndSelfBan(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()
	ctx := context.Background()

	admin := testutil.SeedUser(t, env, "admin@example.com", "password123")
	if err := env.UserStore.UpdateRole(ctx, admin.User.ID, users.RoleAdmin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}

	roleResp := testutil.DoJSON(t, env.Router, http.MethodPatch, "/api/v1/admin/users/"+admin.User.ID, admin.AccessToken, map[string]string{
		"role": "user",
	})
	if roleResp.Code != http.StatusBadRequest {
		t.Fatalf("self role update status = %d, want 400, body = %s", roleResp.Code, roleResp.Body.String())
	}

	banResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/admin/users/"+admin.User.ID+"/ban", admin.AccessToken, nil)
	if banResp.Code != http.StatusBadRequest {
		t.Fatalf("self ban status = %d, want 400, body = %s", banResp.Code, banResp.Body.String())
	}
}
