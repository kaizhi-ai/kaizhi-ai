package provider

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
)

const providerAPIKeyTestPath = "/api/v1/api-key-provider"
const openAICompatibilityProviderTestPath = "/api/v1/openai-compatibility-provider"

func TestProviderAPIKeyCreateListAndDeleteGemini(t *testing.T) {
	router, configPath := newProviderAPIKeyTestRouter(t)
	rawKey := "AIza-test-secret-0001"

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath, map[string]any{
		"provider":  "gemini",
		"api_key":   rawKey,
		"prefix":    "google",
		"base_url":  "https://generativelanguage.googleapis.com",
		"proxy_url": "socks5://127.0.0.1:1080",
		"models": []map[string]string{
			{"name": "gemini-2.5-pro", "alias": "google/gemini-pro"},
		},
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}
	if strings.Contains(createResp.Body.String(), rawKey) {
		t.Fatalf("create response leaked raw api key: %s", createResp.Body.String())
	}

	var created providerAPIKeyResponse
	decodeProviderAPIKeyJSON(t, createResp, &created)
	if created.ID != "gemini:0" || created.Provider != "gemini" || !created.HasAPIKey {
		t.Fatalf("created = %+v, want gemini:0 with key", created)
	}
	if created.APIKeyPreview == "" || created.APIKeyPreview == rawKey {
		t.Fatalf("APIKeyPreview = %q, want masked preview", created.APIKeyPreview)
	}

	cfg := loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.GeminiKey) != 1 {
		t.Fatalf("len(GeminiKey) = %d, want 1", len(cfg.GeminiKey))
	}
	if cfg.GeminiKey[0].APIKey != rawKey {
		t.Fatalf("stored Gemini APIKey = %q, want raw key", cfg.GeminiKey[0].APIKey)
	}

	listResp := doProviderAPIKeyJSON(t, router, http.MethodGet, providerAPIKeyTestPath+"?provider=gemini", nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s, want 200", listResp.Code, listResp.Body.String())
	}
	if strings.Contains(listResp.Body.String(), rawKey) {
		t.Fatalf("list response leaked raw api key: %s", listResp.Body.String())
	}
	var listed struct {
		Keys []providerAPIKeyResponse `json:"keys"`
	}
	decodeProviderAPIKeyJSON(t, listResp, &listed)
	if len(listed.Keys) != 1 || listed.Keys[0].ID != created.ID {
		t.Fatalf("listed keys = %+v, want created key", listed.Keys)
	}
	if len(listed.Keys[0].Models) != 1 || listed.Keys[0].Models[0].Alias != "google/gemini-pro" {
		t.Fatalf("models = %+v, want alias google/gemini-pro", listed.Keys[0].Models)
	}

	deleteResp := doProviderAPIKeyJSON(t, router, http.MethodDelete, providerAPIKeyTestPath+"/"+created.ID, nil)
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s, want 204", deleteResp.Code, deleteResp.Body.String())
	}
	cfg = loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.GeminiKey) != 0 {
		t.Fatalf("len(GeminiKey) after delete = %d, want 0", len(cfg.GeminiKey))
	}
}

