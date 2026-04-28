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
	authed.PATCH("/me", h.updateMe)
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
		"user":         h.publicUser(user),
	})
}

func (h *Handlers) me(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"user": h.publicUser(apikeys.CurrentUser(c))})
}

func (h *Handlers) updateMe(c *gin.Context) {
	current := apikeys.CurrentUser(c)
	if current == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	var req struct {
		Name     *string `json:"name"`
		Language *string `json:"language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	var params users.UpdateUserParams
	if req.Name != nil {
		name, ok := users.NormalizeName(*req.Name)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name must be at most 80 characters"})
			return
		}
		params.Name = &name
	}
	if req.Language != nil {
		language, ok := users.NormalizeLanguage(*req.Language)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "language must be zh-CN or en-US"})
			return
		}
		params.Language = &language
	}

	user, err := h.users.UpdateUser(c.Request.Context(), current.ID, params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": h.publicUser(user)})
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

func (h *Handlers) publicUser(user *users.User) gin.H {
	if user == nil {
		return gin.H{}
	}
	return gin.H{
		"id":                  user.ID,
		"email":               user.Email,
		"name":                user.Name,
		"language":            user.Language,
		"status":              user.Status,
		"role":                user.Role,
		"usage_5h_cost_usd":   user.Usage5HCostUSD,
		"usage_7d_cost_usd":   user.Usage7DCostUSD,
		"usage_5h_started_at": user.Usage5HStartedAt,
		"usage_7d_started_at": user.Usage7DStartedAt,
		"created_at":          user.CreatedAt,
		"updated_at":          user.UpdatedAt,
	}
}
