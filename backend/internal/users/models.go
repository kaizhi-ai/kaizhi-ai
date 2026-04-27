package users

import (
	"strings"
	"time"
	"unicode/utf8"
)

const (
	StatusActive = "active"
	StatusBanned = "banned"

	RoleUser  = "user"
	RoleAdmin = "admin"

	LanguageChinese = "zh-CN"
	LanguageEnglish = "en-US"
	DefaultLanguage = LanguageChinese

	MaxNameLength = 80
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Language     string    `json:"language"`
	PasswordHash string    `json:"-"`
	Status       string    `json:"status"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func NormalizeName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	if utf8.RuneCountInString(name) > MaxNameLength {
		return "", false
	}
	return name, true
}

func NormalizeLanguage(raw string) (string, bool) {
	language := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(raw), "_", "-"))
	switch language {
	case "zh", "zh-cn", "zh-hans", "zh-hans-cn":
		return LanguageChinese, true
	case "en", "en-us":
		return LanguageEnglish, true
	default:
		return "", false
	}
}

func ResolveDefaultLanguage(raw string) string {
	if language, ok := NormalizeLanguage(raw); ok {
		return language
	}
	return DefaultLanguage
}
