package usage

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/users"
)

type Handlers struct {
	store  *Store
	users  *users.Store
	tokens *users.TokenService
}

func NewHandlers(store *Store, userStore *users.Store, tokens *users.TokenService) *Handlers {
	return &Handlers{store: store, users: userStore, tokens: tokens}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	group := engine.Group("/api/v1/usage")
	group.Use(users.AuthMiddleware(h.users, h.tokens))
	group.GET("", h.summary)
	group.GET("/api-keys", h.byAPIKey)
	group.GET("/models", h.byModel)
}

func (h *Handlers) summary(c *gin.Context) {
	user := users.CurrentUser(c)
	from, to, err := usageRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	summary, err := h.store.GetSummary(c.Request.Context(), user.ID, from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load usage"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "usage": summary})
}

func (h *Handlers) byAPIKey(c *gin.Context) {
	user := users.CurrentUser(c)
	from, to, err := usageRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, err := h.store.GetByAPIKey(c.Request.Context(), user.ID, from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load usage"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "api_keys": items})
}

func (h *Handlers) byModel(c *gin.Context) {
	user := users.CurrentUser(c)
	from, to, err := usageRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, err := h.store.GetByModel(c.Request.Context(), user.ID, from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load usage"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "models": items})
}

func usageRange(c *gin.Context) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	to := now
	from := now.AddDate(0, 0, -30)

	if raw := strings.TrimSpace(c.Query("from")); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid 'from' date, expected YYYY-MM-DD")
		}
		from = parsed
	}
	if raw := strings.TrimSpace(c.Query("to")); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid 'to' date, expected YYYY-MM-DD")
		}
		to = parsed
	}
	if from.After(to) {
		return time.Time{}, time.Time{}, errors.New("'from' must be on or before 'to'")
	}
	return from, to, nil
}
