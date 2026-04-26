package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/proxyutil"
)

const (
	providerAPIKeyGemini           = "gemini"
	providerAPIKeyClaude           = "claude"
	providerAPIKeyCodex            = "codex"
	providerAPIKeyOpenAICompatible = "openai-compatible"
	providerAPIKeyVertex           = "vertex"
)

var errProviderConfigNotConfigured = errors.New("provider api key config is not configured")

const providerAPIKeyModelsTimeout = 30 * time.Second

type providerAPIKeyRequest struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Type     string `json:"type"`
	Name     string `json:"name"`

	APIKey       *string `json:"api_key"`
	APIKeyHyphen *string `json:"api-key"`
	APIKeyCamel  *string `json:"apiKey"`
	Key          *string `json:"key"`

	Prefix *string `json:"prefix"`

	BaseURL       *string `json:"base_url"`
	BaseURLHyphen *string `json:"base-url"`
	BaseURLCamel  *string `json:"baseURL"`

	ProxyURL       *string `json:"proxy_url"`
	ProxyURLHyphen *string `json:"proxy-url"`
	ProxyURLCamel  *string `json:"proxyURL"`

	Priority *int                   `json:"priority"`
	Headers  *map[string]string     `json:"headers"`
	Models   *[]providerAPIKeyModel `json:"models"`

	ExcludedModels       *[]string `json:"excluded_models"`
	ExcludedModelsHyphen *[]string `json:"excluded-models"`
	ExcludedModelsCamel  *[]string `json:"excludedModels"`
}

type providerAPIKeyModel struct {
	Name  string `json:"name"`
	Alias string `json:"alias"`
}

type providerAPIKeyResponse struct {
	ID             string                `json:"id"`
	Provider       string                `json:"provider"`
	Name           string                `json:"name,omitempty"`
	Index          int                   `json:"index"`
	KeyIndex       *int                  `json:"key_index,omitempty"`
	HasAPIKey      bool                  `json:"has_api_key"`
	APIKeyPreview  string                `json:"api_key_preview,omitempty"`
	Prefix         string                `json:"prefix,omitempty"`
	BaseURL        string                `json:"base_url,omitempty"`
	ProxyURL       string                `json:"proxy_url,omitempty"`
	Priority       int                   `json:"priority,omitempty"`
	Models         []providerAPIKeyModel `json:"models,omitempty"`
	Headers        []string              `json:"headers,omitempty"`
	ExcludedModels []string              `json:"excluded_models,omitempty"`
}

type providerAPIKeyTarget struct {
	Provider string
	Index    int
	KeyIndex int
}

type providerAPIKeyRawEntry struct {
	APIKey   string
	BaseURL  string
	ProxyURL string
}

func (h *Handlers) listProviderAPIKeys(c *gin.Context) {
	filter := ""
	if raw := strings.TrimSpace(c.Query("provider")); raw != "" {
		provider, ok := normalizeAPIKeyProvider(raw)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
			return
		}
		filter = provider
	}

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}

	items := providerAPIKeyItems(cfg)
	if filter != "" {
		filtered := items[:0]
		for _, item := range items {
			if item.Provider == filter {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	c.JSON(http.StatusOK, gin.H{"keys": items})
}

func (h *Handlers) getProviderAPIKey(c *gin.Context) {
	target, err := providerAPIKeyTargetFromRequest(c, "")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}
	item, ok := providerAPIKeyItemByTarget(cfg, target)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider api key not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) fetchProviderAPIKeyModels(c *gin.Context) {
	req, ok := bindProviderAPIKeyRequest(c)
	if !ok {
		return
	}

	provider := ""
	var target providerAPIKeyTarget
	if strings.TrimSpace(req.ID) != "" {
		parsed, err := parseProviderAPIKeyID(req.ID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		target = parsed
		provider = parsed.Provider
	}
	if provider == "" {
		var ok bool
		provider, ok = normalizeAPIKeyProvider(firstNonEmpty(req.Provider, req.Type))
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
			return
		}
	}

	apiKey, hasAPIKey := req.apiKeyValue()
	apiKey = strings.TrimSpace(apiKey)
	baseURL, hasBaseURL := req.baseURLValue()
	baseURL = strings.TrimSpace(baseURL)
	proxyURL, hasProxyURL := req.proxyURLValue()
	proxyURL = strings.TrimSpace(proxyURL)

	if strings.TrimSpace(req.ID) != "" && (!hasAPIKey || apiKey == "" || !hasBaseURL || baseURL == "" || !hasProxyURL) {
		h.configMu.Lock()
		cfg, err := h.loadProviderConfigLocked()
		if err != nil {
			h.configMu.Unlock()
			writeProviderAPIKeyConfigError(c, err)
			return
		}
		raw, ok := providerAPIKeyRawEntryByTarget(cfg, target)
		h.configMu.Unlock()
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "provider api key not found"})
			return
		}
		if apiKey == "" {
			apiKey = strings.TrimSpace(raw.APIKey)
		}
		if baseURL == "" {
			baseURL = strings.TrimSpace(raw.BaseURL)
		}
		if !hasProxyURL {
			proxyURL = strings.TrimSpace(raw.ProxyURL)
		}
	}

	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api_key is required"})
		return
	}
	if baseURL == "" {
		baseURL = defaultProviderAPIKeyBaseURL(provider)
	}
	if baseURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_url is required"})
		return
	}

	proxyURL = h.providerModelFetchProxyURL(proxyURL)
	ids, err := fetchProviderAPIKeyModelIDs(c.Request.Context(), provider, baseURL, apiKey, proxyURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ids": ids})
}

