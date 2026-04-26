package provider

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
)

type openAICompatibilityProviderRequest struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	OriginalName string `json:"original_name"`

	APIKey       *string `json:"api_key"`
	APIKeyHyphen *string `json:"api-key"`
	APIKeyCamel  *string `json:"apiKey"`
	Key          *string `json:"key"`

	APIKeyEntries       *[]openAICompatibilityAPIKeyRequest `json:"api_key_entries"`
	APIKeyEntriesHyphen *[]openAICompatibilityAPIKeyRequest `json:"api-key-entries"`
	APIKeyEntriesCamel  *[]openAICompatibilityAPIKeyRequest `json:"apiKeyEntries"`

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
}

type openAICompatibilityAPIKeyRequest struct {
	Index *int `json:"index"`

	APIKey       *string `json:"api_key"`
	APIKeyHyphen *string `json:"api-key"`
	APIKeyCamel  *string `json:"apiKey"`
	Key          *string `json:"key"`

	ProxyURL       *string `json:"proxy_url"`
	ProxyURLHyphen *string `json:"proxy-url"`
	ProxyURLCamel  *string `json:"proxyURL"`
}

type openAICompatibilityAPIKeyResponse struct {
	Index         int    `json:"index"`
	HasAPIKey     bool   `json:"has_api_key"`
	APIKeyPreview string `json:"api_key_preview,omitempty"`
	ProxyURL      string `json:"proxy_url,omitempty"`
}

type openAICompatibilityProviderResponse struct {
	ID            string                              `json:"id"`
	Name          string                              `json:"name"`
	Index         int                                 `json:"index"`
	HasAPIKey     bool                                `json:"has_api_key"`
	APIKeyPreview string                              `json:"api_key_preview,omitempty"`
	Prefix        string                              `json:"prefix,omitempty"`
	BaseURL       string                              `json:"base_url,omitempty"`
	ProxyURL      string                              `json:"proxy_url,omitempty"`
	Priority      int                                 `json:"priority,omitempty"`
	Models        []providerAPIKeyModel               `json:"models,omitempty"`
	Headers       []string                            `json:"headers,omitempty"`
	APIKeyEntries []openAICompatibilityAPIKeyResponse `json:"api_key_entries,omitempty"`
}

type openAICompatibilityProviderTarget struct {
	Name  string
	Index int
}

