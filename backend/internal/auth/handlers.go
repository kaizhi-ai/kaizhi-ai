package auth

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/users"
)

type Handlers struct {
	users   *users.Store
	apiKeys *apikeys.Service
}

func NewHandlers(userStore *users.Store, apiKeys *apikeys.Service) *Handlers {
	return &Handlers{users: userStore, apiKeys: apiKeys}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	auth := engine.Group("/api/v1/auth")
	auth.POST("/login", h.login)
	authed := auth.Use(apikeys.AuthMiddleware(h.apiKeys, h.users))
	authed.GET("/me", h.me)
	authed.POST("/logout", h.logout)
}

func (h *Handlers) login(c *gin.Context) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	user, err := h.users.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil || !users.VerifyPassword(user.PasswordHash, req.Password) || user.Status != users.StatusActive {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	session, err := h.apiKeys.IssueSession(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue session"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"access_token": session.Key,
		"token_type":   "Bearer",
		"expires_at":   session.ExpiresAt,
		"user":         publicUser(user),
	})
}

func (h *Handlers) me(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"user": publicUser(apikeys.CurrentUser(c))})
}

func (h *Handlers) logout(c *gin.Context) {
	key := apikeys.CurrentAPIKey(c)
	if key != nil && key.Kind == apikeys.KindSession {
		if err := h.apiKeys.RevokeSession(c.Request.Context(), key.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke session"})
			return
		}
	}
	c.Status(http.StatusNoContent)
}

func publicUser(user *users.User) gin.H {
	if user == nil {
		return gin.H{}
	}
	return gin.H{
		"id":         user.ID,
		"email":      user.Email,
		"status":     user.Status,
		"created_at": user.CreatedAt,
	}
}