func (h *Handlers) createProviderAPIKey(c *gin.Context) {
	req, ok := bindProviderAPIKeyRequest(c)
	if !ok {
		return
	}

	provider, ok := normalizeAPIKeyProvider(firstNonEmpty(req.Provider, req.Type))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}
	apiKey, ok := req.apiKeyValue()
	if !ok || strings.TrimSpace(apiKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api_key is required"})
		return
	}
	apiKey = strings.TrimSpace(apiKey)

	baseURL, _ := req.baseURLValue()
	baseURL = strings.TrimSpace(baseURL)
	if provider == providerAPIKeyOpenAICompatible && baseURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_url is required for openai-compatible providers"})
		return
	}
	if provider == providerAPIKeyCodex && baseURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_url is required for codex api keys"})
		return
	}

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}

	target, err := h.appendProviderAPIKey(cfg, provider, apiKey, req)
	if err != nil {
		writeProviderAPIKeyMutationError(c, err)
		return
	}
	if err := h.saveProviderConfigLocked(cfg); err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}

	item, ok := providerAPIKeyItemByTarget(cfg, target)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load created provider api key"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handlers) patchProviderAPIKey(c *gin.Context) {
	req, ok := bindProviderAPIKeyRequest(c)
	if !ok {
		return
	}
	target, err := providerAPIKeyTargetFromRequest(c, req.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}
	if _, ok := providerAPIKeyItemByTarget(cfg, target); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider api key not found"})
		return
	}
	if err := applyProviderAPIKeyPatch(cfg, target, req); err != nil {
		writeProviderAPIKeyMutationError(c, err)
		return
	}
	if err := h.saveProviderConfigLocked(cfg); err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}

	item, ok := providerAPIKeyItemByTarget(cfg, target)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load updated provider api key"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) deleteProviderAPIKey(c *gin.Context) {
	target, err := providerAPIKeyTargetFromRequest(c, "")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}
	if !deleteProviderAPIKeyTarget(cfg, target) {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider api key not found"})
		return
	}
	if err := h.saveProviderConfigLocked(cfg); err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handlers) loadProviderConfigLocked() (*sdkconfig.Config, error) {
	if h == nil || strings.TrimSpace(h.configPath) == "" {
		return nil, errProviderConfigNotConfigured
	}
	return sdkconfig.LoadConfig(h.configPath)
}

func (h *Handlers) saveProviderConfigLocked(cfg *sdkconfig.Config) error {
	if h == nil || strings.TrimSpace(h.configPath) == "" {
		return errProviderConfigNotConfigured
	}
	return sdkconfig.SaveConfigPreserveComments(h.configPath, cfg)
}

func (h *Handlers) providerModelFetchProxyURL(proxyURL string) string {
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL != "" {
		return proxyURL
	}
	if h == nil {
		return ""
	}

	h.configMu.Lock()
	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		cfg = h.cfg
	}
	h.configMu.Unlock()
	if cfg == nil {
		return ""
	}
	return strings.TrimSpace(cfg.ProxyURL)
}

func (h *Handlers) appendProviderAPIKey(cfg *sdkconfig.Config, provider, apiKey string, req providerAPIKeyRequest) (providerAPIKeyTarget, error) {
	prefix, _ := req.prefixValue()
	baseURL, _ := req.baseURLValue()
	proxyURL, _ := req.proxyURLValue()
	headers, _ := req.headersValue()
	models, hasModels := req.modelsValue()
	excludedModels, _ := req.excludedModelsValue()
	priority := req.priorityValue()

	prefix = strings.TrimSpace(prefix)
	baseURL = strings.TrimSpace(baseURL)
	proxyURL = strings.TrimSpace(proxyURL)
	headers = normalizeProviderAPIKeyHeaders(headers)
	excludedModels = normalizeProviderAPIKeyStrings(excludedModels)

	if providerAPIKeyExists(cfg, provider, req.Name, apiKey, baseURL) {
		return providerAPIKeyTarget{}, &providerAPIKeyMutationError{StatusCode: http.StatusConflict, Message: "provider api key already exists"}
	}

	switch provider {
	case providerAPIKeyGemini:
		entry := sdkconfig.GeminiKey{
			APIKey:         apiKey,
			Priority:       priority,
			Prefix:         prefix,
			BaseURL:        baseURL,
			ProxyURL:       proxyURL,
			Headers:        headers,
			ExcludedModels: excludedModels,
		}
		if hasModels {
			applyProviderModelList(&entry, models)
		}
		cfg.GeminiKey = append(cfg.GeminiKey, entry)
		cfg.SanitizeGeminiKeys()
		return providerAPIKeyTarget{Provider: provider, Index: len(cfg.GeminiKey) - 1, KeyIndex: -1}, nil

	case providerAPIKeyClaude:
		entry := sdkconfig.ClaudeKey{
			APIKey:         apiKey,
			Priority:       priority,
			Prefix:         prefix,
			BaseURL:        baseURL,
			ProxyURL:       proxyURL,
			Headers:        headers,
			ExcludedModels: excludedModels,
		}
		if hasModels {
			applyProviderModelList(&entry, models)
		}
		cfg.ClaudeKey = append(cfg.ClaudeKey, entry)
		cfg.SanitizeClaudeKeys()
		return providerAPIKeyTarget{Provider: provider, Index: len(cfg.ClaudeKey) - 1, KeyIndex: -1}, nil

	case providerAPIKeyCodex:
		entry := sdkconfig.CodexKey{
			APIKey:         apiKey,
			Priority:       priority,
			Prefix:         prefix,
			BaseURL:        baseURL,
			ProxyURL:       proxyURL,
			Headers:        headers,
			ExcludedModels: excludedModels,
		}
		if hasModels {
			applyProviderModelList(&entry, models)
		}
		cfg.CodexKey = append(cfg.CodexKey, entry)
		cfg.SanitizeCodexKeys()
		return providerAPIKeyTarget{Provider: provider, Index: len(cfg.CodexKey) - 1, KeyIndex: -1}, nil

	case providerAPIKeyOpenAICompatible:
		name := normalizeOpenAICompatibilityProviderName(req.Name)
		if name == "" {
			return providerAPIKeyTarget{}, &providerAPIKeyMutationError{StatusCode: http.StatusBadRequest, Message: "name is required for openai-compatible providers"}
		}
		if _, ok := openAICompatibilityProviderIndexByName(cfg, name); ok {
			return providerAPIKeyTarget{}, &providerAPIKeyMutationError{StatusCode: http.StatusConflict, Message: "openai compatibility provider already exists"}
		}
		entry := sdkconfig.OpenAICompatibility{
			Name:     name,
			Priority: priority,
			Prefix:   prefix,
			BaseURL:  baseURL,
			APIKeyEntries: []sdkconfig.OpenAICompatibilityAPIKey{
				{APIKey: apiKey, ProxyURL: proxyURL},
			},
			Headers: headers,
		}
		if hasModels {
			applyProviderModelList(&entry, models)
		}
		cfg.OpenAICompatibility = append(cfg.OpenAICompatibility, entry)
		normalizeOpenAICompatibleProviderKeys(cfg)
		cfg.SanitizeOpenAICompatibility()
		return providerAPIKeyTarget{Provider: provider, Index: len(cfg.OpenAICompatibility) - 1, KeyIndex: 0}, nil

	case providerAPIKeyVertex:
		entry := sdkconfig.VertexCompatKey{
			APIKey:         apiKey,
			Priority:       priority,
			Prefix:         prefix,
			BaseURL:        baseURL,
			ProxyURL:       proxyURL,
			Headers:        headers,
			ExcludedModels: excludedModels,
		}
		if hasModels {
			applyProviderModelList(&entry, models)
		}
		cfg.VertexCompatAPIKey = append(cfg.VertexCompatAPIKey, entry)
		cfg.SanitizeVertexCompatKeys()
		return providerAPIKeyTarget{Provider: provider, Index: len(cfg.VertexCompatAPIKey) - 1, KeyIndex: -1}, nil
	default:
		return providerAPIKeyTarget{}, &providerAPIKeyMutationError{StatusCode: http.StatusBadRequest, Message: "unsupported provider"}
	}
}

