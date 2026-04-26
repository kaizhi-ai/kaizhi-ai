package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	sdkapi "github.com/router-for-me/CLIProxyAPI/v6/sdk/api"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/users"
)

var (
	errInvalidBody   = errors.New("invalid request body")
	errStateRequired = errors.New("state is required when code is provided without redirect_url")
)

type Handlers struct {
	apiKeys     *apikeys.Service
	users       *users.Store
	requester   sdkapi.ManagementTokenRequester
	authStore   coreauth.Store
	authManager *coreauth.Manager

	mu                sync.Mutex
	latestStateByUser map[string]string
}

func NewHandlers(apiKeys *apikeys.Service, userStore *users.Store, requester sdkapi.ManagementTokenRequester, authStore coreauth.Store, authManager *coreauth.Manager) *Handlers {
	return &Handlers{
		apiKeys:           apiKeys,
		users:             userStore,
		requester:         requester,
		authStore:         authStore,
		authManager:       authManager,
		latestStateByUser: make(map[string]string),
	}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	group := engine.Group("/api/v1/provider/oauth")
	group.Use(apikeys.AuthMiddleware(h.apiKeys, h.users), apikeys.RequireAdmin())
	group.GET("/:provider", h.listAuthFiles)
	group.POST("/:provider/start", h.startOAuth)
	group.POST("/:provider/finish", h.finishOAuth)
	group.DELETE("/:provider", h.deleteAuthFile)
	group.PATCH("/:provider/proxy", h.patchAuthProxyURL)
}

func (h *Handlers) listAuthFiles(c *gin.Context) {
	provider, ok := h.providerParam(c)
	if !ok {
		return
	}
	files, err := h.listProviderAuthFiles(c.Request.Context(), provider)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list oauth providers"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"files": files})
}

func (h *Handlers) startOAuth(c *gin.Context) {
	provider, ok := h.providerParam(c)
	if !ok {
		return
	}
	if h.requester == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "oauth requester is not configured"})
		return
	}

	writer := newCaptureWriter(c.Writer, true)
	c.Writer = writer
	switch provider {
	case "anthropic":
		h.requester.RequestAnthropicToken(c)
	case "codex":
		h.requester.RequestCodexToken(c)
	case "gemini":
		h.requester.RequestGeminiCLIToken(c)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}

	if c.Writer.Status() != http.StatusOK {
		return
	}

	var resp struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(writer.body.Bytes(), &resp); err != nil || strings.TrimSpace(resp.State) == "" {
		return
	}
	h.setLatestState(c, provider, resp.State)
}

