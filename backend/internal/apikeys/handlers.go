package apikeys

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/users"
)

const maxAPIKeyNameLength = 128

type Handlers struct {
	store   *Store
	apiKeys *Service
	users   *users.Store
	tokens  *users.TokenService
}

func NewHandlers(store *Store, apiKeys *Service, userStore *users.Store, tokens *users.TokenService) *Handlers {
	return &Handlers{store: store, apiKeys: apiKeys, users: userStore, tokens: tokens}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	group := engine.Group("/api/v1/api-keys")
	group.Use(users.AuthMiddleware(h.users, h.tokens))
	group.GET("", h.list)
	group.POST("", h.create)
	group.DELETE("/:id", h.revoke)
}

func (h *Handlers) list(c *gin.Context) {
	user := users.CurrentUser(c)
	keys, err := h.store.ListByUser(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list api keys"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"api_keys": keys})
}

func (h *Handlers) create(c *gin.Context) {
	user := users.CurrentUser(c)
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if len(name) > maxAPIKeyNameLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name must be at most 128 characters"})
		return
	}

	key, err := h.apiKeys.Create(c.Request.Context(), user.ID, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create api key"})
		return
	}
	c.JSON(http.StatusCreated, key)
}

func (h *Handlers) revoke(c *gin.Context) {
	user := users.CurrentUser(c)
	if err := h.store.Revoke(c.Request.Context(), user.ID, c.Param("id")); err != nil {
		status := http.StatusInternalServerError
		message := "failed to revoke api key"
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
			message = "api key not found"
		}
		c.JSON(status, gin.H{"error": message})
		return
	}
	c.Status(http.StatusNoContent)
}