func TestProviderAPIKeyOpenAICompatiblePatch(t *testing.T) {
	router, configPath := newProviderAPIKeyTestRouter(t)
	rawKey := "sk-or-v1-secret-0001"
	nextKey := "sk-or-v1-secret-0002"

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath, map[string]any{
		"provider": "openai-compatible",
		"name":     "OpenRouter",
		"api_key":  rawKey,
		"base_url": "https://openrouter.ai/api/v1",
		"models": []map[string]string{
			{"name": "anthropic/claude-sonnet-4.5", "alias": "openrouter/sonnet"},
		},
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}
	if strings.Contains(createResp.Body.String(), rawKey) {
		t.Fatalf("create response leaked raw api key: %s", createResp.Body.String())
	}

	var created providerAPIKeyResponse
	decodeProviderAPIKeyJSON(t, createResp, &created)
	if created.ID != "openai-compatible:0:0" || created.Name != "openrouter" {
		t.Fatalf("created = %+v, want openai-compatible openrouter key", created)
	}

	duplicateResp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath, map[string]any{
		"provider": "openai-compatible",
		"name":     "openrouter",
		"api_key":  "sk-or-v1-secret-duplicate",
		"base_url": "https://openrouter.ai/api/v2",
	})
	if duplicateResp.Code != http.StatusConflict {
		t.Fatalf("duplicate create status = %d, body = %s, want 409", duplicateResp.Code, duplicateResp.Body.String())
	}

	patchResp := doProviderAPIKeyJSON(t, router, http.MethodPatch, providerAPIKeyTestPath+"/"+created.ID, map[string]any{
		"api_key":   nextKey,
		"name":      "OpenRouterRenamed",
		"proxy_url": "socks5://127.0.0.1:1080",
	})
	if patchResp.Code != http.StatusOK {
		t.Fatalf("patch status = %d, body = %s, want 200", patchResp.Code, patchResp.Body.String())
	}
	if strings.Contains(patchResp.Body.String(), nextKey) {
		t.Fatalf("patch response leaked raw api key: %s", patchResp.Body.String())
	}

	cfg := loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.OpenAICompatibility) != 1 {
		t.Fatalf("len(OpenAICompatibility) = %d, want 1", len(cfg.OpenAICompatibility))
	}
	entry := cfg.OpenAICompatibility[0]
	if entry.Name != "openrouterrenamed" || entry.BaseURL != "https://openrouter.ai/api/v1" {
		t.Fatalf("openai-compatible entry = %+v, want lower-case renamed base URL", entry)
	}
	if len(entry.APIKeyEntries) != 1 {
		t.Fatalf("len(APIKeyEntries) = %d, want 1", len(entry.APIKeyEntries))
	}
	if entry.APIKeyEntries[0].APIKey != nextKey {
		t.Fatalf("stored OpenAI-compatible APIKey = %q, want patched key", entry.APIKeyEntries[0].APIKey)
	}
	if entry.APIKeyEntries[0].ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("stored ProxyURL = %q, want patched proxy", entry.APIKeyEntries[0].ProxyURL)
	}
}

func TestProviderAPIKeyOpenAICompatibleRequiresBaseURL(t *testing.T) {
	router, _ := newProviderAPIKeyTestRouter(t)

	resp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath, map[string]any{
		"provider": "openai-compatible",
		"name":     "openrouter",
		"api_key":  "sk-or-v1-secret-0001",
	})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s, want 400", resp.Code, resp.Body.String())
	}
}

func TestProviderAPIKeyFetchModelsUsesStoredKey(t *testing.T) {
	router, _ := newProviderAPIKeyTestRouter(t)
	rawKey := "sk-test-secret-0001"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			t.Fatalf("upstream path = %q, want /models", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+rawKey {
			t.Fatalf("Authorization = %q, want bearer key", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model"}]}`))
	}))
	defer upstream.Close()

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath, map[string]any{
		"provider": "codex",
		"api_key":  rawKey,
		"base_url": upstream.URL,
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}
	var created providerAPIKeyResponse
	decodeProviderAPIKeyJSON(t, createResp, &created)

	modelsResp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath+"/models", map[string]any{
		"id": created.ID,
	})
	if modelsResp.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s, want 200", modelsResp.Code, modelsResp.Body.String())
	}
	var listed struct {
		IDs []string `json:"ids"`
	}
	decodeProviderAPIKeyJSON(t, modelsResp, &listed)
	if len(listed.IDs) != 2 || listed.IDs[0] != "a-model" || listed.IDs[1] != "z-model" {
		t.Fatalf("ids = %+v, want sorted upstream models", listed.IDs)
	}
}

func TestProviderAPIKeyFetchModelsUsesStoredProxyURL(t *testing.T) {
	router, _ := newProviderAPIKeyTestRouter(t)
	rawKey := "sk-test-secret-0001"
	proxy, hits := newProviderModelProxyServer(t, "codex-upstream.example", "/v1/models", "Bearer "+rawKey, `{"data":[{"id":"proxied-codex"}]}`)
	defer proxy.Close()

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath, map[string]any{
		"provider":  "codex",
		"api_key":   rawKey,
		"base_url":  "http://codex-upstream.example/v1",
		"proxy_url": proxy.URL,
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}
	var created providerAPIKeyResponse
	decodeProviderAPIKeyJSON(t, createResp, &created)

	modelsResp := doProviderAPIKeyJSON(t, router, http.MethodPost, providerAPIKeyTestPath+"/models", map[string]any{
		"id": created.ID,
	})
	if modelsResp.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s, want 200", modelsResp.Code, modelsResp.Body.String())
	}
	if got := hits.Load(); got != 1 {
		t.Fatalf("proxy hits = %d, want 1", got)
	}
	var listed struct {
		IDs []string `json:"ids"`
	}
	decodeProviderAPIKeyJSON(t, modelsResp, &listed)
	if len(listed.IDs) != 1 || listed.IDs[0] != "proxied-codex" {
		t.Fatalf("ids = %+v, want proxied model", listed.IDs)
	}
}