func (h *Handlers) finishOAuth(c *gin.Context) {
	provider, ok := h.providerParam(c)
	if !ok {
		return
	}
	if h.requester == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "oauth requester is not configured"})
		return
	}

	payload, err := h.normalizeFinishRequest(c, provider)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	state := stateFromFinishPayload(payload)
	if state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "state is required"})
		return
	}

	if err := h.submitOAuthCallback(c, payload); err != nil {
		writeOAuthError(c, err)
		return
	}
	if err := h.waitForOAuthCompletion(c, state); err != nil {
		writeOAuthError(c, err)
		return
	}
	h.clearLatestState(c, provider)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handlers) deleteAuthFile(c *gin.Context) {
	provider, ok := h.providerParam(c)
	if !ok {
		return
	}
	if h.authStore == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "oauth store is not configured"})
		return
	}

	name := firstNonEmpty(c.Query("name"), c.Query("id"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	record, ok, err := h.findProviderAuth(c.Request.Context(), provider, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to find oauth provider"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "oauth provider not found"})
		return
	}
	if err := h.authStore.Delete(c.Request.Context(), record.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete oauth provider"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handlers) patchAuthProxyURL(c *gin.Context) {
	provider, ok := h.providerParam(c)
	if !ok {
		return
	}
	if h.authStore == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "oauth store is not configured"})
		return
	}

	var req struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		ProxyURL string `json:"proxy_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	name := firstNonEmpty(req.Name, req.ID)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	record, ok, err := h.findProviderAuth(c.Request.Context(), provider, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to find oauth provider"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "oauth provider not found"})
		return
	}

	next := record.Clone()
	proxyURL := strings.TrimSpace(req.ProxyURL)
	next.ProxyURL = proxyURL
	if next.Metadata == nil {
		next.Metadata = make(map[string]any)
	}
	if proxyURL == "" {
		delete(next.Metadata, "proxy_url")
	} else {
		next.Metadata["proxy_url"] = proxyURL
	}

	if _, err := h.authStore.Save(c.Request.Context(), next); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update oauth provider"})
		return
	}
	c.JSON(http.StatusOK, publicAuthFile(next))
}

type finishRequest struct {
	RedirectURL       string `json:"redirect_url"`
	CallbackURL       string `json:"callback_url"`
	URL               string `json:"url"`
	Code              string `json:"code"`
	AuthorizationCode string `json:"authorization_code"`
	State             string `json:"state"`
	Error             string `json:"error"`
}

func (h *Handlers) normalizeFinishRequest(c *gin.Context, provider string) (map[string]string, error) {
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil, errInvalidBody
	}

	req, err := parseFinishRequest(data)
	if err != nil {
		return nil, err
	}

	redirectURL := firstNonEmpty(req.RedirectURL, req.CallbackURL, req.URL)
	code := firstNonEmpty(req.Code, req.AuthorizationCode)
	state := strings.TrimSpace(req.State)
	if redirectURL == "" && code != "" && state == "" {
		state = h.latestState(c, provider)
	}
	if redirectURL == "" && code != "" && state == "" {
		return nil, errStateRequired
	}

	return map[string]string{
		"provider":     provider,
		"redirect_url": redirectURL,
		"code":         code,
		"state":        state,
		"error":        strings.TrimSpace(req.Error),
	}, nil
}

func parseFinishRequest(data []byte) (finishRequest, error) {
	raw := strings.TrimSpace(string(data))
	if raw == "" {
		return finishRequest{}, errInvalidBody
	}

	var req finishRequest
	if strings.HasPrefix(raw, "{") {
		if err := json.Unmarshal(data, &req); err != nil {
			return finishRequest{}, errInvalidBody
		}
		return req, nil
	}

	var rawString string
	if strings.HasPrefix(raw, "\"") {
		if err := json.Unmarshal(data, &rawString); err != nil {
			return finishRequest{}, errInvalidBody
		}
		raw = strings.TrimSpace(rawString)
	}

	if strings.Contains(raw, "://") {
		req.RedirectURL = raw
		return req, nil
	}
	if strings.Contains(raw, "code=") || strings.Contains(raw, "state=") {
		values, err := url.ParseQuery(strings.TrimPrefix(strings.TrimPrefix(raw, "?"), "#"))
		if err == nil {
			req.Code = values.Get("code")
			req.State = values.Get("state")
			req.Error = firstNonEmpty(values.Get("error"), values.Get("error_description"))
			if req.Code != "" || req.State != "" || req.Error != "" {
				return req, nil
			}
		}
		req.RedirectURL = raw
		return req, nil
	}
	req.Code = raw
	return req, nil
}

type authFileResponse struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Provider      string    `json:"provider"`
	Email         string    `json:"email,omitempty"`
	Label         string    `json:"label,omitempty"`
	Status        string    `json:"status"`
	StatusMessage string    `json:"status_message,omitempty"`
	Disabled      bool      `json:"disabled"`
	ProxyURL      string    `json:"proxy_url,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (h *Handlers) listProviderAuthFiles(ctx context.Context, provider string) ([]authFileResponse, error) {
	records, err := h.authRecords(ctx)
	if err != nil {
		return nil, err
	}
	files := make([]authFileResponse, 0, len(records))
	for _, record := range records {
		if !authMatchesProvider(record, provider) {
			continue
		}
		files = append(files, publicAuthFile(record))
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].UpdatedAt.After(files[j].UpdatedAt)
	})
	return files, nil
}

