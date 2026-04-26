package web

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	noStoreCacheControl = "no-store"
	noCachePragma       = "no-cache"
	noCacheExpires      = "0"

	chatMediaPathPrefix = "/api/v1/chats/media/"
)

// APICacheMiddleware prevents browsers and intermediaries from caching API
// responses. Chat media is intentionally excluded because its handler applies
// its own private cache policy.
func APICacheMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		disableCache := shouldDisableCache(c.Request.URL.Path)
		if disableCache {
			setNoStoreHeaders(c.Writer.Header())
			c.Writer = &noStoreResponseWriter{ResponseWriter: c.Writer}
		}
		c.Next()
		if disableCache {
			setNoStoreHeaders(c.Writer.Header())
		}
	}
}

type noStoreResponseWriter struct {
	gin.ResponseWriter
}

var _ gin.ResponseWriter = (*noStoreResponseWriter)(nil)

func (w *noStoreResponseWriter) WriteHeader(code int) {
	setNoStoreHeaders(w.Header())
	w.ResponseWriter.WriteHeader(code)
}

func (w *noStoreResponseWriter) WriteHeaderNow() {
	setNoStoreHeaders(w.Header())
	w.ResponseWriter.WriteHeaderNow()
}

func (w *noStoreResponseWriter) Write(data []byte) (int, error) {
	setNoStoreHeaders(w.Header())
	return w.ResponseWriter.Write(data)
}

func (w *noStoreResponseWriter) WriteString(s string) (int, error) {
	setNoStoreHeaders(w.Header())
	return w.ResponseWriter.WriteString(s)
}

func (w *noStoreResponseWriter) Flush() {
	setNoStoreHeaders(w.Header())
	w.ResponseWriter.Flush()
}

func (w *noStoreResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func shouldDisableCache(path string) bool {
	if strings.HasPrefix(path, chatMediaPathPrefix) {
		return false
	}
	return hasPathPrefix(path, "/api") ||
		hasPathPrefix(path, "/v1") ||
		hasPathPrefix(path, "/v1beta")
}

func hasPathPrefix(path, prefix string) bool {
	return path == prefix || strings.HasPrefix(path, prefix+"/")
}

func setNoStoreHeaders(header http.Header) {
	header.Set("Cache-Control", noStoreCacheControl)
	header.Set("Pragma", noCachePragma)
	header.Set("Expires", noCacheExpires)
}
