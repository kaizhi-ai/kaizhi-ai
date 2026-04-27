package testutil

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"kaizhi/backend/internal/adminusers"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/auth"
	"kaizhi/backend/internal/chats"
	"kaizhi/backend/internal/ids"
	"kaizhi/backend/internal/postgres"
	appusage "kaizhi/backend/internal/usage"
	"kaizhi/backend/internal/users"
)

type Env struct {
	UserStore   *users.Store
	APIKeyStore *apikeys.Store
	UsageStore  *appusage.Store
	ChatStore   *chats.Store
	APIKeys     *apikeys.Service
	Router      *gin.Engine
	Cleanup     func()
}

type AuthResponse struct {
	AccessToken string `json:"access_token"`
	User        struct {
		ID       string `json:"id"`
		Email    string `json:"email"`
		Name     string `json:"name"`
		Language string `json:"language"`
	} `json:"user"`
	// SessionKeyID is populated by SeedUser only, since the login response does
	// not surface the underlying api_key id. Tests that need to bind usage
	// events to the session key use it.
	SessionKeyID string `json:"-"`
}

func Setup(t *testing.T) *Env {
	t.Helper()

	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	adminPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect postgres admin pool: %v", err)
	}

	schema := fmt.Sprintf("it_%d", time.Now().UnixNano())
	quotedSchema := pgx.Identifier{schema}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+quotedSchema); err != nil {
		adminPool.Close()
		t.Fatalf("create test schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = make(map[string]string)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("connect postgres test pool: %v", err)
	}

	if err := postgres.EnsureSchema(ctx, pool); err != nil {
		pool.Close()
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("ensure schema: %v", err)
	}

	userStore := users.NewStore(pool)
	apiKeyStore := apikeys.NewStore(pool)
	usageStore := appusage.NewStore(pool)
	chatStore := chats.NewStore(pool)
	apiKeyService, err := apikeys.NewService(apiKeyStore, "integration-test-api-key-pepper")
	if err != nil {
		pool.Close()
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("create api key service: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	auth.NewHandlers(userStore, apiKeyService).RegisterRoutes(router)
	adminusers.NewHandlers(userStore, adminusers.NewStore(pool), apiKeyService).RegisterRoutes(router)
	apikeys.NewHandlers(apiKeyStore, apiKeyService, userStore).RegisterRoutes(router)
	appusage.NewHandlers(usageStore, userStore, apiKeyService).RegisterRoutes(router)
	chats.NewHandlers(
		chatStore,
		userStore,
		apiKeyService,
		chats.WithMediaRoot(t.TempDir()),
	).RegisterRoutes(router)

	cleanup := func() {
		pool.Close()
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
	}
	return &Env{
		UserStore:   userStore,
		APIKeyStore: apiKeyStore,
		UsageStore:  usageStore,
		ChatStore:   chatStore,
		APIKeys:     apiKeyService,
		Router:      router,
		Cleanup:     cleanup,
	}
}

// SeedUser inserts a user directly through the store and returns a fresh
// session API key. There is no public registration endpoint, so tests that
// need an authenticated caller use this helper instead of an HTTP round-trip.
func SeedUser(t *testing.T, env *Env, email, password string) AuthResponse {
	t.Helper()
	hash, err := users.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user, err := env.UserStore.CreateUser(context.Background(), email, hash)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	session, err := env.APIKeys.IssueSession(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("issue session: %v", err)
	}
	var body AuthResponse
	body.AccessToken = session.Key
	body.SessionKeyID = session.ID
	body.User.ID = user.ID
	body.User.Email = user.Email
	body.User.Name = user.Name
	body.User.Language = user.Language
	return body
}

func LoginUser(t *testing.T, router http.Handler, email, password string) AuthResponse {
	t.Helper()
	resp := DoJSON(t, router, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email":    email,
		"password": password,
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", resp.Code, resp.Body.String())
	}

	var body AuthResponse
	DecodeJSON(t, resp, &body)
	return body
}

func CreateAPIKey(t *testing.T, router http.Handler, token, name string) apikeys.CreatedAPIKey {
	t.Helper()
	resp := DoJSON(t, router, http.MethodPost, "/api/v1/api-keys", token, map[string]string{"name": name})
	if resp.Code != http.StatusCreated {
		t.Fatalf("create api key status = %d, body = %s", resp.Code, resp.Body.String())
	}

	var key apikeys.CreatedAPIKey
	DecodeJSON(t, resp, &key)
	return key
}

func InsertUsageEvent(t *testing.T, store *appusage.Store, userID, apiKeyID string) time.Time {
	t.Helper()
	usageID, err := NewID("use")
	if err != nil {
		t.Fatalf("NewID(use) error = %v", err)
	}
	requestedAt := time.Now().UTC()
	if err := store.InsertEvent(context.Background(), appusage.InsertEventParams{
		ID:                usageID,
		UserID:            userID,
		APIKeyID:          apiKeyID,
		Provider:          "openai",
		Model:             "gpt-test",
		UpstreamAuthID:    "upstream-auth",
		UpstreamAuthIndex: "upstream-index",
		UpstreamAuthType:  "api-key",
		Source:            "integration",
		InputTokens:       10,
		OutputTokens:      20,
		ReasoningTokens:   3,
		CachedTokens:      2,
		TotalTokens:       33,
		LatencyMS:         123,
		Failed:            false,
		RequestedAt:       requestedAt,
	}); err != nil {
		t.Fatalf("InsertUsageEvent() error = %v", err)
	}
	return requestedAt
}

func DoJSON(t *testing.T, router http.Handler, method, target, token string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(payload)
	}

	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func DecodeJSON(t *testing.T, resp *httptest.ResponseRecorder, dst any) {
	t.Helper()
	if err := json.Unmarshal(resp.Body.Bytes(), dst); err != nil {
		t.Fatalf("decode response body %q: %v", resp.Body.String(), err)
	}
}

func NewID(prefix string) (string, error) {
	return ids.New(prefix)
}
