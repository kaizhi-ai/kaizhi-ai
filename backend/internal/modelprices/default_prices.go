package modelprices

const defaultPriceNote = "built-in default price, reviewed 2026-04-27"

var defaultPrices = []SaveParams{
	defaultPrice("gpt-5.5", "5", "0.5", "30"),
	defaultPrice("gpt-5.4", "2.5", "0.25", "15"),
	defaultPrice("gpt-5.4-mini", "0.75", "0.075", "4.5"),
	defaultPrice("gpt-5.2", "1.75", "0.175", "14"),
	defaultPrice("gpt-5.2-codex", "1.75", "0.175", "14"),
	defaultPrice("gpt-5", "1.25", "0.125", "10"),
	defaultPrice("gpt-5-mini", "0.25", "0.025", "2"),
	defaultPrice("gpt-4.1", "2", "0.5", "8"),
	defaultPrice("gpt-4o", "2.5", "1.25", "10"),
	defaultPrice("gpt-4o-mini", "0.15", "0.075", "0.6"),
	defaultPrice("claude-opus-4-7", "5", "0.5", "25"),
	defaultPrice("claude-opus-4-6", "5", "0.5", "25"),
	defaultPrice("claude-sonnet-4-6", "3", "0.3", "15"),
	defaultPrice("claude-sonnet-4-5-20250929", "3", "0.3", "15"),
	defaultPrice("claude-haiku-4-5-20251001", "1", "0.1", "5"),
	defaultPrice("gemini-3.1-pro-preview", "2", "0.2", "12"),
	defaultPrice("gemini-3-flash-preview", "0.5", "0.05", "3"),
	defaultPrice("gemini-3.1-flash-lite-preview", "0.25", "0.025", "1.5"),
	{
		Model:                  "google/gemini-3.1-flash-image-preview",
		InputUSDPerMillion:     "0.5",
		OutputUSDPerMillion:    "3",
		ReasoningUSDPerMillion: strPtr("3"),
		Note:                   defaultPriceNote,
	},
	defaultPrice("deepseek-v4-flash", "0.14", "0.0028", "0.28"),
	defaultPrice("deepseek-v4-pro", "0.435", "0.003625", "0.87"),
	defaultPrice("deepseek-chat", "0.14", "0.0028", "0.28"),
	defaultPrice("deepseek-reasoner", "0.14", "0.0028", "0.28"),
}

func DefaultPrices() []SaveParams {
	return append([]SaveParams(nil), defaultPrices...)
}

func defaultPrice(model, input, cacheRead, output string) SaveParams {
	return SaveParams{
		Model:                   model,
		InputUSDPerMillion:      input,
		CacheReadUSDPerMillion:  strPtr(cacheRead),
		CacheWriteUSDPerMillion: strPtr(input),
		OutputUSDPerMillion:     output,
		ReasoningUSDPerMillion:  strPtr(output),
		Note:                    defaultPriceNote,
	}
}

func strPtr(value string) *string {
	return &value
}