func TestOpenAICompatibilityProviderCreateListPatchAndDelete(t *testing.T) {
	router, configPath := newProviderAPIKeyTestRouter(t)
	rawKey := "sk-or-v1-secret-0001"

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":      "OpenRouter",
		"api_key":   rawKey,
		"prefix":    "or",
		"base_url":  "https://openrouter.ai/api/v1",
		"proxy_url": "socks5://127.0.0.1:1080",
		"priority":  3,
		"headers": map[string]string{
			"HTTP-Referer": "https://example.com",
		},
		"models": []map[string]string{
			{"name": "anthropic/claude-sonnet-4.5", "alias": "openrouter/sonnet"},
		},
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}
	if strings.Contains(createResp.Body.String(), rawKey) {
		t.Fatalf("create response leaked raw api key: %s", createResp.Body.String())
	}

	var created openAICompatibilityProviderResponse
	decodeProviderAPIKeyJSON(t, createResp, &created)
	if created.ID != "openrouter" || created.Name != "openrouter" || !created.HasAPIKey {
		t.Fatalf("created = %+v, want openrouter provider with key", created)
	}
	if created.APIKeyPreview == "" || created.APIKeyPreview == rawKey {
		t.Fatalf("APIKeyPreview = %q, want masked preview", created.APIKeyPreview)
	}
	if len(created.APIKeyEntries) != 1 || created.APIKeyEntries[0].ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("api key entries = %+v, want one proxied entry", created.APIKeyEntries)
	}

	cfg := loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.OpenAICompatibility) != 1 {
		t.Fatalf("len(OpenAICompatibility) = %d, want 1", len(cfg.OpenAICompatibility))
	}
	entry := cfg.OpenAICompatibility[0]
	if entry.Name != "openrouter" || entry.BaseURL != "https://openrouter.ai/api/v1" || entry.Prefix != "or" || entry.Priority != 3 {
		t.Fatalf("openai compatibility entry = %+v, want stored provider fields", entry)
	}
	if len(entry.APIKeyEntries) != 1 || entry.APIKeyEntries[0].APIKey != rawKey {
		t.Fatalf("stored APIKeyEntries = %+v, want raw key stored", entry.APIKeyEntries)
	}
	if len(entry.Models) != 1 || entry.Models[0].Alias != "openrouter/sonnet" {
		t.Fatalf("stored models = %+v, want openrouter/sonnet alias", entry.Models)
	}
	if entry.Headers["HTTP-Referer"] != "https://example.com" {
		t.Fatalf("stored headers = %+v, want HTTP-Referer", entry.Headers)
	}

	listResp := doProviderAPIKeyJSON(t, router, http.MethodGet, openAICompatibilityProviderTestPath, nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s, want 200", listResp.Code, listResp.Body.String())
	}
	if strings.Contains(listResp.Body.String(), rawKey) {
		t.Fatalf("list response leaked raw api key: %s", listResp.Body.String())
	}
	var listed struct {
		Providers []openAICompatibilityProviderResponse `json:"providers"`
	}
	decodeProviderAPIKeyJSON(t, listResp, &listed)
	if len(listed.Providers) != 1 || listed.Providers[0].Name != "openrouter" {
		t.Fatalf("providers = %+v, want openrouter", listed.Providers)
	}

	patchResp := doProviderAPIKeyJSON(t, router, http.MethodPatch, openAICompatibilityProviderTestPath+"/openrouter", map[string]any{
		"name":      "OpenRouter-Renamed",
		"api_key":   "",
		"base_url":  "https://openrouter.ai/api/v2",
		"proxy_url": "direct",
		"models": []map[string]string{
			{"name": "openai/gpt-5.1", "alias": "openrouter/gpt-5.1"},
		},
	})
	if patchResp.Code != http.StatusOK {
		t.Fatalf("patch status = %d, body = %s, want 200", patchResp.Code, patchResp.Body.String())
	}
	if strings.Contains(patchResp.Body.String(), rawKey) {
		t.Fatalf("patch response leaked raw api key: %s", patchResp.Body.String())
	}

	cfg = loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.OpenAICompatibility) != 1 {
		t.Fatalf("len(OpenAICompatibility) after patch = %d, want 1", len(cfg.OpenAICompatibility))
	}
	entry = cfg.OpenAICompatibility[0]
	if entry.Name != "openrouter-renamed" || entry.BaseURL != "https://openrouter.ai/api/v2" {
		t.Fatalf("patched entry = %+v, want renamed base URL", entry)
	}
	if len(entry.APIKeyEntries) != 1 || entry.APIKeyEntries[0].APIKey != rawKey {
		t.Fatalf("patched APIKeyEntries = %+v, want preserved raw key", entry.APIKeyEntries)
	}
	if entry.APIKeyEntries[0].ProxyURL != "direct" {
		t.Fatalf("patched ProxyURL = %q, want direct", entry.APIKeyEntries[0].ProxyURL)
	}
	if len(entry.Models) != 1 || entry.Models[0].Alias != "openrouter/gpt-5.1" {
		t.Fatalf("patched models = %+v, want openrouter/gpt-5.1", entry.Models)
	}

	deleteResp := doProviderAPIKeyJSON(t, router, http.MethodDelete, openAICompatibilityProviderTestPath+"/openrouter-renamed", nil)
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s, want 204", deleteResp.Code, deleteResp.Body.String())
	}
	cfg = loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.OpenAICompatibility) != 0 {
		t.Fatalf("len(OpenAICompatibility) after delete = %d, want 0", len(cfg.OpenAICompatibility))
	}
}