func applyProviderAPIKeyPatch(cfg *sdkconfig.Config, target providerAPIKeyTarget, req providerAPIKeyRequest) error {
	applyCommon := func(entry any, setAPIKey func(string), setPrefix func(string), setBaseURL func(string), setProxyURL func(string), setPriority func(int), setHeaders func(map[string]string), setExcludedModels func([]string)) error {
		if apiKey, ok := req.apiKeyValue(); ok {
			apiKey = strings.TrimSpace(apiKey)
			if apiKey == "" {
				return &providerAPIKeyMutationError{StatusCode: http.StatusBadRequest, Message: "api_key cannot be empty"}
			}
			setAPIKey(apiKey)
		}
		if prefix, ok := req.prefixValue(); ok {
			setPrefix(strings.TrimSpace(prefix))
		}
		if baseURL, ok := req.baseURLValue(); ok {
			setBaseURL(strings.TrimSpace(baseURL))
		}
		if proxyURL, ok := req.proxyURLValue(); ok {
			setProxyURL(strings.TrimSpace(proxyURL))
		}
		if req.Priority != nil {
			setPriority(*req.Priority)
		}
		if headers, ok := req.headersValue(); ok {
			setHeaders(normalizeProviderAPIKeyHeaders(headers))
		}
		if excludedModels, ok := req.excludedModelsValue(); ok {
			setExcludedModels(normalizeProviderAPIKeyStrings(excludedModels))
		}
		if models, ok := req.modelsValue(); ok {
			applyProviderModelList(entry, models)
		}
		return nil
	}

	switch target.Provider {
	case providerAPIKeyGemini:
		if target.Index < 0 || target.Index >= len(cfg.GeminiKey) {
			return &providerAPIKeyMutationError{StatusCode: http.StatusNotFound, Message: "provider api key not found"}
		}
		entry := cfg.GeminiKey[target.Index]
		if err := applyCommon(&entry, func(v string) { entry.APIKey = v }, func(v string) { entry.Prefix = v }, func(v string) { entry.BaseURL = v }, func(v string) { entry.ProxyURL = v }, func(v int) { entry.Priority = v }, func(v map[string]string) { entry.Headers = v }, func(v []string) { entry.ExcludedModels = v }); err != nil {
			return err
		}
		cfg.GeminiKey[target.Index] = entry
		cfg.SanitizeGeminiKeys()

	case providerAPIKeyClaude:
		if target.Index < 0 || target.Index >= len(cfg.ClaudeKey) {
			return &providerAPIKeyMutationError{StatusCode: http.StatusNotFound, Message: "provider api key not found"}
		}
		entry := cfg.ClaudeKey[target.Index]
		if err := applyCommon(&entry, func(v string) { entry.APIKey = v }, func(v string) { entry.Prefix = v }, func(v string) { entry.BaseURL = v }, func(v string) { entry.ProxyURL = v }, func(v int) { entry.Priority = v }, func(v map[string]string) { entry.Headers = v }, func(v []string) { entry.ExcludedModels = v }); err != nil {
			return err
		}
		cfg.ClaudeKey[target.Index] = entry
		cfg.SanitizeClaudeKeys()

	case providerAPIKeyCodex:
		if target.Index < 0 || target.Index >= len(cfg.CodexKey) {
			return &providerAPIKeyMutationError{StatusCode: http.StatusNotFound, Message: "provider api key not found"}
		}
		entry := cfg.CodexKey[target.Index]
		if err := applyCommon(&entry, func(v string) { entry.APIKey = v }, func(v string) { entry.Prefix = v }, func(v string) { entry.BaseURL = v }, func(v string) { entry.ProxyURL = v }, func(v int) { entry.Priority = v }, func(v map[string]string) { entry.Headers = v }, func(v []string) { entry.ExcludedModels = v }); err != nil {
			return err
		}
		if strings.TrimSpace(entry.BaseURL) == "" {
			return &providerAPIKeyMutationError{StatusCode: http.StatusBadRequest, Message: "base_url is required for codex api keys"}
		}
		cfg.CodexKey[target.Index] = entry
		cfg.SanitizeCodexKeys()

	case providerAPIKeyOpenAICompatible:
		if target.Index < 0 || target.Index >= len(cfg.OpenAICompatibility) {
			return &providerAPIKeyMutationError{StatusCode: http.StatusNotFound, Message: "provider api key not found"}
		}
		entry := cfg.OpenAICompatibility[target.Index]
		if target.KeyIndex < 0 || target.KeyIndex >= len(entry.APIKeyEntries) {
			return &providerAPIKeyMutationError{StatusCode: http.StatusNotFound, Message: "provider api key not found"}
		}
		keyEntry := entry.APIKeyEntries[target.KeyIndex]
		if apiKey, ok := req.apiKeyValue(); ok {
			apiKey = strings.TrimSpace(apiKey)
			if apiKey == "" {
				return &providerAPIKeyMutationError{StatusCode: http.StatusBadRequest, Message: "api_key cannot be empty"}
			}
			keyEntry.APIKey = apiKey
		}
		if proxyURL, ok := req.proxyURLValue(); ok {
			keyEntry.ProxyURL = strings.TrimSpace(proxyURL)
		}
		if strings.TrimSpace(req.Name) != "" {
			nextName := normalizeOpenAICompatibilityProviderName(req.Name)
			if existing, ok := openAICompatibilityProviderIndexByName(cfg, nextName); ok && existing != target.Index {
				return &providerAPIKeyMutationError{StatusCode: http.StatusConflict, Message: "openai compatibility provider already exists"}
			}
			entry.Name = nextName
		}
		if prefix, ok := req.prefixValue(); ok {
			entry.Prefix = strings.TrimSpace(prefix)
		}
		if baseURL, ok := req.baseURLValue(); ok {
			baseURL = strings.TrimSpace(baseURL)
			if baseURL == "" {
				return &providerAPIKeyMutationError{StatusCode: http.StatusBadRequest, Message: "base_url is required for openai-compatible providers"}
			}
			entry.BaseURL = baseURL
		}
		if req.Priority != nil {
			entry.Priority = *req.Priority
		}
		if headers, ok := req.headersValue(); ok {
			entry.Headers = normalizeProviderAPIKeyHeaders(headers)
		}
		if models, ok := req.modelsValue(); ok {
			applyProviderModelList(&entry, models)
		}
		entry.APIKeyEntries[target.KeyIndex] = keyEntry
		cfg.OpenAICompatibility[target.Index] = entry
		normalizeOpenAICompatibleProviderKeys(cfg)
		cfg.SanitizeOpenAICompatibility()

	case providerAPIKeyVertex:
		if target.Index < 0 || target.Index >= len(cfg.VertexCompatAPIKey) {
			return &providerAPIKeyMutationError{StatusCode: http.StatusNotFound, Message: "provider api key not found"}
		}
		entry := cfg.VertexCompatAPIKey[target.Index]
		if err := applyCommon(&entry, func(v string) { entry.APIKey = v }, func(v string) { entry.Prefix = v }, func(v string) { entry.BaseURL = v }, func(v string) { entry.ProxyURL = v }, func(v int) { entry.Priority = v }, func(v map[string]string) { entry.Headers = v }, func(v []string) { entry.ExcludedModels = v }); err != nil {
			return err
		}
		cfg.VertexCompatAPIKey[target.Index] = entry
		cfg.SanitizeVertexCompatKeys()
	}
	return nil
}

