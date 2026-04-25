package users

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type TokenService struct {
	secret []byte
	ttl    time.Duration
}

type Claims struct {
	UserID string `json:"sub"`
	Email  string `json:"email"`
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
}

func NewTokenService(secret string) (*TokenService, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	return &TokenService{secret: []byte(secret), ttl: 24 * time.Hour}, nil
}

func (s *TokenService) Sign(user *User) (string, int64, error) {
	if s == nil || user == nil {
		return "", 0, fmt.Errorf("token service not configured")
	}
	now := time.Now().UTC()
	expiresAt := now.Add(s.ttl)
	claims := Claims{
		UserID: user.ID,
		Email:  user.Email,
		Exp:    expiresAt.Unix(),
		Iat:    now.Unix(),
	}

	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	headerJSON, _ := json.Marshal(header)
	payloadJSON, err := json.Marshal(claims)
	if err != nil {
		return "", 0, err
	}

	encodedHeader := base64.RawURLEncoding.EncodeToString(headerJSON)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payloadJSON)
	signingInput := encodedHeader + "." + encodedPayload
	signature := s.sign(signingInput)
	return signingInput + "." + signature, int64(s.ttl.Seconds()), nil
}

func (s *TokenService) Verify(token string) (*Claims, error) {
	if s == nil {
		return nil, errors.New("token service not configured")
	}
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token")
	}

	signingInput := parts[0] + "." + parts[1]
	expected := s.sign(signingInput)
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return nil, errors.New("invalid token signature")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid token payload")
	}

	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, errors.New("invalid token claims")
	}
	if claims.UserID == "" || claims.Exp <= 0 {
		return nil, errors.New("invalid token claims")
	}
	if time.Now().UTC().Unix() >= claims.Exp {
		return nil, errors.New("token expired")
	}
	return &claims, nil
}

func (s *TokenService) sign(input string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(input))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func ExtractBearer(authHeader string) string {
	authHeader = strings.TrimSpace(authHeader)
	if authHeader == "" {
		return ""
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return strings.TrimSpace(parts[1])
	}
	return ""
}