func (h *Handlers) listOpenAICompatibilityProviders(c *gin.Context) {
	filter := strings.TrimSpace(firstNonEmpty(c.Query("name"), c.Query("id")))

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}

	items := openAICompatibilityProviderItems(cfg)
	if filter != "" {
		filtered := items[:0]
		for _, item := range items {
			if item.Name == filter || item.ID == filter {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	c.JSON(http.StatusOK, gin.H{"providers": items})
}

func (h *Handlers) getOpenAICompatibilityProvider(c *gin.Context) {
	target, err := openAICompatibilityProviderTargetFromRequest(c, "")
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
	item, ok := openAICompatibilityProviderItemByTarget(cfg, target)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "openai compatibility provider not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) createOpenAICompatibilityProvider(c *gin.Context) {
	req, ok := bindOpenAICompatibilityProviderRequest(c)
	if !ok {
		return
	}

	name := normalizeOpenAICompatibilityProviderName(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	baseURL, _ := req.baseURLValue()
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_url is required"})
		return
	}
	entries := req.normalizedAPIKeyEntries()
	if len(entries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api_key is required"})
		return
	}
	models, _ := req.modelsValue()
	compatModels := openAICompatibilityModels(models)
	if len(compatModels) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "models are required for openai compatibility providers"})
		return
	}

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := h.loadProviderConfigLocked()
	if err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}
	if _, ok := openAICompatibilityProviderIndexByName(cfg, name); ok {
		c.JSON(http.StatusConflict, gin.H{"error": "openai compatibility provider already exists"})
		return
	}

	entry := sdkconfig.OpenAICompatibility{
		Name:          name,
		BaseURL:       baseURL,
		APIKeyEntries: entries,
		Priority:      req.priorityValue(),
		Models:        compatModels,
	}
	if prefix, ok := req.prefixValue(); ok {
		entry.Prefix = strings.TrimSpace(prefix)
	}
	if headers, ok := req.headersValue(); ok {
		entry.Headers = normalizeProviderAPIKeyHeaders(headers)
	}
	normalizeOpenAICompatibilityProviderEntry(&entry)
	cfg.OpenAICompatibility = append(cfg.OpenAICompatibility, entry)
	normalizeOpenAICompatibleProviderKeys(cfg)
	cfg.SanitizeOpenAICompatibility()

	if err := h.saveProviderConfigLocked(cfg); err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}

	item, ok := openAICompatibilityProviderItemByTarget(cfg, openAICompatibilityProviderTarget{Name: name})
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load created openai compatibility provider"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handlers) patchOpenAICompatibilityProvider(c *gin.Context) {
	req, ok := bindOpenAICompatibilityProviderRequest(c)
	if !ok {
		return
	}
	target, err := openAICompatibilityProviderTargetFromRequest(c, firstNonEmpty(req.OriginalName, req.ID))
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
	index, ok := openAICompatibilityProviderIndexByTarget(cfg, target)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "openai compatibility provider not found"})
		return
	}

	entry := cfg.OpenAICompatibility[index]
	nextName := normalizeOpenAICompatibilityProviderName(req.Name)
	if nextName != "" && nextName != entry.Name {
		if existing, ok := openAICompatibilityProviderIndexByName(cfg, nextName); ok && existing != index {
			c.JSON(http.StatusConflict, gin.H{"error": "openai compatibility provider already exists"})
			return
		}
		entry.Name = nextName
	}
	if prefix, ok := req.prefixValue(); ok {
		entry.Prefix = strings.TrimSpace(prefix)
	}
	if baseURL, ok := req.baseURLValue(); ok {
		baseURL = strings.TrimSpace(baseURL)
		if baseURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "base_url is required"})
			return
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
		entry.Models = openAICompatibilityModels(models)
	}

	if entries, ok := req.apiKeyEntriesValue(); ok {
		normalized := normalizeOpenAICompatibilityAPIKeyPatchRequests(entries, entry.APIKeyEntries)
		if len(normalized) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "api_key_entries cannot be empty"})
			return
		}
		entry.APIKeyEntries = normalized
	} else if apiKey, ok := req.apiKeyValue(); ok {
		apiKey = strings.TrimSpace(apiKey)
		if apiKey != "" {
			proxyURL, _ := req.proxyURLValue()
			entry.APIKeyEntries = []sdkconfig.OpenAICompatibilityAPIKey{{
				APIKey:   apiKey,
				ProxyURL: strings.TrimSpace(proxyURL),
			}}
		} else if proxyURL, ok := req.proxyURLValue(); ok {
			entry.APIKeyEntries = openAICompatibilityProviderEntriesWithProxy(entry.APIKeyEntries, proxyURL)
		}
	} else if proxyURL, ok := req.proxyURLValue(); ok {
		entry.APIKeyEntries = openAICompatibilityProviderEntriesWithProxy(entry.APIKeyEntries, proxyURL)
	}

	if strings.TrimSpace(entry.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if strings.TrimSpace(entry.BaseURL) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_url is required"})
		return
	}
	if len(providerModelList(entry.Models)) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "models are required for openai compatibility providers"})
		return
	}

	normalizeOpenAICompatibilityProviderEntry(&entry)
	cfg.OpenAICompatibility[index] = entry
	normalizeOpenAICompatibleProviderKeys(cfg)
	cfg.SanitizeOpenAICompatibility()

	if err := h.saveProviderConfigLocked(cfg); err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}

	item, ok := openAICompatibilityProviderItemByTarget(cfg, openAICompatibilityProviderTarget{Name: entry.Name})
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load updated openai compatibility provider"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) deleteOpenAICompatibilityProvider(c *gin.Context) {
	target, err := openAICompatibilityProviderTargetFromRequest(c, "")
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
	index, ok := openAICompatibilityProviderIndexByTarget(cfg, target)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "openai compatibility provider not found"})
		return
	}
	cfg.OpenAICompatibility = append(cfg.OpenAICompatibility[:index], cfg.OpenAICompatibility[index+1:]...)
	cfg.SanitizeOpenAICompatibility()
	if err := h.saveProviderConfigLocked(cfg); err != nil {
		writeProviderAPIKeyConfigError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handlers) fetchOpenAICompatibilityProviderModels(c *gin.Context) {
	req, ok := bindOpenAICompatibilityProviderRequest(c)
	if !ok {
		return
	}

	apiKey, _ := req.apiKeyValue()
	apiKey = strings.TrimSpace(apiKey)
	baseURL, _ := req.baseURLValue()
	baseURL = strings.TrimSpace(baseURL)
	proxyURL, hasProxyURL := req.proxyURLValue()
	proxyURL = strings.TrimSpace(proxyURL)
	targetName := normalizeOpenAICompatibilityProviderName(firstNonEmpty(req.OriginalName, req.ID, req.Name))

	if targetName != "" && (apiKey == "" || baseURL == "") {
		h.configMu.Lock()
		cfg, err := h.loadProviderConfigLocked()
		if err != nil {
			h.configMu.Unlock()
			writeProviderAPIKeyConfigError(c, err)
			return
		}
		index, found := openAICompatibilityProviderIndexByTarget(cfg, openAICompatibilityProviderTarget{Name: targetName})
		if found {
			entry := cfg.OpenAICompatibility[index]
			if baseURL == "" {
				baseURL = strings.TrimSpace(entry.BaseURL)
			}
			if apiKey == "" {
				apiKey = firstOpenAICompatibilityProviderAPIKey(entry)
			}
			if !hasProxyURL {
				proxyURL = firstOpenAICompatibilityProviderProxyURL(entry)
			}
		}
		h.configMu.Unlock()
		if !found {
			c.JSON(http.StatusNotFound, gin.H{"error": "openai compatibility provider not found"})
			return
		}
	}

	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api_key is required"})
		return
	}
	if baseURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_url is required"})
		return
	}

	proxyURL = h.providerModelFetchProxyURL(proxyURL)
	ids, err := fetchProviderAPIKeyModelIDs(c.Request.Context(), providerAPIKeyOpenAICompatible, baseURL, apiKey, proxyURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ids": ids})
}

