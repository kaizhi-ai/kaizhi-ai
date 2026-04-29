package appconfig

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type Handlers struct {
	publicBaseURL string
}

func NewHandlers(publicBaseURL string) *Handlers {
	return &Handlers{publicBaseURL: normalizeBaseURL(publicBaseURL)}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	engine.GET("/api/v1/app-config", h.get)
}

func (h *Handlers) get(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"public_base_url": h.publicBaseURL,
	})
}

func normalizeBaseURL(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimRight(value, "/")
	if strings.HasSuffix(value, "/v1") {
		value = strings.TrimSuffix(value, "/v1")
	}
	return value
}
