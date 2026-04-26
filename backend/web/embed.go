package web

import (
	"bytes"
	"embed"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var distFS embed.FS

var (
	staticFS     fs.FS
	staticHTTP   http.FileSystem
	indexContent []byte
	indexModTime time.Time
)

func init() {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Printf("web: embedded dist unavailable: %v", err)
		return
	}
	staticFS = sub
	staticHTTP = http.FS(sub)

	f, err := sub.Open("index.html")
	if err != nil {
		log.Printf("web: index.html missing from embedded dist (run `pnpm build` in frontend/): %v", err)
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		log.Printf("web: read embedded index.html: %v", err)
		return
	}
	indexContent = data
	if info, err := f.Stat(); err == nil {
		indexModTime = info.ModTime()
	}
}

func available() bool {
	return len(indexContent) > 0
}

func fileExists(name string) bool {
	if staticFS == nil {
		return false
	}
	f, err := staticFS.Open(name)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

// Must be registered via api.WithMiddleware: gin attaches middleware to a
// route's handler chain at registration time, so this has to be in place
// before CLIProxy's setupRoutes runs, otherwise its `GET /` wins.
func SPAMiddleware() gin.HandlerFunc {
	fileServer := http.FileServer(staticHTTP)
	return func(c *gin.Context) {
		if !available() {
			c.Next()
			return
		}
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Next()
			return
		}
		p := c.Request.URL.Path
		switch {
		case p == "/index.html":
			target := "/"
			if c.Request.URL.RawQuery != "" {
				target = "/?" + c.Request.URL.RawQuery
			}
			c.Redirect(http.StatusMovedPermanently, target)
			c.Abort()
		case p == "/":
			serveIndex(c)
			c.Abort()
		case isClientRoute(p):
			serveIndex(c)
			c.Abort()
		case strings.HasPrefix(p, "/assets/"), p == "/favicon.svg":
			if !fileExists(strings.TrimPrefix(p, "/")) {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			// Vite emits hashed filenames under /assets, so they're safe to
			// cache forever. embed.FS reports zero ModTime, so without an
			// explicit header browsers get no caching signal at all.
			if strings.HasPrefix(p, "/assets/") {
				c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(c.Writer, c.Request)
			c.Abort()
		default:
			c.Next()
		}
	}
}

// API namespaces fall through to a real 404 instead of the SPA shell, so a
// typo'd /v1/foo doesn't get a 200 with HTML.
func NoRouteHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !available() || (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) || isAPIPath(c.Request.URL.Path) {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		serveIndex(c)
	}
}

// Direct write — routing through http.FileServer would need URL.Path="/",
// which leaks into post-c.Next() middleware and shows up in access logs.
func serveIndex(c *gin.Context) {
	// no-cache so users always pick up new asset hashes after a deploy.
	c.Writer.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(c.Writer, c.Request, "index.html", indexModTime, bytes.NewReader(indexContent))
}

func isClientRoute(p string) bool {
	for _, prefix := range []string{
		"/admin",
		"/chat",
		"/login",
		"/settings",
	} {
		if hasPathPrefix(p, prefix) {
			return true
		}
	}
	return false
}

func isAPIPath(p string) bool {
	for _, prefix := range []string{
		"/v1",
		"/v1beta",
		"/v0",
		"/api/",
		"/backend-api/",
		"/healthz",
		"/management.html",
		"/keep-alive",
		"/anthropic/",
		"/codex/",
		"/google/",
		"/antigravity/",
	} {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}
