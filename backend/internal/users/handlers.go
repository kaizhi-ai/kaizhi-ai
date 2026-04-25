package users

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type Handlers struct {
	store  *Store
	tokens *TokenService
}

func NewHandlers(store *Store, tokens *TokenService) *Handlers {
	return &Handlers{store: store, tokens: tokens}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	auth := engine.Group("/api/v1/auth")
	auth.POST("/register", h.register)
	auth.POST("/login", h.login)
	auth.GET("/me", AuthMiddleware(h.store, h.tokens), h.me)
}

func (h *Handlers) register(c *gin.Context) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	email := NormalizeEmail(req.Email)
	if email == "" || !strings.Contains(email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 8 characters"})
		return
	}

	passwordHash, err := HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user, err := h.store.CreateUser(c.Request.Context(), email, passwordHash)
	if err != nil {
		if errors.Is(err, ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}
	h.respondWithToken(c, user)
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

	user, err := h.store.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil || !VerifyPassword(user.PasswordHash, req.Password) || user.Status != "active" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}
	h.respondWithToken(c, user)
}

func (h *Handlers) me(c *gin.Context) {
	user := CurrentUser(c)
	c.JSON(http.StatusOK, gin.H{"user": publicUser(user)})
}

func (h *Handlers) respondWithToken(c *gin.Context, user *User) {
	token, expiresIn, err := h.tokens.Sign(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sign token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
		"user":         publicUser(user),
	})
}

func AuthMiddleware(store *Store, tokens *TokenService) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := ExtractBearer(c.GetHeader("Authorization"))
		if raw == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		claims, err := tokens.Verify(raw)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		user, err := store.GetUserByID(c.Request.Context(), claims.UserID)
		if err != nil || user.Status != "active" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set("user", user)
		c.Next()
	}
}

func CurrentUser(c *gin.Context) *User {
	if value, exists := c.Get("user"); exists {
		if user, ok := value.(*User); ok {
			return user
		}
	}
	return nil
}

func publicUser(user *User) gin.H {
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
