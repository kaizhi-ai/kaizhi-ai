package apikeys

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"kaizhi/backend/internal/ids"
)

func GenerateRawAPIKey() (string, string, error) {
	random, err := ids.Random(32)
	if err != nil {
		return "", "", err
	}
	key := "kz_live_" + random
	prefix := key
	if len(prefix) > 18 {
		prefix = prefix[:18]
	}
	return key, prefix, nil
}

func HashAPIKey(pepper, rawKey string) (string, error) {
	pepper = strings.TrimSpace(pepper)
	rawKey = strings.TrimSpace(rawKey)
	if pepper == "" {
		return "", fmt.Errorf("API_KEY_PEPPER is required")
	}
	if rawKey == "" {
		return "", fmt.Errorf("api key is required")
	}
	mac := hmac.New(sha256.New, []byte(pepper))
	_, _ = mac.Write([]byte(rawKey))
	return hex.EncodeToString(mac.Sum(nil)), nil
}