func TestOpenAICompatibilityProviderRequiresBaseURLAndUniqueName(t *testing.T) {
	router, configPath := newProviderAPIKeyTestRouter(t)

	resp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":    "openrouter",
		"api_key": "sk-or-v1-secret-0001",
	})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("missing base_url status = %d, body = %s, want 400", resp.Code, resp.Body.String())
	}

	resp = doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":     "OpenRouter",
		"api_key":  "sk-or-v1-secret-0001",
		"base_url": "https://openrouter.ai/api/v1",
	})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("missing models status = %d, body = %s, want 400", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "models are required") {
		t.Fatalf("body = %s, want models required error", resp.Body.String())
	}

	resp = doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":     "OpenRouter",
		"api_key":  "sk-or-v1-secret-0001",
		"base_url": "https://openrouter.ai/api/v1",
		"models": []map[string]string{
			{"name": "openai/gpt-5.1", "alias": "openrouter/gpt-5.1"},
		},
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("first create status = %d, body = %s, want 201", resp.Code, resp.Body.String())
	}
	cfg := loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.OpenAICompatibility) != 1 || cfg.OpenAICompatibility[0].Name != "openrouter" {
		t.Fatalf("stored providers = %+v, want lower-case openrouter", cfg.OpenAICompatibility)
	}
	resp = doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":     "openrouter",
		"api_key":  "sk-or-v1-secret-0002",
		"base_url": "https://openrouter.ai/api/v1",
		"models": []map[string]string{
			{"name": "openai/gpt-5.1", "alias": "openrouter/gpt-5.1"},
		},
	})
	if resp.Code != http.StatusConflict {
		t.Fatalf("duplicate create status = %d, body = %s, want 409", resp.Code, resp.Body.String())
	}
}

