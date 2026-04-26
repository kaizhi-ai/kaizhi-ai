package provider

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func TestParseFinishRequest(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		redirectURL string
		code        string
		state       string
	}{
		{
			name:        "json redirect url",
			body:        `{"url":"http://localhost:1455/auth/callback?code=abc&state=def"}`,
			redirectURL: "http://localhost:1455/auth/callback?code=abc&state=def",
		},
		{
			name:  "json code and state",
			body:  `{"code":"abc","state":"def"}`,
			code:  "abc",
			state: "def",
		},
		{
			name: "raw code",
			body: "abc",
			code: "abc",
		},
		{
			name:        "raw callback url",
			body:        "http://localhost:1455/auth/callback?code=abc&state=def",
			redirectURL: "http://localhost:1455/auth/callback?code=abc&state=def",
		},
		{
			name:  "raw query string",
			body:  "code=abc&state=def",
			code:  "abc",
			state: "def",
		},
		{
			name:        "json string callback url",
			body:        `"http://localhost:1455/auth/callback?code=abc&state=def"`,
			redirectURL: "http://localhost:1455/auth/callback?code=abc&state=def",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseFinishRequest([]byte(tt.body))
			if err != nil {
				t.Fatalf("parseFinishRequest() error = %v", err)
			}
			if redirectURL := firstNonEmpty(got.RedirectURL, got.CallbackURL, got.URL); redirectURL != tt.redirectURL {
				t.Fatalf("redirectURL = %q, want %q", redirectURL, tt.redirectURL)
			}
			if got.Code != tt.code {
				t.Fatalf("Code = %q, want %q", got.Code, tt.code)
			}
			if got.State != tt.state {
				t.Fatalf("State = %q, want %q", got.State, tt.state)
			}
		})
	}
}

func TestFinishOAuthWaitsForCompletion(t *testing.T) {
	router, requester := newFinishOAuthTestRouter([]oauthStatusPayload{{Status: "ok"}}, http.StatusOK)

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/codex/finish", strings.NewReader(`{"code":"abc","state":"state-1"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s, want 200", resp.Code, resp.Body.String())
	}
	if requester.statusCalls != 1 {
		t.Fatalf("statusCalls = %d, want 1", requester.statusCalls)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(requester.callbackBody), &payload); err != nil {
		t.Fatalf("callback body unmarshal error = %v", err)
	}
	if payload["provider"] != "codex" || payload["code"] != "abc" || payload["state"] != "state-1" {
		t.Fatalf("callback payload = %+v, want provider/code/state", payload)
	}
}

func TestFinishOAuthReturnsCompletionError(t *testing.T) {
	router, requester := newFinishOAuthTestRouter([]oauthStatusPayload{{Status: "error", Error: "exchange failed"}}, http.StatusOK)

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/codex/finish", strings.NewReader(`{"code":"abc","state":"state-1"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s, want 502", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "exchange failed") {
		t.Fatalf("body = %s, want exchange failure", resp.Body.String())
	}
	if requester.statusCalls != 1 {
		t.Fatalf("statusCalls = %d, want 1", requester.statusCalls)
	}
}

func TestFinishOAuthForwardsCallbackFailure(t *testing.T) {
	router, requester := newFinishOAuthTestRouter(nil, http.StatusNotFound)

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/codex/finish", strings.NewReader(`{"code":"abc","state":"state-1"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s, want 404", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "callback failed") {
		t.Fatalf("body = %s, want callback failure", resp.Body.String())
	}
	if requester.statusCalls != 0 {
		t.Fatalf("statusCalls = %d, want 0", requester.statusCalls)
	}
}

func TestPublicAuthFileUsesMetadataProxyURL(t *testing.T) {
	file := publicAuthFile(&coreauth.Auth{
		ID:       "codex-test.json",
		Provider: "codex",
		Metadata: map[string]any{
			"proxy_url": " socks5://127.0.0.1:1080 ",
		},
	})

	if file.ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("ProxyURL = %q, want metadata proxy_url", file.ProxyURL)
	}
}

func TestStartOAuthStoresPendingProxyURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	requester := &fakeManagementRequester{}
	handlers := NewHandlers(nil, nil, requester, nil, nil)
	router := gin.New()
	router.POST("/:provider/start", handlers.startOAuth)

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/gemini/start", strings.NewReader(`{"project_id":"project-1","proxy_url":"socks5://127.0.0.1:1080"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s, want 200", resp.Code, resp.Body.String())
	}
	if requester.geminiProjectID != "project-1" {
		t.Fatalf("gemini project id = %q, want project-1", requester.geminiProjectID)
	}
	flow, ok := handlers.pendingOAuthFlow("state-1")
	if !ok {
		t.Fatalf("pending flow missing")
	}
	if flow.ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("pending proxy url = %q, want proxy", flow.ProxyURL)
	}
}

func TestFinishOAuthAppliesPendingProxyURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := newMemoryAuthStore()
	oldAuth := &coreauth.Auth{
		ID:        "codex-old.json",
		Provider:  "codex",
		FileName:  "codex-old.json",
		Metadata:  map[string]any{"type": "codex", "email": "old@example.com"},
		UpdatedAt: time.Now().Add(-time.Hour),
	}
	if _, err := store.Save(context.Background(), oldAuth); err != nil {
		t.Fatalf("save old auth: %v", err)
	}

	requester := &fakeManagementRequester{
		statuses:       []oauthStatusPayload{{Status: "ok"}},
		callbackStatus: http.StatusOK,
		onCallback: func() {
			_, _ = store.Save(context.Background(), &coreauth.Auth{
				ID:        "codex-new.json",
				Provider:  "codex",
				FileName:  "codex-new.json",
				Metadata:  map[string]any{"type": "codex", "email": "new@example.com"},
				UpdatedAt: time.Now(),
			})
		},
	}
	handlers := NewHandlers(nil, nil, requester, store, nil)
	handlers.setPendingOAuthFlow(
		"codex",
		"state-1",
		"socks5://127.0.0.1:1080",
		time.Now().Add(-time.Minute),
		map[string]struct{}{"codex-old.json": {}},
	)
	router := gin.New()
	router.POST("/:provider/finish", handlers.finishOAuth)

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/codex/finish", strings.NewReader(`{"code":"abc","state":"state-1"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s, want 200", resp.Code, resp.Body.String())
	}
	auth, ok := store.get("codex-new.json")
	if !ok {
		t.Fatalf("new auth missing")
	}
	if auth.ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("ProxyURL = %q, want proxy", auth.ProxyURL)
	}
	if got, _ := auth.Metadata["proxy_url"].(string); got != "socks5://127.0.0.1:1080" {
		t.Fatalf("metadata proxy_url = %q, want proxy", got)
	}
}

func newFinishOAuthTestRouter(statuses []oauthStatusPayload, callbackStatus int) (*gin.Engine, *fakeManagementRequester) {
	gin.SetMode(gin.TestMode)
	requester := &fakeManagementRequester{
		statuses:       statuses,
		callbackStatus: callbackStatus,
	}
	handlers := NewHandlers(nil, nil, requester, nil, nil)
	router := gin.New()
	router.POST("/:provider/finish", handlers.finishOAuth)
	return router, requester
}

type fakeManagementRequester struct {
	statuses        []oauthStatusPayload
	statusCalls     int
	callbackStatus  int
	callbackBody    string
	geminiProjectID string
	onCallback      func()
}

func (f *fakeManagementRequester) RequestAnthropicToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "url": "https://example.com/auth", "state": "state-1"})
}

func (f *fakeManagementRequester) RequestGeminiCLIToken(c *gin.Context) {
	f.geminiProjectID = c.Query("project_id")
	c.JSON(http.StatusOK, gin.H{"status": "ok", "url": "https://example.com/auth", "state": "state-1"})
}

func (f *fakeManagementRequester) RequestCodexToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "url": "https://example.com/auth", "state": "state-1"})
}

func (f *fakeManagementRequester) RequestAntigravityToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "url": "https://example.com/auth", "state": "state-1"})
}

func (f *fakeManagementRequester) RequestKimiToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "url": "https://example.com/auth", "state": "state-1"})
}

func (f *fakeManagementRequester) GetAuthStatus(c *gin.Context) {
	f.statusCalls++
	if len(f.statuses) == 0 {
		c.JSON(http.StatusOK, oauthStatusPayload{Status: "ok"})
		return
	}
	index := f.statusCalls - 1
	if index >= len(f.statuses) {
		index = len(f.statuses) - 1
	}
	c.JSON(http.StatusOK, f.statuses[index])
}

func (f *fakeManagementRequester) PostOAuthCallback(c *gin.Context) {
	data, _ := io.ReadAll(c.Request.Body)
	f.callbackBody = string(data)
	status := f.callbackStatus
	if status == 0 {
		status = http.StatusOK
	}
	if status != http.StatusOK {
		c.JSON(status, gin.H{"error": "callback failed"})
		return
	}
	if f.onCallback != nil {
		f.onCallback()
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

type memoryAuthStore struct {
	mu      sync.Mutex
	records map[string]*coreauth.Auth
}

func newMemoryAuthStore() *memoryAuthStore {
	return &memoryAuthStore{records: make(map[string]*coreauth.Auth)}
}

func (s *memoryAuthStore) List(context.Context) ([]*coreauth.Auth, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]*coreauth.Auth, 0, len(s.records))
	for _, record := range s.records {
		records = append(records, record.Clone())
	}
	return records, nil
}

func (s *memoryAuthStore) Save(_ context.Context, auth *coreauth.Auth) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[auth.ID] = auth.Clone()
	return auth.ID, nil
}

func (s *memoryAuthStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.records, id)
	return nil
}

func (s *memoryAuthStore) get(id string) (*coreauth.Auth, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.records[id]
	if !ok {
		return nil, false
	}
	return record.Clone(), true
}
