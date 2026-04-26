package apikeys

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/users"
)

const maxAPIKeyNameLength = 128

type Handlers struct {
	store   *Store
	apiKeys *Service
	users   *users.Store
}

func NewHandlers(store *Store, apiKeys *Service, userStore *users.Store) *Handlers {
	return &Handlers{store: store, apiKeys: apiKeys, users: userStore}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	group := engine.Group("/api/v1/api-keys")
	group.Use(AuthMiddleware(h.apiKeys, h.users))
	group.GET("", h.list)
	group.POST("", h.create)
	group.DELETE("/:id", h.revoke)
}

func (h *Handlers) list(c *gin.Context) {
	user := CurrentUser(c)
	keys, err := h.store.ListUserKeys(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list api keys"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"api_keys": keys})
}

func (h *Handlers) create(c *gin.Context) {
	user := CurrentUser(c)
	var req struct {
		Name      string  `json:"name"`
		ExpiresIn *string `json:"expires_in"` // "30d", "90d", "365d", "never"; default "90d"
	}
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if len(name) > maxAPIKeyNameLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name must be at most 128 characters"})
		return
	}

	expiresAt, err := parseExpiresIn(req.ExpiresIn)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	key, err := h.apiKeys.CreateUserKey(c.Request.Context(), user.ID, CreateUserKeyOptions{
		Name:      name,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create api key"})
		return
	}
	c.JSON(http.StatusCreated, key)
}

func (h *Handlers) revoke(c *gin.Context) {
	user := CurrentUser(c)
	if err := h.store.RevokeUserKey(c.Request.Context(), user.ID, c.Param("id")); err != nil {
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

func parseExpiresIn(raw *string) (*time.Time, error) {
	value := "90d"
	if raw != nil {
		value = strings.TrimSpace(*raw)
	}
	if value == "" {
		value = "90d"
	}
	if value == "never" {
		return nil, nil
	}
	days := map[string]int{"30d": 30, "90d": 90, "365d": 365}
	n, ok := days[value]
	if !ok {
		return nil, errors.New("expires_in must be one of 30d, 90d, 365d, never")
	}
	t := time.Now().UTC().AddDate(0, 0, n)
	return &t, nil
}