func TestOpenAICompatibilityProviderAPIKeyEntriesCreateAndPatch(t *testing.T) {
	router, configPath := newProviderAPIKeyTestRouter(t)
	firstKey := "sk-or-v1-secret-0001"
	secondKey := "sk-or-v1-secret-0002"
	thirdKey := "sk-or-v1-secret-0003"

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":     "OpenRouter",
		"base_url": "https://openrouter.ai/api/v1",
		"api_key_entries": []map[string]any{
			{"api_key": firstKey, "proxy_url": "http://proxy-a.local:8080"},
			{"api_key": secondKey, "proxy_url": "socks5://127.0.0.1:1080"},
		},
		"models": []map[string]string{
			{"name": "openai/gpt-5.1", "alias": "openrouter/gpt-5.1"},
		},
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}
	if strings.Contains(createResp.Body.String(), firstKey) || strings.Contains(createResp.Body.String(), secondKey) {
		t.Fatalf("create response leaked raw api keys: %s", createResp.Body.String())
	}
	var created openAICompatibilityProviderResponse
	decodeProviderAPIKeyJSON(t, createResp, &created)
	if len(created.APIKeyEntries) != 2 {
		t.Fatalf("created entries = %+v, want 2 entries", created.APIKeyEntries)
	}
	if created.APIKeyEntries[0].ProxyURL != "http://proxy-a.local:8080" || created.APIKeyEntries[1].ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("created entries = %+v, want per-key proxies", created.APIKeyEntries)
	}

	patchResp := doProviderAPIKeyJSON(t, router, http.MethodPatch, openAICompatibilityProviderTestPath+"/openrouter", map[string]any{
		"api_key_entries": []map[string]any{
			{"index": 0, "proxy_url": "direct"},
			{"index": 1, "proxy_url": "http://proxy-b.local:8080"},
			{"api_key": thirdKey, "proxy_url": "http://proxy-c.local:8080"},
		},
	})
	if patchResp.Code != http.StatusOK {
		t.Fatalf("patch status = %d, body = %s, want 200", patchResp.Code, patchResp.Body.String())
	}
	if strings.Contains(patchResp.Body.String(), firstKey) || strings.Contains(patchResp.Body.String(), secondKey) || strings.Contains(patchResp.Body.String(), thirdKey) {
		t.Fatalf("patch response leaked raw api keys: %s", patchResp.Body.String())
	}

	cfg := loadProviderAPIKeyTestConfig(t, configPath)
	if len(cfg.OpenAICompatibility) != 1 {
		t.Fatalf("len(OpenAICompatibility) = %d, want 1", len(cfg.OpenAICompatibility))
	}
	entries := cfg.OpenAICompatibility[0].APIKeyEntries
	if len(entries) != 3 {
		t.Fatalf("stored entries = %+v, want 3 entries", entries)
	}
	if entries[0].APIKey != firstKey || entries[0].ProxyURL != "direct" {
		t.Fatalf("entry 0 = %+v, want preserved first key with direct proxy", entries[0])
	}
	if entries[1].APIKey != secondKey || entries[1].ProxyURL != "http://proxy-b.local:8080" {
		t.Fatalf("entry 1 = %+v, want preserved second key with patched proxy", entries[1])
	}
	if entries[2].APIKey != thirdKey || entries[2].ProxyURL != "http://proxy-c.local:8080" {
		t.Fatalf("entry 2 = %+v, want new third key with proxy", entries[2])
	}
}

func TestOpenAICompatibilityProviderFetchModelsUsesStoredKey(t *testing.T) {
	router, _ := newProviderAPIKeyTestRouter(t)
	rawKey := "sk-or-v1-secret-0001"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			t.Fatalf("upstream path = %q, want /models", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+rawKey {
			t.Fatalf("Authorization = %q, want bearer key", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-openrouter"},{"id":"a-openrouter"}]}`))
	}))
	defer upstream.Close()

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":     "openrouter",
		"api_key":  rawKey,
		"base_url": upstream.URL,
		"models": []map[string]string{
			{"name": "a-openrouter", "alias": "a-openrouter"},
		},
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}

	modelsResp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath+"/models", map[string]any{
		"name": "openrouter",
	})
	if modelsResp.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s, want 200", modelsResp.Code, modelsResp.Body.String())
	}
	var listed struct {
		IDs []string `json:"ids"`
	}
	decodeProviderAPIKeyJSON(t, modelsResp, &listed)
	if len(listed.IDs) != 2 || listed.IDs[0] != "a-openrouter" || listed.IDs[1] != "z-openrouter" {
		t.Fatalf("ids = %+v, want sorted upstream models", listed.IDs)
	}
}

