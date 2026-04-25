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
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/ids"
	"kaizhi/backend/internal/postgres"
	appusage "kaizhi/backend/internal/usage"
	"kaizhi/backend/internal/users"
)

type Env struct {
	UserStore   *users.Store
	APIKeyStore *apikeys.Store
	UsageStore  *appusage.Store
	APIKeys     *apikeys.Service
	Tokens      *users.TokenService
	Router      *gin.Engine
	Cleanup     func()
}

type AuthResponse struct {
	AccessToken string `json:"access_token"`
	User        struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
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
	tokens, err := users.NewTokenService("integration-test-jwt-secret")
	if err != nil {
		pool.Close()
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("create token service: %v", err)
	}
	apiKeyService, err := apikeys.NewService(apiKeyStore, "integration-test-api-key-pepper")
	if err != nil {
		pool.Close()
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("create api key service: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	users.NewHandlers(userStore, tokens).RegisterRoutes(router)
	apikeys.NewHandlers(apiKeyStore, apiKeyService, userStore, tokens).RegisterRoutes(router)
	appusage.NewHandlers(usageStore, userStore, tokens).RegisterRoutes(router)

	cleanup := func() {
		pool.Close()
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
	}
	return &Env{
		UserStore:   userStore,
		APIKeyStore: apiKeyStore,
		UsageStore:  usageStore,
		APIKeys:     apiKeyService,
		Tokens:      tokens,
		Router:      router,
		Cleanup:     cleanup,
	}
}

func RegisterUser(t *testing.T, router http.Handler, email, password string) AuthResponse {
	t.Helper()
	resp := DoJSON(t, router, http.MethodPost, "/api/v1/auth/register", "", map[string]string{
		"email":    email,
		"password": password,
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("register status = %d, body = %s", resp.Code, resp.Body.String())
	}

	var body AuthResponse
	DecodeJSON(t, resp, &body)
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
