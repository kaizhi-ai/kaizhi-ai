package usage

import (
	"context"
	"log"
	"strings"
	"time"

	cliproxyusage "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/ids"
)

type Recorder struct {
	store   *Store
	apiKeys *apikeys.Store
}

func NewRecorder(store *Store, apiKeyStore *apikeys.Store) *Recorder {
	return &Recorder{store: store, apiKeys: apiKeyStore}
}

func (r *Recorder) HandleUsage(_ context.Context, record cliproxyusage.Record) {
	if r == nil || r.store == nil || r.apiKeys == nil {
		return
	}

	apiKeyID := strings.TrimSpace(record.APIKey)
	if apiKeyID == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	apiKey, err := r.apiKeys.GetByID(ctx, apiKeyID)
	if err != nil {
		log.Printf("usage recorder: lookup api key %s: %v", apiKeyID, err)
		return
	}

	id, err := ids.New("use")
	if err != nil {
		log.Printf("usage recorder: generate event id: %v", err)
		return
	}

	totalTokens := record.Detail.TotalTokens
	if totalTokens == 0 {
		totalTokens = record.Detail.InputTokens + record.Detail.OutputTokens + record.Detail.ReasoningTokens
	}

	if err := r.store.InsertEvent(ctx, InsertEventParams{
		ID:                id,
		UserID:            apiKey.UserID,
		APIKeyID:          apiKey.ID,
		Provider:          record.Provider,
		Model:             record.Model,
		UpstreamAuthID:    record.AuthID,
		UpstreamAuthIndex: record.AuthIndex,
		UpstreamAuthType:  record.AuthType,
		Source:            record.Source,
		InputTokens:       record.Detail.InputTokens,
		OutputTokens:      record.Detail.OutputTokens,
		ReasoningTokens:   record.Detail.ReasoningTokens,
		CachedTokens:      record.Detail.CachedTokens,
		TotalTokens:       totalTokens,
		LatencyMS:         record.Latency.Milliseconds(),
		Failed:            record.Failed,
		RequestedAt:       record.RequestedAt,
	}); err != nil {
		log.Printf("usage recorder: insert event for api key %s: %v", apiKey.ID, err)
	}
}