func (h *Handlers) findProviderAuth(ctx context.Context, provider, name string) (*coreauth.Auth, bool, error) {
	records, err := h.authRecords(ctx)
	if err != nil {
		return nil, false, err
	}
	name = strings.TrimSpace(name)
	for _, record := range records {
		if !authMatchesProvider(record, provider) {
			continue
		}
		if record.ID == name || record.FileName == name || publicAuthFile(record).Name == name {
			return record, true, nil
		}
	}
	return nil, false, nil
}

func (h *Handlers) authRecords(ctx context.Context) ([]*coreauth.Auth, error) {
	if h.authStore != nil {
		return h.authStore.List(ctx)
	}
	if h.authManager != nil {
		return h.authManager.List(), nil
	}
	return nil, errors.New("oauth store is not configured")
}

func publicAuthFile(auth *coreauth.Auth) authFileResponse {
	if auth == nil {
		return authFileResponse{}
	}
	name := firstNonEmpty(auth.FileName, auth.ID)
	email := ""
	if auth.Attributes != nil {
		email = strings.TrimSpace(auth.Attributes["email"])
	}
	if email == "" && auth.Metadata != nil {
		if value, ok := auth.Metadata["email"].(string); ok {
			email = strings.TrimSpace(value)
		}
	}
	return authFileResponse{
		ID:            auth.ID,
		Name:          name,
		Provider:      auth.Provider,
		Email:         email,
		Label:         auth.Label,
		Status:        string(auth.Status),
		StatusMessage: auth.StatusMessage,
		Disabled:      auth.Disabled,
		ProxyURL:      authProxyURL(auth),
		CreatedAt:     auth.CreatedAt,
		UpdatedAt:     auth.UpdatedAt,
	}
}

func authProxyURL(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if value := strings.TrimSpace(auth.ProxyURL); value != "" {
		return value
	}
	if auth.Metadata == nil {
		return ""
	}
	if value, ok := auth.Metadata["proxy_url"].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func (h *Handlers) providerParam(c *gin.Context) (string, bool) {
	provider, ok := normalizeProvider(c.Param("provider"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return "", false
	}
	return provider, true
}

func normalizeProvider(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "anthropic", "claude":
		return "anthropic", true
	case "codex":
		return "codex", true
	case "gemini", "google":
		return "gemini", true
	default:
		return "", false
	}
}

func fileProviderID(provider string) string {
	switch provider {
	case "anthropic":
		return "claude"
	default:
		return provider
	}
}

func authMatchesProvider(auth *coreauth.Auth, provider string) bool {
	if auth == nil {
		return false
	}
	actual := strings.ToLower(strings.TrimSpace(auth.Provider))
	return actual == fileProviderID(provider)
}

func (h *Handlers) stateKey(c *gin.Context, provider string) string {
	user := apikeys.CurrentUser(c)
	if user == nil || strings.TrimSpace(user.ID) == "" {
		return ""
	}
	return user.ID + ":" + provider
}

func (h *Handlers) setLatestState(c *gin.Context, provider, state string) {
	key := h.stateKey(c, provider)
	if key == "" || strings.TrimSpace(state) == "" {
		return
	}
	h.mu.Lock()
	h.latestStateByUser[key] = strings.TrimSpace(state)
	h.mu.Unlock()
}

func (h *Handlers) latestState(c *gin.Context, provider string) string {
	key := h.stateKey(c, provider)
	if key == "" {
		return ""
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.latestStateByUser[key]
}

func (h *Handlers) clearLatestState(c *gin.Context, provider string) {
	key := h.stateKey(c, provider)
	if key == "" {
		return
	}
	h.mu.Lock()
	delete(h.latestStateByUser, key)
	h.mu.Unlock()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