func bindOpenAICompatibilityProviderRequest(c *gin.Context) (openAICompatibilityProviderRequest, bool) {
	var req openAICompatibilityProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return openAICompatibilityProviderRequest{}, false
	}
	return req, true
}

func openAICompatibilityProviderTargetFromRequest(c *gin.Context, bodyID string) (openAICompatibilityProviderTarget, error) {
	if indexRaw := strings.TrimSpace(c.Query("index")); indexRaw != "" {
		index, err := strconv.Atoi(indexRaw)
		if err != nil || index < 0 {
			return openAICompatibilityProviderTarget{}, errors.New("index is invalid")
		}
		return openAICompatibilityProviderTarget{Index: index}, nil
	}
	name := normalizeOpenAICompatibilityProviderName(firstNonEmpty(c.Param("name"), c.Query("name"), c.Query("id"), bodyID))
	if name == "" {
		return openAICompatibilityProviderTarget{}, errors.New("name or id is required")
	}
	return openAICompatibilityProviderTarget{Name: name, Index: -1}, nil
}

func openAICompatibilityProviderIndexByTarget(cfg *sdkconfig.Config, target openAICompatibilityProviderTarget) (int, bool) {
	if cfg == nil {
		return -1, false
	}
	if strings.TrimSpace(target.Name) != "" {
		return openAICompatibilityProviderIndexByName(cfg, target.Name)
	}
	if target.Index >= 0 {
		return target.Index, target.Index < len(cfg.OpenAICompatibility)
	}
	return -1, false
}

func openAICompatibilityProviderIndexByName(cfg *sdkconfig.Config, name string) (int, bool) {
	if cfg == nil {
		return -1, false
	}
	name = normalizeOpenAICompatibilityProviderName(name)
	for i := range cfg.OpenAICompatibility {
		if normalizeOpenAICompatibilityProviderName(cfg.OpenAICompatibility[i].Name) == name {
			return i, true
		}
	}
	return -1, false
}

func openAICompatibilityProviderItems(cfg *sdkconfig.Config) []openAICompatibilityProviderResponse {
	if cfg == nil {
		return nil
	}
	items := make([]openAICompatibilityProviderResponse, 0, len(cfg.OpenAICompatibility))
	for i, entry := range cfg.OpenAICompatibility {
		items = append(items, openAICompatibilityProviderResponseFromEntry(i, entry))
	}
	return items
}

func openAICompatibilityProviderItemByTarget(cfg *sdkconfig.Config, target openAICompatibilityProviderTarget) (openAICompatibilityProviderResponse, bool) {
	index, ok := openAICompatibilityProviderIndexByTarget(cfg, target)
	if !ok {
		return openAICompatibilityProviderResponse{}, false
	}
	return openAICompatibilityProviderResponseFromEntry(index, cfg.OpenAICompatibility[index]), true
}

