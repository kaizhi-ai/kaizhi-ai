package usage

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/users"
)

type Handlers struct {
	store   *Store
	users   *users.Store
	apiKeys *apikeys.Service
}

func NewHandlers(store *Store, userStore *users.Store, apiKeys *apikeys.Service) *Handlers {
	return &Handlers{store: store, users: userStore, apiKeys: apiKeys}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	adminGroup := engine.Group("/api/v1/admin/usage")
	adminGroup.Use(apikeys.AuthMiddleware(h.apiKeys, h.users), apikeys.RequireAdmin())
	adminGroup.GET("", h.adminSummary)
	adminGroup.GET("/api-keys", h.adminByAPIKey)
	adminGroup.GET("/users", h.adminByUser)
	adminGroup.GET("/models", h.adminByModel)
}

func (h *Handlers) adminSummary(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	from, to, err := usageRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	summary, err := h.store.GetSiteSummary(c.Request.Context(), from, to)
	if err != nil {
		log.Printf("admin usage summary: user=%s from=%s to=%s: %v", user.ID, dateOnly(from), dateOnly(to), err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load usage"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "usage": summary})
}

func (h *Handlers) adminByAPIKey(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	from, to, err := usageRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, err := h.store.GetSiteByAPIKey(c.Request.Context(), from, to)
	if err != nil {
		log.Printf("admin usage by api key: user=%s from=%s to=%s: %v", user.ID, dateOnly(from), dateOnly(to), err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load usage"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "api_keys": items})
}

func (h *Handlers) adminByUser(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	from, to, err := usageRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, err := h.store.GetSiteByUser(c.Request.Context(), from, to)
	if err != nil {
		log.Printf("admin usage by user: user=%s from=%s to=%s: %v", user.ID, dateOnly(from), dateOnly(to), err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load usage"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "users": items})
}

func (h *Handlers) adminByModel(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	from, to, err := usageRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, err := h.store.GetSiteByModel(c.Request.Context(), from, to)
	if err != nil {
		log.Printf("admin usage by model: user=%s from=%s to=%s: %v", user.ID, dateOnly(from), dateOnly(to), err)
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