func deleteProviderAPIKeyTarget(cfg *sdkconfig.Config, target providerAPIKeyTarget) bool {
	switch target.Provider {
	case providerAPIKeyGemini:
		if target.Index < 0 || target.Index >= len(cfg.GeminiKey) {
			return false
		}
		cfg.GeminiKey = append(cfg.GeminiKey[:target.Index], cfg.GeminiKey[target.Index+1:]...)
		cfg.SanitizeGeminiKeys()
		return true
	case providerAPIKeyClaude:
		if target.Index < 0 || target.Index >= len(cfg.ClaudeKey) {
			return false
		}
		cfg.ClaudeKey = append(cfg.ClaudeKey[:target.Index], cfg.ClaudeKey[target.Index+1:]...)
		cfg.SanitizeClaudeKeys()
		return true
	case providerAPIKeyCodex:
		if target.Index < 0 || target.Index >= len(cfg.CodexKey) {
			return false
		}
		cfg.CodexKey = append(cfg.CodexKey[:target.Index], cfg.CodexKey[target.Index+1:]...)
		cfg.SanitizeCodexKeys()
		return true
	case providerAPIKeyOpenAICompatible:
		if target.Index < 0 || target.Index >= len(cfg.OpenAICompatibility) {
			return false
		}
		entry := cfg.OpenAICompatibility[target.Index]
		if target.KeyIndex < 0 || target.KeyIndex >= len(entry.APIKeyEntries) {
			return false
		}
		entry.APIKeyEntries = append(entry.APIKeyEntries[:target.KeyIndex], entry.APIKeyEntries[target.KeyIndex+1:]...)
		if len(entry.APIKeyEntries) == 0 {
			cfg.OpenAICompatibility = append(cfg.OpenAICompatibility[:target.Index], cfg.OpenAICompatibility[target.Index+1:]...)
		} else {
			cfg.OpenAICompatibility[target.Index] = entry
		}
		normalizeOpenAICompatibleProviderKeys(cfg)
		cfg.SanitizeOpenAICompatibility()
		return true
	case providerAPIKeyVertex:
		if target.Index < 0 || target.Index >= len(cfg.VertexCompatAPIKey) {
			return false
		}
		cfg.VertexCompatAPIKey = append(cfg.VertexCompatAPIKey[:target.Index], cfg.VertexCompatAPIKey[target.Index+1:]...)
		cfg.SanitizeVertexCompatKeys()
		return true
	default:
		return false
	}
}

