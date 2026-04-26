package chats_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"kaizhi/backend/internal/chats"
	"kaizhi/backend/internal/testutil"
)

func TestChatsLifecycle(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "chat@example.com", "password123")

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

	user := testutil.SeedUser(t, env, "parts@example.com", "password123")
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

func TestChatImageUploads(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "upload@example.com", "password123")
	image := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}

	uploadResp := doMultipartFile(t, env.Router, "/api/v1/chats/uploads", user.AccessToken, "pixel.png", image)
	if uploadResp.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body = %s", uploadResp.Code, uploadResp.Body.String())
	}
	var uploaded struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType"`
		Name      string `json:"name"`
		Size      int    `json:"size"`
	}
	testutil.DecodeJSON(t, uploadResp, &uploaded)
	if uploaded.URL == "" || uploaded.MediaType != "image/png" || uploaded.Name != "pixel.png" || uploaded.Size != len(image) {
		t.Fatalf("uploaded = %+v, want url/png/name/size", uploaded)
	}

	unauthReq := httptest.NewRequest(http.MethodGet, uploaded.URL, nil)
	unauthResp := httptest.NewRecorder()
	env.Router.ServeHTTP(unauthResp, unauthReq)
	if unauthResp.Code != http.StatusUnauthorized {
		t.Fatalf("get uploaded image without token status = %d, want 401", unauthResp.Code)
	}

	getReq := httptest.NewRequest(http.MethodGet, uploaded.URL, nil)
	getReq.Header.Set("Authorization", "Bearer "+user.AccessToken)
	getResp := httptest.NewRecorder()
	env.Router.ServeHTTP(getResp, getReq)
	if getResp.Code != http.StatusOK {
		t.Fatalf("get uploaded image status = %d, body = %s", getResp.Code, getResp.Body.String())
	}
	if got := getResp.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("uploaded content-type = %q, want image/png", got)
	}
	if !bytes.Equal(getResp.Body.Bytes(), image) {
		t.Fatalf("uploaded body = %v, want %v", getResp.Body.Bytes(), image)
	}

	other := testutil.SeedUser(t, env, "upload-other@example.com", "password123")
	crossReq := httptest.NewRequest(http.MethodGet, uploaded.URL, nil)
	crossReq.Header.Set("Authorization", "Bearer "+other.AccessToken)
	crossResp := httptest.NewRecorder()
	env.Router.ServeHTTP(crossResp, crossReq)
	if crossResp.Code != http.StatusNotFound {
		t.Fatalf("cross-user get status = %d, want 404", crossResp.Code)
	}

	badResp := doMultipartFile(t, env.Router, "/api/v1/chats/uploads", user.AccessToken, "note.txt", []byte("hello"))
	if badResp.Code != http.StatusBadRequest {
		t.Fatalf("bad upload status = %d, body = %s, want 400", badResp.Code, badResp.Body.String())
	}
}

