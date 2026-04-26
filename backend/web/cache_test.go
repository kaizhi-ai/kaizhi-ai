package web

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPICacheMiddlewareDisablesCacheForAPIRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(APICacheMiddleware())
	router.GET("/api/status", okHandler)
	router.GET("/api/v1/auth/me", okHandler)
	router.GET("/v1/models", okHandler)
	router.GET("/v1beta/models", okHandler)
	router.GET("/v1/stream", func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache")
		c.Header("Pragma", "")
		c.String(http.StatusOK, "stream")
	})

	for _, path := range []string{
		"/api/status",
		"/api/v1/auth/me",
		"/v1/models",
		"/v1beta/models",
		"/v1/stream",
	} {
		t.Run(path, func(t *testing.T) {
			resp := performRequest(router, path)
			if resp.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", resp.Code)
			}
			assertNoStoreHeaders(t, resp.Header())
		})
	}
}

func TestAPICacheMiddlewareLeavesMediaCachePolicyAlone(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(APICacheMiddleware())
	router.GET("/api/v1/chats/media/:user_id/:filename", func(c *gin.Context) {
		c.Header("Cache-Control", "private, max-age=3600")
		c.String(http.StatusOK, "image")
	})

	resp := performRequest(router, "/api/v1/chats/media/user_1/file.png")
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.Code)
	}
	if got := resp.Header().Get("Cache-Control"); got != "private, max-age=3600" {
		t.Fatalf("Cache-Control = %q, want media cache policy", got)
	}
	if got := resp.Header().Get("Pragma"); got != "" {
		t.Fatalf("Pragma = %q, want empty for media", got)
	}
	if got := resp.Header().Get("Expires"); got != "" {
		t.Fatalf("Expires = %q, want empty for media", got)
	}
}

func TestAPICacheMiddlewareUsesSegmentBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(APICacheMiddleware())
	router.GET("/v10/models", okHandler)
	router.GET("/apiary/v1/auth/me", okHandler)
	router.GET("/v1beta2/models", okHandler)

	for _, path := range []string{
		"/v10/models",
		"/apiary/v1/auth/me",
		"/v1beta2/models",
	} {
		t.Run(path, func(t *testing.T) {
			resp := performRequest(router, path)
			if got := resp.Header().Get("Cache-Control"); got != "" {
				t.Fatalf("Cache-Control = %q, want empty", got)
			}
		})
	}
}

func okHandler(c *gin.Context) {
	c.String(http.StatusOK, "ok")
}

func performRequest(router http.Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func assertNoStoreHeaders(t *testing.T, header http.Header) {
	t.Helper()
	if got := header.Get("Cache-Control"); got != noStoreCacheControl {
		t.Fatalf("Cache-Control = %q, want %q", got, noStoreCacheControl)
	}
	if got := header.Get("Pragma"); got != noCachePragma {
		t.Fatalf("Pragma = %q, want %q", got, noCachePragma)
	}
	if got := header.Get("Expires"); got != noCacheExpires {
		t.Fatalf("Expires = %q, want %q", got, noCacheExpires)
	}
}