func openAICompatibilityProviderResponseFromEntry(index int, entry sdkconfig.OpenAICompatibility) openAICompatibilityProviderResponse {
	keyEntries := make([]openAICompatibilityAPIKeyResponse, 0, len(entry.APIKeyEntries))
	for i, keyEntry := range entry.APIKeyEntries {
		keyEntries = append(keyEntries, openAICompatibilityAPIKeyResponse{
			Index:         i,
			HasAPIKey:     strings.TrimSpace(keyEntry.APIKey) != "",
			APIKeyPreview: maskProviderAPIKey(keyEntry.APIKey),
			ProxyURL:      strings.TrimSpace(keyEntry.ProxyURL),
		})
	}
	firstPreview := ""
	firstProxy := ""
	hasAPIKey := false
	for _, keyEntry := range keyEntries {
		if keyEntry.HasAPIKey {
			hasAPIKey = true
			if firstPreview == "" {
				firstPreview = keyEntry.APIKeyPreview
				firstProxy = keyEntry.ProxyURL
			}
		}
	}
	name := normalizeOpenAICompatibilityProviderName(entry.Name)
	return openAICompatibilityProviderResponse{
		ID:            name,
		Name:          name,
		Index:         index,
		HasAPIKey:     hasAPIKey,
		APIKeyPreview: firstPreview,
		Prefix:        strings.TrimSpace(entry.Prefix),
		BaseURL:       strings.TrimSpace(entry.BaseURL),
		ProxyURL:      firstProxy,
		Priority:      entry.Priority,
		Models:        providerModelList(entry.Models),
		Headers:       providerHeaderNames(entry.Headers),
		APIKeyEntries: keyEntries,
	}
}

func (r openAICompatibilityProviderRequest) apiKeyValue() (string, bool) {
	return firstPresentString(r.APIKey, r.APIKeyHyphen, r.APIKeyCamel, r.Key)
}

func (r openAICompatibilityProviderRequest) apiKeyEntriesValue() ([]openAICompatibilityAPIKeyRequest, bool) {
	if r.APIKeyEntries != nil {
		return *r.APIKeyEntries, true
	}
	if r.APIKeyEntriesHyphen != nil {
		return *r.APIKeyEntriesHyphen, true
	}
	if r.APIKeyEntriesCamel != nil {
		return *r.APIKeyEntriesCamel, true
	}
	return nil, false
}

