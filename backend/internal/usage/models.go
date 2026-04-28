package usage

type Summary struct {
	RequestCount     int64  `json:"request_count"`
	FailedCount      int64  `json:"failed_count"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	ReasoningTokens  int64  `json:"reasoning_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	CachedTokens     int64  `json:"cached_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	EstimatedCostUSD string `json:"estimated_cost_usd"`
	UnpricedTokens   int64  `json:"unpriced_tokens"`
}

type APIKeyUsage struct {
	APIKeyID     string `json:"api_key_id"`
	Name         string `json:"name"`
	KeyPrefix    string `json:"key_prefix"`
	RequestCount int64  `json:"request_count"`
	FailedCount  int64  `json:"failed_count"`
	TotalTokens  int64  `json:"total_tokens"`
}

type ModelUsage struct {
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	RequestCount     int64  `json:"request_count"`
	FailedCount      int64  `json:"failed_count"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	ReasoningTokens  int64  `json:"reasoning_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	CachedTokens     int64  `json:"cached_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	EstimatedCostUSD string `json:"estimated_cost_usd"`
	PriceMissing     bool   `json:"price_missing"`
	UnpricedTokens   int64  `json:"unpriced_tokens"`
}
