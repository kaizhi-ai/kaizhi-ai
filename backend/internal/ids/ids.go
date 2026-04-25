package ids

import (
	"crypto/rand"
	"encoding/base64"
)

func New(prefix string) (string, error) {
	random, err := Random(18)
	if err != nil {
		return "", err
	}
	return prefix + "_" + random, nil
}

func Random(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
