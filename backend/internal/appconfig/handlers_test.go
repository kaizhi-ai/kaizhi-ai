package appconfig

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHandlersReturnPublicBaseURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewHandlers(" https://kaizhi.example.com/v1/ ").RegisterRoutes(router)

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app-config", nil)
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.Code, resp.Body.String())
	}
	var body struct {
		PublicBaseURL string `json:"public_base_url"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.PublicBaseURL != "https://kaizhi.example.com" {
		t.Fatalf("public_base_url = %q, want normalized URL", body.PublicBaseURL)
	}
}