func TestChatFilePartsRequireLocalUploadedImages(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "file-parts@example.com", "password123")
	image := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	uploadResp := doMultipartFile(t, env.Router, "/api/v1/chats/uploads", user.AccessToken, "pixel.png", image)
	if uploadResp.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body = %s", uploadResp.Code, uploadResp.Body.String())
	}
	var uploaded struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType"`
		Name      string `json:"name"`
	}
	testutil.DecodeJSON(t, uploadResp, &uploaded)

	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", user.AccessToken, map[string]string{"title": "images"})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create chat status = %d, body = %s", createResp.Code, createResp.Body.String())
	}
	var created chats.ChatSession
	testutil.DecodeJSON(t, createResp, &created)

	validResp := appendFilePart(t, env.Router, user.AccessToken, created.ID, uploaded.MediaType, uploaded.URL)
	if validResp.Code != http.StatusCreated {
		t.Fatalf("valid file part status = %d, body = %s", validResp.Code, validResp.Body.String())
	}
	var validMessage chats.ChatMessage
	testutil.DecodeJSON(t, validResp, &validMessage)
	var validParts []map[string]any
	if err := json.Unmarshal(validMessage.Parts, &validParts); err != nil {
		t.Fatalf("decode file parts: %v", err)
	}
	if len(validParts) != 1 ||
		len(validParts[0]) != 3 ||
		validParts[0]["type"] != "file" ||
		validParts[0]["mediaType"] != uploaded.MediaType ||
		validParts[0]["url"] != uploaded.URL {
		t.Fatalf("valid file part = %+v, want only type/mediaType/url", validParts)
	}
	getReq := httptest.NewRequest(http.MethodGet, uploaded.URL, nil)
	getReq.Header.Set("Authorization", "Bearer "+user.AccessToken)
	getResp := httptest.NewRecorder()
	env.Router.ServeHTTP(getResp, getReq)
	if getResp.Code != http.StatusOK {
		t.Fatalf("get file part image status = %d, body = %s", getResp.Code, getResp.Body.String())
	}

	other := testutil.SeedUser(t, env, "file-parts-other@example.com", "password123")
	otherUpload := doMultipartFile(t, env.Router, "/api/v1/chats/uploads", other.AccessToken, "other.png", image)
	if otherUpload.Code != http.StatusOK {
		t.Fatalf("other upload status = %d, body = %s", otherUpload.Code, otherUpload.Body.String())
	}
	var otherUploaded struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType"`
	}
	testutil.DecodeJSON(t, otherUpload, &otherUploaded)

	cases := []struct {
		name      string
		mediaType string
		url       string
	}{
		{name: "external URL", mediaType: "image/png", url: "https://example.com/pixel.png"},
		{name: "protocol-relative URL", mediaType: "image/png", url: "//example.com/pixel.png"},
		{name: "data URL", mediaType: "image/png", url: "data:image/png;base64,AAAA"},
		{name: "other user local URL", mediaType: otherUploaded.MediaType, url: otherUploaded.URL},
		{name: "missing local file", mediaType: "image/png", url: "/api/v1/chats/media/" + user.User.ID + "/missing.png"},
		{name: "media type mismatch", mediaType: "image/jpeg", url: uploaded.URL},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := appendFilePart(t, env.Router, user.AccessToken, created.ID, tc.mediaType, tc.url)
			if resp.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s, want 400", resp.Code, resp.Body.String())
			}
		})
	}
}

func TestDeleteChatRemovesUploadedImages(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "delete-images@example.com", "password123")
	image := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	uploadResp := doMultipartFile(t, env.Router, "/api/v1/chats/uploads", user.AccessToken, "pixel.png", image)
	if uploadResp.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body = %s", uploadResp.Code, uploadResp.Body.String())
	}
	var uploaded struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType"`
	}
	testutil.DecodeJSON(t, uploadResp, &uploaded)

	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", user.AccessToken, map[string]string{"title": "images"})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create chat status = %d, body = %s", createResp.Code, createResp.Body.String())
	}
	var created chats.ChatSession
	testutil.DecodeJSON(t, createResp, &created)

	msgResp := appendFilePart(t, env.Router, user.AccessToken, created.ID, uploaded.MediaType, uploaded.URL)
	if msgResp.Code != http.StatusCreated {
		t.Fatalf("append file part status = %d, body = %s", msgResp.Code, msgResp.Body.String())
	}

	delResp := testutil.DoJSON(t, env.Router, http.MethodDelete, "/api/v1/chats/"+created.ID, user.AccessToken, nil)
	if delResp.Code != http.StatusNoContent {
		t.Fatalf("delete chat status = %d, body = %s", delResp.Code, delResp.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, uploaded.URL, nil)
	getReq.Header.Set("Authorization", "Bearer "+user.AccessToken)
	getResp := httptest.NewRecorder()
	env.Router.ServeHTTP(getResp, getReq)
	if getResp.Code != http.StatusNotFound {
		t.Fatalf("get deleted image status = %d, body = %s, want 404", getResp.Code, getResp.Body.String())
	}
}

