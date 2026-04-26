package apikeys

import "time"

const (
	KindUser    = "user"
	KindSession = "session"

	StatusActive  = "active"
	StatusRevoked = "revoked"
)

type APIKey struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Name       string     `json:"name"`
	Kind       string     `json:"kind"`
	KeyPrefix  string     `json:"key_prefix"`
	KeyHash    string     `json:"-"`
	Status     string     `json:"status"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	UserStatus string     `json:"-"`
}

type CreatedAPIKey struct {
	APIKey
	Key string `json:"key"`
}