func providerAPIKeyItems(cfg *sdkconfig.Config) []providerAPIKeyResponse {
	if cfg == nil {
		return nil
	}
	items := make([]providerAPIKeyResponse, 0, len(cfg.GeminiKey)+len(cfg.ClaudeKey)+len(cfg.CodexKey)+len(cfg.VertexCompatAPIKey)+len(cfg.OpenAICompatibility))
	for i, entry := range cfg.GeminiKey {
		items = append(items, providerAPIKeyResponse{
			ID:             providerAPIKeyID(providerAPIKeyGemini, i, -1),
			Provider:       providerAPIKeyGemini,
			Index:          i,
			HasAPIKey:      strings.TrimSpace(entry.APIKey) != "",
			APIKeyPreview:  maskProviderAPIKey(entry.APIKey),
			Prefix:         strings.TrimSpace(entry.Prefix),
			BaseURL:        strings.TrimSpace(entry.BaseURL),
			ProxyURL:       strings.TrimSpace(entry.ProxyURL),
			Priority:       entry.Priority,
			Models:         providerModelList(entry.Models),
			Headers:        providerHeaderNames(entry.Headers),
			ExcludedModels: normalizeProviderAPIKeyStrings(entry.ExcludedModels),
		})
	}
	for i, entry := range cfg.ClaudeKey {
		items = append(items, providerAPIKeyResponse{
			ID:             providerAPIKeyID(providerAPIKeyClaude, i, -1),
			Provider:       providerAPIKeyClaude,
			Index:          i,
			HasAPIKey:      strings.TrimSpace(entry.APIKey) != "",
			APIKeyPreview:  maskProviderAPIKey(entry.APIKey),
			Prefix:         strings.TrimSpace(entry.Prefix),
			BaseURL:        strings.TrimSpace(entry.BaseURL),
			ProxyURL:       strings.TrimSpace(entry.ProxyURL),
			Priority:       entry.Priority,
			Models:         providerModelList(entry.Models),
			Headers:        providerHeaderNames(entry.Headers),
			ExcludedModels: normalizeProviderAPIKeyStrings(entry.ExcludedModels),
		})
	}
	for i, entry := range cfg.CodexKey {
		items = append(items, providerAPIKeyResponse{
			ID:             providerAPIKeyID(providerAPIKeyCodex, i, -1),
			Provider:       providerAPIKeyCodex,
			Index:          i,
			HasAPIKey:      strings.TrimSpace(entry.APIKey) != "",
			APIKeyPreview:  maskProviderAPIKey(entry.APIKey),
			Prefix:         strings.TrimSpace(entry.Prefix),
			BaseURL:        strings.TrimSpace(entry.BaseURL),
			ProxyURL:       strings.TrimSpace(entry.ProxyURL),
			Priority:       entry.Priority,
			Models:         providerModelList(entry.Models),
			Headers:        providerHeaderNames(entry.Headers),
			ExcludedModels: normalizeProviderAPIKeyStrings(entry.ExcludedModels),
		})
	}
	for i, entry := range cfg.OpenAICompatibility {
		for j, keyEntry := range entry.APIKeyEntries {
			keyIndex := j
			items = append(items, providerAPIKeyResponse{
				ID:            providerAPIKeyID(providerAPIKeyOpenAICompatible, i, j),
				Provider:      providerAPIKeyOpenAICompatible,
				Name:          strings.TrimSpace(entry.Name),
				Index:         i,
				KeyIndex:      &keyIndex,
				HasAPIKey:     strings.TrimSpace(keyEntry.APIKey) != "",
				APIKeyPreview: maskProviderAPIKey(keyEntry.APIKey),
				Prefix:        strings.TrimSpace(entry.Prefix),
				BaseURL:       strings.TrimSpace(entry.BaseURL),
				ProxyURL:      strings.TrimSpace(keyEntry.ProxyURL),
				Priority:      entry.Priority,
				Models:        providerModelList(entry.Models),
				Headers:       providerHeaderNames(entry.Headers),
			})
		}
	}
	for i, entry := range cfg.VertexCompatAPIKey {
		items = append(items, providerAPIKeyResponse{
			ID:             providerAPIKeyID(providerAPIKeyVertex, i, -1),
			Provider:       providerAPIKeyVertex,
			Index:          i,
			HasAPIKey:      strings.TrimSpace(entry.APIKey) != "",
			APIKeyPreview:  maskProviderAPIKey(entry.APIKey),
			Prefix:         strings.TrimSpace(entry.Prefix),
			BaseURL:        strings.TrimSpace(entry.BaseURL),
			ProxyURL:       strings.TrimSpace(entry.ProxyURL),
			Priority:       entry.Priority,
			Models:         providerModelList(entry.Models),
			Headers:        providerHeaderNames(entry.Headers),
			ExcludedModels: normalizeProviderAPIKeyStrings(entry.ExcludedModels),
		})
	}
	return items
}

