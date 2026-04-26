package web

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestSPAMiddlewareServesClientRouteBeforeBackendRoute(t *testing.T) {
	withTestIndex(t)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(SPAMiddleware())
	router.GET("/settings/*path", func(c *gin.Context) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "backend route should not handle client route"})
	})

	resp := performRequest(router, "/settings/api-keys")
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", resp.Code, resp.Body.String())
	}
	if got := resp.Header().Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", got)
	}
	if !strings.Contains(resp.Body.String(), `<div id="root"></div>`) {
		t.Fatalf("body does not look like SPA index.html: %s", resp.Body.String())
	}
}

func withTestIndex(t *testing.T) {
	t.Helper()

	originalContent := indexContent
	originalModTime := indexModTime
	indexContent = []byte(`<!doctype html><div id="root"></div>`)
	indexModTime = time.Unix(0, 0)

	t.Cleanup(func() {
		indexContent = originalContent
		indexModTime = originalModTime
	})
}

func TestSPAMiddlewareUsesClientRouteSegmentBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(SPAMiddleware())
	router.GET("/settings-api-keys", okHandler)

	resp := performRequest(router, "/settings-api-keys")
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.Code)
	}
	if got := resp.Body.String(); got != "ok" {
		t.Fatalf("body = %q, want backend route response", got)
	}
}
