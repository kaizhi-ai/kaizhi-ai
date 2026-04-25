package chats_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"kaizhi/backend/internal/chats"
	"kaizhi/backend/internal/testutil"
)

func TestChatsLifecycle(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.RegisterUser(t, env.Router, "chat@example.com", "password123")

	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", user.AccessToken, map[string]string{"title": "first"})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create chat status = %d, body = %s", createResp.Code, createResp.Body.String())
	}
	var created chats.ChatSession
	testutil.DecodeJSON(t, createResp, &created)
	if created.ID == "" || created.UserID != user.User.ID || created.Title != "first" {
		t.Fatalf("created chat = %+v, want id/user/title populated", created)
	}

	parts := json.RawMessage(`[{"type":"text","text":"hi"}]`)
	msgResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats/"+created.ID+"/messages", user.AccessToken, map[string]any{
		"role":  "user",
		"parts": parts,
	})
	if msgResp.Code != http.StatusCreated {
		t.Fatalf("append message status = %d, body = %s", msgResp.Code, msgResp.Body.String())
	}
	var stored chats.ChatMessage
	testutil.DecodeJSON(t, msgResp, &stored)
	if stored.Role != "user" || stored.SessionID != created.ID {
		t.Fatalf("stored message = %+v, want role=user session=%s", stored, created.ID)
	}
	var roundTrip []map[string]string
	if err := json.Unmarshal(stored.Parts, &roundTrip); err != nil {
		t.Fatalf("decode stored parts: %v", err)
	}
	if len(roundTrip) != 1 || roundTrip[0]["text"] != "hi" {
		t.Fatalf("stored parts = %+v, want [{type:text,text:hi}]", roundTrip)
	}

	listResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/chats/"+created.ID+"/messages", user.AccessToken, nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("list messages status = %d, body = %s", listResp.Code, listResp.Body.String())
	}
	var listBody struct {
		Messages []chats.ChatMessage `json:"messages"`
	}
	testutil.DecodeJSON(t, listResp, &listBody)
	if len(listBody.Messages) != 1 || listBody.Messages[0].ID != stored.ID {
		t.Fatalf("list messages = %+v, want one message %s", listBody.Messages, stored.ID)
	}

	renameResp := testutil.DoJSON(t, env.Router, http.MethodPatch, "/api/v1/chats/"+created.ID, user.AccessToken, map[string]string{"title": "renamed"})
	if renameResp.Code != http.StatusOK {
		t.Fatalf("rename chat status = %d, body = %s", renameResp.Code, renameResp.Body.String())
	}
	var renamed chats.ChatSession
	testutil.DecodeJSON(t, renameResp, &renamed)
	if renamed.Title != "renamed" {
		t.Fatalf("renamed title = %q, want renamed", renamed.Title)
	}

	chatsResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/chats", user.AccessToken, nil)
	if chatsResp.Code != http.StatusOK {
		t.Fatalf("list chats status = %d, body = %s", chatsResp.Code, chatsResp.Body.String())
	}
	var chatsBody struct {
		Chats []chats.ChatSession `json:"chats"`
	}
	testutil.DecodeJSON(t, chatsResp, &chatsBody)
	if len(chatsBody.Chats) != 1 || chatsBody.Chats[0].Title != "renamed" {
		t.Fatalf("list chats = %+v, want one renamed chat", chatsBody.Chats)
	}

	delResp := testutil.DoJSON(t, env.Router, http.MethodDelete, "/api/v1/chats/"+created.ID, user.AccessToken, nil)
	if delResp.Code != http.StatusNoContent {
		t.Fatalf("delete chat status = %d, body = %s", delResp.Code, delResp.Body.String())
	}

	missingResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/chats/"+created.ID+"/messages", user.AccessToken, nil)
	if missingResp.Code != http.StatusNotFound {
		t.Fatalf("list messages after delete status = %d, want 404", missingResp.Code)
	}
}

func TestChatsRejectsInvalidParts(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.RegisterUser(t, env.Router, "parts@example.com", "password123")
	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", user.AccessToken, nil)
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create chat status = %d", createResp.Code)
	}
	var created chats.ChatSession
	testutil.DecodeJSON(t, createResp, &created)

	cases := []struct {
		name  string
		parts json.RawMessage
	}{
		{name: "missing", parts: nil},
		{name: "object", parts: json.RawMessage(`{"type":"text"}`)},
		{name: "string", parts: json.RawMessage(`"hello"`)},
		{name: "empty array", parts: json.RawMessage(`[]`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := map[string]any{"role": "user"}
			if tc.parts != nil {
				body["parts"] = tc.parts
			}
			resp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats/"+created.ID+"/messages", user.AccessToken, body)
			if resp.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s, want 400", resp.Code, resp.Body.String())
			}
		})
	}

	badRoleResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats/"+created.ID+"/messages", user.AccessToken, map[string]any{
		"role":  "robot",
		"parts": json.RawMessage(`[{"type":"text","text":"x"}]`),
	})
	if badRoleResp.Code != http.StatusBadRequest {
		t.Fatalf("bad role status = %d, want 400", badRoleResp.Code)
	}
}

func TestChatsRequireUserToken(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	resp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/chats", "", nil)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("list chats without token status = %d, want 401", resp.Code)
	}
}

func TestChatsAreIsolatedPerUser(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	owner := testutil.RegisterUser(t, env.Router, "owner@example.com", "password123")
	other := testutil.RegisterUser(t, env.Router, "other@example.com", "password123")

	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", owner.AccessToken, map[string]string{"title": "secret"})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create chat status = %d", createResp.Code)
	}
	var created chats.ChatSession
	testutil.DecodeJSON(t, createResp, &created)

	listResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/chats", other.AccessToken, nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("other list status = %d", listResp.Code)
	}
	var listBody struct {
		Chats []chats.ChatSession `json:"chats"`
	}
	testutil.DecodeJSON(t, listResp, &listBody)
	if len(listBody.Chats) != 0 {
		t.Fatalf("other list = %+v, want empty", listBody.Chats)
	}

	msgResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats/"+created.ID+"/messages", other.AccessToken, map[string]any{
		"role":  "user",
		"parts": json.RawMessage(`[{"type":"text","text":"sneak"}]`),
	})
	if msgResp.Code != http.StatusNotFound {
		t.Fatalf("cross-user append status = %d, want 404", msgResp.Code)
	}

	delResp := testutil.DoJSON(t, env.Router, http.MethodDelete, "/api/v1/chats/"+created.ID, other.AccessToken, nil)
	if delResp.Code != http.StatusNotFound {
		t.Fatalf("cross-user delete status = %d, want 404", delResp.Code)
	}
}