func TestOpenAICompatibilityProviderFetchModelsDoesNotRequireStoredProviderWhenProxyMissing(t *testing.T) {
	router, _ := newProviderAPIKeyTestRouter(t)
	rawKey := "sk-or-v1-secret-0001"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			t.Fatalf("upstream path = %q, want /models", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+rawKey {
			t.Fatalf("Authorization = %q, want bearer key", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"unsaved-model"}]}`))
	}))
	defer upstream.Close()

	modelsResp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath+"/models", map[string]any{
		"name":     "unsaved-openrouter",
		"api_key":  rawKey,
		"base_url": upstream.URL,
	})
	if modelsResp.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s, want 200", modelsResp.Code, modelsResp.Body.String())
	}
	var listed struct {
		IDs []string `json:"ids"`
	}
	decodeProviderAPIKeyJSON(t, modelsResp, &listed)
	if len(listed.IDs) != 1 || listed.IDs[0] != "unsaved-model" {
		t.Fatalf("ids = %+v, want unsaved-model", listed.IDs)
	}
}

func TestOpenAICompatibilityProviderFetchModelsUsesStoredProxyURL(t *testing.T) {
	router, _ := newProviderAPIKeyTestRouter(t)
	rawKey := "sk-or-v1-secret-0001"
	proxy, hits := newProviderModelProxyServer(t, "openrouter-upstream.example", "/models", "Bearer "+rawKey, `{"data":[{"id":"proxied-openrouter"}]}`)
	defer proxy.Close()

	createResp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath, map[string]any{
		"name":      "openrouter",
		"api_key":   rawKey,
		"base_url":  "http://openrouter-upstream.example",
		"proxy_url": proxy.URL,
		"models": []map[string]string{
			{"name": "proxied-openrouter", "alias": "proxied-openrouter"},
		},
	})
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s, want 201", createResp.Code, createResp.Body.String())
	}

	modelsResp := doProviderAPIKeyJSON(t, router, http.MethodPost, openAICompatibilityProviderTestPath+"/models", map[string]any{
		"name": "openrouter",
	})
	if modelsResp.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s, want 200", modelsResp.Code, modelsResp.Body.String())
	}
	if got := hits.Load(); got != 1 {
		t.Fatalf("proxy hits = %d, want 1", got)
	}
	var listed struct {
		IDs []string `json:"ids"`
	}
	decodeProviderAPIKeyJSON(t, modelsResp, &listed)
	if len(listed.IDs) != 1 || listed.IDs[0] != "proxied-openrouter" {
		t.Fatalf("ids = %+v, want proxied model", listed.IDs)
	}
}

func newProviderAPIKeyTestRouter(t *testing.T) (*gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	configPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(configPath, []byte(`host: "127.0.0.1"
port: 8317
auth-dir: "auths"
api-keys: []
remote-management:
  allow-remote: false
  secret-key: ""
`), 0o600); err != nil {
		t.Fatalf("write test config: %v", err)
	}

	handlers := NewHandlers(nil, nil, nil, nil, nil, configPath)
	router := gin.New()
	router.GET(providerAPIKeyTestPath, handlers.listProviderAPIKeys)
	router.POST(providerAPIKeyTestPath, handlers.createProviderAPIKey)
	router.POST(providerAPIKeyTestPath+"/models", handlers.fetchProviderAPIKeyModels)
	router.PATCH(providerAPIKeyTestPath+"/:id", handlers.patchProviderAPIKey)
	router.DELETE(providerAPIKeyTestPath+"/:id", handlers.deleteProviderAPIKey)
	router.GET(openAICompatibilityProviderTestPath, handlers.listOpenAICompatibilityProviders)
	router.POST(openAICompatibilityProviderTestPath, handlers.createOpenAICompatibilityProvider)
	router.POST(openAICompatibilityProviderTestPath+"/models", handlers.fetchOpenAICompatibilityProviderModels)
	router.PATCH(openAICompatibilityProviderTestPath+"/:name", handlers.patchOpenAICompatibilityProvider)
	router.DELETE(openAICompatibilityProviderTestPath+"/:name", handlers.deleteOpenAICompatibilityProvider)
	return router, configPath
}

func newProviderModelProxyServer(t *testing.T, wantHost, wantPath, wantAuth, response string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Scheme != "http" || r.URL.Host != wantHost || r.URL.Path != wantPath {
			t.Errorf("proxy request URL = %q, want http://%s%s", r.URL.String(), wantHost, wantPath)
			http.Error(w, "bad proxy request URL", http.StatusBadGateway)
			return
		}
		if got := r.Header.Get("Authorization"); got != wantAuth {
			t.Errorf("proxy Authorization = %q, want %q", got, wantAuth)
			http.Error(w, "bad authorization", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
	return server, &hits
}

func doProviderAPIKeyJSON(t *testing.T, router http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func decodeProviderAPIKeyJSON(t *testing.T, resp *httptest.ResponseRecorder, dst any) {
	t.Helper()
	if err := json.Unmarshal(resp.Body.Bytes(), dst); err != nil {
		t.Fatalf("decode response body %q: %v", resp.Body.String(), err)
	}
}

func loadProviderAPIKeyTestConfig(t *testing.T, configPath string) *sdkconfig.Config {
	t.Helper()
	cfg, err := sdkconfig.LoadConfig(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	return cfg
}
