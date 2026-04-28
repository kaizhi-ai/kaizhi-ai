package modelprices

import "time"

type Price struct {
	ID                      string    `json:"id"`
	Model                   string    `json:"model"`
	InputUSDPerMillion      string    `json:"input_usd_per_million"`
	CacheReadUSDPerMillion  *string   `json:"cache_read_usd_per_million,omitempty"`
	CacheWriteUSDPerMillion *string   `json:"cache_write_usd_per_million,omitempty"`
	OutputUSDPerMillion     string    `json:"output_usd_per_million"`
	ReasoningUSDPerMillion  *string   `json:"reasoning_usd_per_million,omitempty"`
	Note                    string    `json:"note"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}

type PriceResponse struct {
	ID                      string  `json:"id"`
	Model                   string  `json:"model"`
	InputUSDPerMillion      string  `json:"input_usd_per_million"`
	CacheReadUSDPerMillion  *string `json:"cache_read_usd_per_million,omitempty"`
	CacheWriteUSDPerMillion *string `json:"cache_write_usd_per_million,omitempty"`
	OutputUSDPerMillion     string  `json:"output_usd_per_million"`
	ReasoningUSDPerMillion  *string `json:"reasoning_usd_per_million,omitempty"`
	Note                    string  `json:"note"`
	CreatedAt               string  `json:"created_at"`
	UpdatedAt               string  `json:"updated_at"`
}

type ListParams struct {
	Query string
}

type SaveParams struct {
	Model                   string
	InputUSDPerMillion      string
	CacheReadUSDPerMillion  *string
	CacheWriteUSDPerMillion *string
	OutputUSDPerMillion     string
	ReasoningUSDPerMillion  *string
	Note                    string
}

type ImportResult struct {
	Total   int `json:"total"`
	Created int `json:"created"`
	Skipped int `json:"skipped"`
}

type UnmatchedModel struct {
	Model        string `json:"model"`
	RequestCount int64  `json:"request_count"`
	TotalTokens  int64  `json:"total_tokens"`
	FirstSeen    string `json:"first_seen"`
	LastSeen     string `json:"last_seen"`
}

func PublicPrice(price Price) PriceResponse {
	return PriceResponse{
		ID:                      price.ID,
		Model:                   price.Model,
		InputUSDPerMillion:      price.InputUSDPerMillion,
		CacheReadUSDPerMillion:  price.CacheReadUSDPerMillion,
		CacheWriteUSDPerMillion: price.CacheWriteUSDPerMillion,
		OutputUSDPerMillion:     price.OutputUSDPerMillion,
		ReasoningUSDPerMillion:  price.ReasoningUSDPerMillion,
		Note:                    price.Note,
		CreatedAt:               price.CreatedAt.Format(time.RFC3339),
		UpdatedAt:               price.UpdatedAt.Format(time.RFC3339),
	}
}

func PublicPrices(prices []Price) []PriceResponse {
	out := make([]PriceResponse, 0, len(prices))
	for _, price := range prices {
		out = append(out, PublicPrice(price))
	}
	return out
}