func (r openAICompatibilityProviderRequest) normalizedAPIKeyEntries() []sdkconfig.OpenAICompatibilityAPIKey {
	if entries, ok := r.apiKeyEntriesValue(); ok {
		return normalizeOpenAICompatibilityAPIKeyRequests(entries)
	}
	apiKey, ok := r.apiKeyValue()
	if !ok {
		return nil
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	proxyURL, _ := r.proxyURLValue()
	return []sdkconfig.OpenAICompatibilityAPIKey{{
		APIKey:   apiKey,
		ProxyURL: strings.TrimSpace(proxyURL),
	}}
}

func (r openAICompatibilityProviderRequest) prefixValue() (string, bool) {
	return firstPresentString(r.Prefix)
}

func (r openAICompatibilityProviderRequest) baseURLValue() (string, bool) {
	return firstPresentString(r.BaseURL, r.BaseURLHyphen, r.BaseURLCamel)
}

func (r openAICompatibilityProviderRequest) proxyURLValue() (string, bool) {
	return firstPresentString(r.ProxyURL, r.ProxyURLHyphen, r.ProxyURLCamel)
}

func (r openAICompatibilityProviderRequest) headersValue() (map[string]string, bool) {
	if r.Headers == nil {
		return nil, false
	}
	return *r.Headers, true
}

func (r openAICompatibilityProviderRequest) modelsValue() ([]providerAPIKeyModel, bool) {
	if r.Models == nil {
		return nil, false
	}
	return normalizeProviderAPIKeyModels(*r.Models), true
}

func (r openAICompatibilityProviderRequest) priorityValue() int {
	if r.Priority == nil {
		return 0
	}
	return *r.Priority
}

func (r openAICompatibilityAPIKeyRequest) apiKeyValue() (string, bool) {
	return firstPresentString(r.APIKey, r.APIKeyHyphen, r.APIKeyCamel, r.Key)
}

func (r openAICompatibilityAPIKeyRequest) proxyURLValue() (string, bool) {
	return firstPresentString(r.ProxyURL, r.ProxyURLHyphen, r.ProxyURLCamel)
}

func normalizeOpenAICompatibilityAPIKeyRequests(entries []openAICompatibilityAPIKeyRequest) []sdkconfig.OpenAICompatibilityAPIKey {
	if len(entries) == 0 {
		return nil
	}
	out := make([]sdkconfig.OpenAICompatibilityAPIKey, 0, len(entries))
	for _, entry := range entries {
		apiKey, _ := entry.apiKeyValue()
		apiKey = strings.TrimSpace(apiKey)
		if apiKey == "" {
			continue
		}
		proxyURL, _ := entry.proxyURLValue()
		out = append(out, sdkconfig.OpenAICompatibilityAPIKey{
			APIKey:   apiKey,
			ProxyURL: strings.TrimSpace(proxyURL),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeOpenAICompatibilityAPIKeyPatchRequests(entries []openAICompatibilityAPIKeyRequest, existing []sdkconfig.OpenAICompatibilityAPIKey) []sdkconfig.OpenAICompatibilityAPIKey {
	if len(entries) == 0 {
		return nil
	}
	out := make([]sdkconfig.OpenAICompatibilityAPIKey, 0, len(entries))
	for _, entry := range entries {
		apiKey, _ := entry.apiKeyValue()
		apiKey = strings.TrimSpace(apiKey)
		if apiKey == "" {
			apiKey = existingOpenAICompatibilityAPIKey(existing, entry.Index)
		}
		if apiKey == "" {
			continue
		}

		proxyURL, hasProxyURL := entry.proxyURLValue()
		if hasProxyURL {
			proxyURL = strings.TrimSpace(proxyURL)
		} else {
			proxyURL = existingOpenAICompatibilityProxyURL(existing, entry.Index)
		}
		out = append(out, sdkconfig.OpenAICompatibilityAPIKey{
			APIKey:   apiKey,
			ProxyURL: strings.TrimSpace(proxyURL),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func existingOpenAICompatibilityAPIKey(existing []sdkconfig.OpenAICompatibilityAPIKey, index *int) string {
	if index == nil || *index < 0 || *index >= len(existing) {
		return ""
	}
	return strings.TrimSpace(existing[*index].APIKey)
}

func existingOpenAICompatibilityProxyURL(existing []sdkconfig.OpenAICompatibilityAPIKey, index *int) string {
	if index == nil || *index < 0 || *index >= len(existing) {
		return ""
	}
	return strings.TrimSpace(existing[*index].ProxyURL)
}

func openAICompatibilityProviderEntriesWithProxy(entries []sdkconfig.OpenAICompatibilityAPIKey, proxyURL string) []sdkconfig.OpenAICompatibilityAPIKey {
	proxyURL = strings.TrimSpace(proxyURL)
	out := append([]sdkconfig.OpenAICompatibilityAPIKey(nil), entries...)
	for i := range out {
		out[i].ProxyURL = proxyURL
	}
	return out
}

func openAICompatibilityModels(models []providerAPIKeyModel) []sdkconfig.OpenAICompatibilityModel {
	models = normalizeProviderAPIKeyModels(models)
	if len(models) == 0 {
		return nil
	}
	out := make([]sdkconfig.OpenAICompatibilityModel, 0, len(models))
	for _, model := range models {
		out = append(out, sdkconfig.OpenAICompatibilityModel{Name: model.Name, Alias: model.Alias})
	}
	return out
}

func normalizeOpenAICompatibilityProviderEntry(entry *sdkconfig.OpenAICompatibility) {
	if entry == nil {
		return
	}
	entry.Name = normalizeOpenAICompatibilityProviderName(entry.Name)
	entry.Prefix = strings.TrimSpace(entry.Prefix)
	entry.BaseURL = strings.TrimSpace(entry.BaseURL)
	entry.Headers = normalizeProviderAPIKeyHeaders(entry.Headers)
	out := entry.APIKeyEntries[:0]
	for _, keyEntry := range entry.APIKeyEntries {
		keyEntry.APIKey = strings.TrimSpace(keyEntry.APIKey)
		keyEntry.ProxyURL = strings.TrimSpace(keyEntry.ProxyURL)
		if keyEntry.APIKey == "" {
			continue
		}
		out = append(out, keyEntry)
	}
	entry.APIKeyEntries = out
}

func normalizeOpenAICompatibilityProviderName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func firstOpenAICompatibilityProviderAPIKey(entry sdkconfig.OpenAICompatibility) string {
	for _, keyEntry := range entry.APIKeyEntries {
		if apiKey := strings.TrimSpace(keyEntry.APIKey); apiKey != "" {
			return apiKey
		}
	}
	return ""
}

func firstOpenAICompatibilityProviderProxyURL(entry sdkconfig.OpenAICompatibility) string {
	for _, keyEntry := range entry.APIKeyEntries {
		if strings.TrimSpace(keyEntry.APIKey) != "" {
			return strings.TrimSpace(keyEntry.ProxyURL)
		}
	}
	return ""
}
