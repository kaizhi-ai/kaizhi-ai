package apikeys

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/users"
)

const (
	contextKeyUser   = "auth.user"
	contextKeyAPIKey = "auth.api_key"
)

// AuthMiddleware authenticates browser/application API requests using a
// session key. User-created API keys are reserved for model traffic through the
// CLIProxy access provider.
func AuthMiddleware(svc *Service, userStore *users.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := ExtractBearer(c.GetHeader("Authorization"))
		if raw == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		key, err := svc.Authenticate(c.Request.Context(), raw)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		if key.Kind != KindSession {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		user, err := userStore.GetUserByID(c.Request.Context(), key.UserID)
		if err != nil || user.Status != users.StatusActive {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set(contextKeyUser, user)
		c.Set(contextKeyAPIKey, key)
		c.Next()
	}
}

func CurrentUser(c *gin.Context) *users.User {
	if value, exists := c.Get(contextKeyUser); exists {
		if user, ok := value.(*users.User); ok {
			return user
		}
	}
	return nil
}

func CurrentAPIKey(c *gin.Context) *APIKey {
	if value, exists := c.Get(contextKeyAPIKey); exists {
		if key, ok := value.(*APIKey); ok {
			return key
		}
	}
	return nil
}