func TestDeleteChatKeepsImagesReferencedByOtherChats(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "shared-images@example.com", "password123")
	image := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	uploadResp := doMultipartFile(t, env.Router, "/api/v1/chats/uploads", user.AccessToken, "shared.png", image)
	if uploadResp.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body = %s", uploadResp.Code, uploadResp.Body.String())
	}
	var uploaded struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType"`
	}
	testutil.DecodeJSON(t, uploadResp, &uploaded)

	firstResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", user.AccessToken, map[string]string{"title": "first"})
	if firstResp.Code != http.StatusCreated {
		t.Fatalf("create first chat status = %d, body = %s", firstResp.Code, firstResp.Body.String())
	}
	var first chats.ChatSession
	testutil.DecodeJSON(t, firstResp, &first)
	secondResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", user.AccessToken, map[string]string{"title": "second"})
	if secondResp.Code != http.StatusCreated {
		t.Fatalf("create second chat status = %d, body = %s", secondResp.Code, secondResp.Body.String())
	}
	var second chats.ChatSession
	testutil.DecodeJSON(t, secondResp, &second)

	for _, chatID := range []string{first.ID, second.ID} {
		msgResp := appendFilePart(t, env.Router, user.AccessToken, chatID, uploaded.MediaType, uploaded.URL)
		if msgResp.Code != http.StatusCreated {
			t.Fatalf("append file part to %s status = %d, body = %s", chatID, msgResp.Code, msgResp.Body.String())
		}
	}

	delResp := testutil.DoJSON(t, env.Router, http.MethodDelete, "/api/v1/chats/"+first.ID, user.AccessToken, nil)
	if delResp.Code != http.StatusNoContent {
		t.Fatalf("delete first chat status = %d, body = %s", delResp.Code, delResp.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, uploaded.URL, nil)
	getReq.Header.Set("Authorization", "Bearer "+user.AccessToken)
	getResp := httptest.NewRecorder()
	env.Router.ServeHTTP(getResp, getReq)
	if getResp.Code != http.StatusOK {
		t.Fatalf("get shared image status = %d, body = %s, want 200", getResp.Code, getResp.Body.String())
	}
	if !bytes.Equal(getResp.Body.Bytes(), image) {
		t.Fatalf("shared image body = %v, want %v", getResp.Body.Bytes(), image)
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

func TestChatsRejectUserAPIKey(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	user := testutil.SeedUser(t, env, "chat-user-key@example.com", "password123")
	createdKey := testutil.CreateAPIKey(t, env.Router, user.AccessToken, "model traffic only")

	listResp := testutil.DoJSON(t, env.Router, http.MethodGet, "/api/v1/chats", createdKey.Key, nil)
	if listResp.Code != http.StatusUnauthorized {
		t.Fatalf("list chats with user api key status = %d, want 401", listResp.Code)
	}
	createResp := testutil.DoJSON(t, env.Router, http.MethodPost, "/api/v1/chats", createdKey.Key, map[string]string{"title": "blocked"})
	if createResp.Code != http.StatusUnauthorized {
		t.Fatalf("create chat with user api key status = %d, want 401", createResp.Code)
	}
}

func TestChatsAreIsolatedPerUser(t *testing.T) {
	env := testutil.Setup(t)
	defer env.Cleanup()

	owner := testutil.SeedUser(t, env, "owner@example.com", "password123")
	other := testutil.SeedUser(t, env, "other@example.com", "password123")

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

func doMultipartFile(t *testing.T, router http.Handler, target, token, filename string, data []byte) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func appendFilePart(t *testing.T, router http.Handler, token, chatID, mediaType, url string) *httptest.ResponseRecorder {
	t.Helper()
	parts, err := json.Marshal([]map[string]string{{
		"type":      "file",
		"mediaType": mediaType,
		"url":       url,
	}})
	if err != nil {
		t.Fatalf("marshal file parts: %v", err)
	}
	return testutil.DoJSON(t, router, http.MethodPost, "/api/v1/chats/"+chatID+"/messages", token, map[string]any{
		"role":  "user",
		"parts": json.RawMessage(parts),
	})
}