func providerAPIKeyItemByTarget(cfg *sdkconfig.Config, target providerAPIKeyTarget) (providerAPIKeyResponse, bool) {
	for _, item := range providerAPIKeyItems(cfg) {
		if item.ID == providerAPIKeyID(target.Provider, target.Index, target.KeyIndex) {
			return item, true
		}
	}
	return providerAPIKeyResponse{}, false
}

func providerAPIKeyRawEntryByTarget(cfg *sdkconfig.Config, target providerAPIKeyTarget) (providerAPIKeyRawEntry, bool) {
	if cfg == nil {
		return providerAPIKeyRawEntry{}, false
	}
	switch target.Provider {
	case providerAPIKeyGemini:
		if target.Index < 0 || target.Index >= len(cfg.GeminiKey) {
			return providerAPIKeyRawEntry{}, false
		}
		entry := cfg.GeminiKey[target.Index]
		return providerAPIKeyRawEntry{APIKey: entry.APIKey, BaseURL: entry.BaseURL, ProxyURL: entry.ProxyURL}, true
	case providerAPIKeyClaude:
		if target.Index < 0 || target.Index >= len(cfg.ClaudeKey) {
			return providerAPIKeyRawEntry{}, false
		}
		entry := cfg.ClaudeKey[target.Index]
		return providerAPIKeyRawEntry{APIKey: entry.APIKey, BaseURL: entry.BaseURL, ProxyURL: entry.ProxyURL}, true
	case providerAPIKeyCodex:
		if target.Index < 0 || target.Index >= len(cfg.CodexKey) {
			return providerAPIKeyRawEntry{}, false
		}
		entry := cfg.CodexKey[target.Index]
		return providerAPIKeyRawEntry{APIKey: entry.APIKey, BaseURL: entry.BaseURL, ProxyURL: entry.ProxyURL}, true
	case providerAPIKeyOpenAICompatible:
		if target.Index < 0 || target.Index >= len(cfg.OpenAICompatibility) {
			return providerAPIKeyRawEntry{}, false
		}
		entry := cfg.OpenAICompatibility[target.Index]
		if target.KeyIndex < 0 || target.KeyIndex >= len(entry.APIKeyEntries) {
			return providerAPIKeyRawEntry{}, false
		}
		return providerAPIKeyRawEntry{APIKey: entry.APIKeyEntries[target.KeyIndex].APIKey, BaseURL: entry.BaseURL, ProxyURL: entry.APIKeyEntries[target.KeyIndex].ProxyURL}, true
	case providerAPIKeyVertex:
		if target.Index < 0 || target.Index >= len(cfg.VertexCompatAPIKey) {
			return providerAPIKeyRawEntry{}, false
		}
		entry := cfg.VertexCompatAPIKey[target.Index]
		return providerAPIKeyRawEntry{APIKey: entry.APIKey, BaseURL: entry.BaseURL, ProxyURL: entry.ProxyURL}, true
	default:
		return providerAPIKeyRawEntry{}, false
	}
}

func providerAPIKeyExists(cfg *sdkconfig.Config, provider, name, apiKey, baseURL string) bool {
	apiKey = strings.TrimSpace(apiKey)
	baseURL = strings.TrimSpace(baseURL)
	name = normalizeOpenAICompatibilityProviderName(name)
	switch provider {
	case providerAPIKeyGemini:
		for _, entry := range cfg.GeminiKey {
			if strings.TrimSpace(entry.APIKey) == apiKey && strings.TrimSpace(entry.BaseURL) == baseURL {
				return true
			}
		}
	case providerAPIKeyClaude:
		for _, entry := range cfg.ClaudeKey {
			if strings.TrimSpace(entry.APIKey) == apiKey && strings.TrimSpace(entry.BaseURL) == baseURL {
				return true
			}
		}
	case providerAPIKeyCodex:
		for _, entry := range cfg.CodexKey {
			if strings.TrimSpace(entry.APIKey) == apiKey && strings.TrimSpace(entry.BaseURL) == baseURL {
				return true
			}
		}
	case providerAPIKeyOpenAICompatible:
		for _, entry := range cfg.OpenAICompatibility {
			if normalizeOpenAICompatibilityProviderName(entry.Name) != name || strings.TrimSpace(entry.BaseURL) != baseURL {
				continue
			}
			for _, keyEntry := range entry.APIKeyEntries {
				if strings.TrimSpace(keyEntry.APIKey) == apiKey {
					return true
				}
			}
		}
	case providerAPIKeyVertex:
		for _, entry := range cfg.VertexCompatAPIKey {
			if strings.TrimSpace(entry.APIKey) == apiKey && strings.TrimSpace(entry.BaseURL) == baseURL {
				return true
			}
		}
	}
	return false
}

func bindProviderAPIKeyRequest(c *gin.Context) (providerAPIKeyRequest, bool) {
	var req providerAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return providerAPIKeyRequest{}, false
	}
	return req, true
}

func providerAPIKeyTargetFromRequest(c *gin.Context, bodyID string) (providerAPIKeyTarget, error) {
	if id := firstNonEmpty(c.Param("id"), c.Query("id"), bodyID); id != "" {
		return parseProviderAPIKeyID(id)
	}

	provider, ok := normalizeAPIKeyProvider(c.Query("provider"))
	if !ok {
		return providerAPIKeyTarget{}, errors.New("provider or id is required")
	}
	index, err := strconv.Atoi(strings.TrimSpace(c.Query("index")))
	if err != nil || index < 0 {
		return providerAPIKeyTarget{}, errors.New("index is required")
	}
	keyIndex := -1
	if provider == providerAPIKeyOpenAICompatible {
		rawKeyIndex := firstNonEmpty(c.Query("key_index"), c.Query("key-index"))
		if rawKeyIndex == "" {
			return providerAPIKeyTarget{}, errors.New("key_index is required for openai-compatible providers")
		}
		keyIndex, err = strconv.Atoi(rawKeyIndex)
		if err != nil || keyIndex < 0 {
			return providerAPIKeyTarget{}, errors.New("key_index is invalid")
		}
	}
	return providerAPIKeyTarget{Provider: provider, Index: index, KeyIndex: keyIndex}, nil
}

func parseProviderAPIKeyID(id string) (providerAPIKeyTarget, error) {
	parts := strings.Split(strings.TrimSpace(id), ":")
	if len(parts) != 2 && len(parts) != 3 {
		return providerAPIKeyTarget{}, errors.New("invalid id")
	}
	provider, ok := normalizeAPIKeyProvider(parts[0])
	if !ok {
		return providerAPIKeyTarget{}, errors.New("unsupported provider")
	}
	index, err := strconv.Atoi(parts[1])
	if err != nil || index < 0 {
		return providerAPIKeyTarget{}, errors.New("invalid id")
	}
	keyIndex := -1
	if provider == providerAPIKeyOpenAICompatible {
		if len(parts) != 3 {
			return providerAPIKeyTarget{}, errors.New("invalid id")
		}
		keyIndex, err = strconv.Atoi(parts[2])
		if err != nil || keyIndex < 0 {
			return providerAPIKeyTarget{}, errors.New("invalid id")
		}
	} else if len(parts) == 3 {
		return providerAPIKeyTarget{}, errors.New("invalid id")
	}
	return providerAPIKeyTarget{Provider: provider, Index: index, KeyIndex: keyIndex}, nil
}

func providerAPIKeyID(provider string, index, keyIndex int) string {
	if provider == providerAPIKeyOpenAICompatible {
		return fmt.Sprintf("%s:%d:%d", provider, index, keyIndex)
	}
	return fmt.Sprintf("%s:%d", provider, index)
}

func normalizeAPIKeyProvider(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "gemini", "google":
		return providerAPIKeyGemini, true
	case "anthropic", "claude":
		return providerAPIKeyClaude, true
	case "codex":
		return providerAPIKeyCodex, true
	case "openai-compatible", "openai-compatibility", "openai_compatible", "openai_compatibility", "compat", "compatible":
		return providerAPIKeyOpenAICompatible, true
	case "vertex", "vertex-compatible", "vertex_compatible":
		return providerAPIKeyVertex, true
	default:
		return "", false
	}
}

func (r providerAPIKeyRequest) apiKeyValue() (string, bool) {
	return firstPresentString(r.APIKey, r.APIKeyHyphen, r.APIKeyCamel, r.Key)
}

func (r providerAPIKeyRequest) prefixValue() (string, bool) {
	return firstPresentString(r.Prefix)
}

func (r providerAPIKeyRequest) baseURLValue() (string, bool) {
	return firstPresentString(r.BaseURL, r.BaseURLHyphen, r.BaseURLCamel)
}

func (r providerAPIKeyRequest) proxyURLValue() (string, bool) {
	return firstPresentString(r.ProxyURL, r.ProxyURLHyphen, r.ProxyURLCamel)
}

func (r providerAPIKeyRequest) headersValue() (map[string]string, bool) {
	if r.Headers == nil {
		return nil, false
	}
	return *r.Headers, true
}

func (r providerAPIKeyRequest) modelsValue() ([]providerAPIKeyModel, bool) {
	if r.Models == nil {
		return nil, false
	}
	return normalizeProviderAPIKeyModels(*r.Models), true
}

func (r providerAPIKeyRequest) excludedModelsValue() ([]string, bool) {
	if r.ExcludedModels != nil {
		return *r.ExcludedModels, true
	}
	if r.ExcludedModelsHyphen != nil {
		return *r.ExcludedModelsHyphen, true
	}
	if r.ExcludedModelsCamel != nil {
		return *r.ExcludedModelsCamel, true
	}
	return nil, false
}

func (r providerAPIKeyRequest) priorityValue() int {
	if r.Priority == nil {
		return 0
	}
	return *r.Priority
}

func firstPresentString(values ...*string) (string, bool) {
	for _, value := range values {
		if value != nil {
			return *value, true
		}
	}
	return "", false
}

func normalizeProviderAPIKeyHeaders(headers map[string]string) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	out := make(map[string]string, len(headers))
	for key, value := range headers {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		out[key] = strings.TrimSpace(value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeProviderAPIKeyStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeProviderAPIKeyModels(models []providerAPIKeyModel) []providerAPIKeyModel {
	if len(models) == 0 {
		return nil
	}
	out := make([]providerAPIKeyModel, 0, len(models))
	for _, model := range models {
		name := strings.TrimSpace(model.Name)
		alias := strings.TrimSpace(model.Alias)
		if name == "" || alias == "" {
			continue
		}
		out = append(out, providerAPIKeyModel{Name: name, Alias: alias})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeOpenAICompatibleProviderKeys(cfg *sdkconfig.Config) {
	if cfg == nil {
		return
	}
	for i := range cfg.OpenAICompatibility {
		cfg.OpenAICompatibility[i].Name = normalizeOpenAICompatibilityProviderName(cfg.OpenAICompatibility[i].Name)
		entries := cfg.OpenAICompatibility[i].APIKeyEntries
		out := entries[:0]
		for _, entry := range entries {
			entry.APIKey = strings.TrimSpace(entry.APIKey)
			entry.ProxyURL = strings.TrimSpace(entry.ProxyURL)
			if entry.APIKey == "" {
				continue
			}
			out = append(out, entry)
		}
		cfg.OpenAICompatibility[i].APIKeyEntries = out
	}
}

func providerModelList(models any) []providerAPIKeyModel {
	value := reflect.ValueOf(models)
	if !value.IsValid() || value.Kind() != reflect.Slice || value.Len() == 0 {
		return nil
	}
	out := make([]providerAPIKeyModel, 0, value.Len())
	for i := 0; i < value.Len(); i++ {
		item := value.Index(i)
		if item.Kind() == reflect.Pointer {
			item = item.Elem()
		}
		if !item.IsValid() || item.Kind() != reflect.Struct {
			continue
		}
		nameField := item.FieldByName("Name")
		aliasField := item.FieldByName("Alias")
		if !nameField.IsValid() || !aliasField.IsValid() || nameField.Kind() != reflect.String || aliasField.Kind() != reflect.String {
			continue
		}
		name := strings.TrimSpace(nameField.String())
		alias := strings.TrimSpace(aliasField.String())
		if name == "" || alias == "" {
			continue
		}
		out = append(out, providerAPIKeyModel{Name: name, Alias: alias})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func applyProviderModelList(entry any, models []providerAPIKeyModel) {
	value := reflect.ValueOf(entry)
	if !value.IsValid() || value.Kind() != reflect.Pointer || value.IsNil() {
		return
	}
	elem := value.Elem()
	if elem.Kind() != reflect.Struct {
		return
	}
	field := elem.FieldByName("Models")
	if !field.IsValid() || !field.CanSet() || field.Kind() != reflect.Slice {
		return
	}
	models = normalizeProviderAPIKeyModels(models)
	slice := reflect.MakeSlice(field.Type(), 0, len(models))
	for _, model := range models {
		item := reflect.New(field.Type().Elem()).Elem()
		nameField := item.FieldByName("Name")
		aliasField := item.FieldByName("Alias")
		if !nameField.IsValid() || !aliasField.IsValid() || !nameField.CanSet() || !aliasField.CanSet() || nameField.Kind() != reflect.String || aliasField.Kind() != reflect.String {
			continue
		}
		nameField.SetString(model.Name)
		aliasField.SetString(model.Alias)
		slice = reflect.Append(slice, item)
	}
	field.Set(slice)
}

func providerHeaderNames(headers map[string]string) []string {
	if len(headers) == 0 {
		return nil
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		name = strings.TrimSpace(name)
		if name != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return nil
	}
	return names
}

func maskProviderAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "..." + key[len(key)-4:]
}

func defaultProviderAPIKeyBaseURL(provider string) string {
	switch provider {
	case providerAPIKeyClaude:
		return "https://api.anthropic.com"
	case providerAPIKeyGemini:
		return "https://generativelanguage.googleapis.com"
	case providerAPIKeyCodex:
		return "https://api.openai.com/v1"
	default:
		return ""
	}
}

func fetchProviderAPIKeyModelIDs(ctx context.Context, provider, baseURL, apiKey, proxyURL string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, providerAPIKeyModelsTimeout)
	defer cancel()

	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" {
		return nil, errors.New("base_url is required")
	}
	if apiKey == "" {
		return nil, errors.New("api_key is required")
	}

	requestURL := ""
	headers := make(http.Header)
	switch provider {
	case providerAPIKeyClaude:
		requestURL = baseURL + "/v1/models"
		headers.Set("x-api-key", apiKey)
		headers.Set("anthropic-version", "2023-06-01")
	case providerAPIKeyGemini:
		u, err := url.Parse(baseURL + "/v1beta/models")
		if err != nil {
			return nil, err
		}
		query := u.Query()
		query.Set("key", apiKey)
		u.RawQuery = query.Encode()
		requestURL = u.String()
	case providerAPIKeyCodex, providerAPIKeyOpenAICompatible, providerAPIKeyVertex:
		requestURL = baseURL + "/models"
		headers.Set("Authorization", "Bearer "+apiKey)
	default:
		return nil, errors.New("unsupported provider")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	for name, values := range headers {
		for _, value := range values {
			httpReq.Header.Add(name, value)
		}
	}

	client, err := providerModelFetchHTTPClient(proxyURL)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		message := strings.TrimSpace(string(body))
		if message != "" {
			return nil, fmt.Errorf("upstream %d %s: %s", resp.StatusCode, resp.Status, message)
		}
		return nil, fmt.Errorf("upstream %d %s", resp.StatusCode, resp.Status)
	}

	var ids []string
	if provider == providerAPIKeyGemini {
		var payload struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, err
		}
		for _, model := range payload.Models {
			name := strings.TrimSpace(strings.TrimPrefix(model.Name, "models/"))
			if name != "" {
				ids = append(ids, name)
			}
		}
	} else {
		var payload struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, err
		}
		for _, model := range payload.Data {
			id := strings.TrimSpace(model.ID)
			if id != "" {
				ids = append(ids, id)
			}
		}
	}

	sort.Strings(ids)
	if len(ids) == 0 {
		return nil, errors.New("upstream returned an empty model list")
	}
	return ids, nil
}

func providerModelFetchHTTPClient(proxyURL string) (*http.Client, error) {
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" {
		return http.DefaultClient, nil
	}
	transport, _, err := proxyutil.BuildHTTPTransport(proxyURL)
	if err != nil {
		return nil, err
	}
	if transport == nil {
		return http.DefaultClient, nil
	}
	return &http.Client{Transport: transport}, nil
}

type providerAPIKeyMutationError struct {
	StatusCode int
	Message    string
}

func (e *providerAPIKeyMutationError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func writeProviderAPIKeyMutationError(c *gin.Context, err error) {
	if err == nil {
		return
	}
	if mutationErr, ok := err.(*providerAPIKeyMutationError); ok {
		status := mutationErr.StatusCode
		if status == 0 {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": firstNonEmpty(mutationErr.Message, "provider api key request failed")})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
}

func writeProviderAPIKeyConfigError(c *gin.Context, err error) {
	if errors.Is(err, errProviderConfigNotConfigured) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": errProviderConfigNotConfigured.Error()})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update provider api key config"})
}
