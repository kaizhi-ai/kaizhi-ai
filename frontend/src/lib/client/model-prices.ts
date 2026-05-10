import { del, get, patch, post } from "./http"

export type ModelPrice = {
  id: string
  model: string
  input_usd_per_million: string
  cache_read_usd_per_million?: string
  cache_write_usd_per_million?: string
  output_usd_per_million: string
  reasoning_usd_per_million?: string
  note: string
  created_at: string
  updated_at: string
}

export type ModelPriceInput = {
  model: string
  inputUSDPerMillion: string
  cacheReadUSDPerMillion?: string | null
  cacheWriteUSDPerMillion?: string | null
  outputUSDPerMillion: string
  reasoningUSDPerMillion?: string | null
  note?: string
}

export type UnmatchedModel = {
  model: string
  request_count: number
  total_tokens: number
  first_seen: string
  last_seen: string
}

export type ImportDefaultModelPricesResult = {
  total: number
  created: number
  skipped: number
}

const MODEL_PRICES_PATH = "/api/v1/admin/model-prices"

function optionalString(value?: string | null) {
  const trimmed = value?.trim() ?? ""
  return trimmed || null
}

function pricePayload(input: ModelPriceInput) {
  return {
    model: input.model.trim(),
    input_usd_per_million: input.inputUSDPerMillion.trim(),
    cache_read_usd_per_million: optionalString(input.cacheReadUSDPerMillion),
    cache_write_usd_per_million: optionalString(input.cacheWriteUSDPerMillion),
    output_usd_per_million: input.outputUSDPerMillion.trim(),
    reasoning_usd_per_million: optionalString(input.reasoningUSDPerMillion),
    note: input.note?.trim() ?? "",
  }
}

export async function listModelPrices(input?: {
  query?: string
}): Promise<ModelPrice[]> {
  const params = new URLSearchParams()
  if (input?.query?.trim()) params.set("q", input.query.trim())
  const suffix = params.toString() ? `?${params.toString()}` : ""
  const data = await get<{ prices?: ModelPrice[] }>(
    `${MODEL_PRICES_PATH}${suffix}`
  )
  return data.prices ?? []
}

export async function createModelPrice(
  input: ModelPriceInput
): Promise<ModelPrice> {
  const data = await post<{ price: ModelPrice }>(
    MODEL_PRICES_PATH,
    pricePayload(input)
  )
  return data.price
}

export async function updateModelPrice(
  id: string,
  input: ModelPriceInput
): Promise<ModelPrice> {
  const data = await patch<{ price: ModelPrice }>(
    `${MODEL_PRICES_PATH}/${encodeURIComponent(id)}`,
    pricePayload(input)
  )
  return data.price
}

export async function deleteModelPrice(id: string): Promise<void> {
  await del<void>(`${MODEL_PRICES_PATH}/${encodeURIComponent(id)}`)
}

export async function importDefaultModelPrices(): Promise<ImportDefaultModelPricesResult> {
  const data = await post<{ result: ImportDefaultModelPricesResult }>(
    `${MODEL_PRICES_PATH}/import-defaults`
  )
  return data.result
}

export async function listUnmatchedModels(
  from: string,
  to: string
): Promise<UnmatchedModel[]> {
  const params = new URLSearchParams({ from, to })
  const data = await get<{ models?: UnmatchedModel[] }>(
    `${MODEL_PRICES_PATH}/unmatched?${params.toString()}`
  )
  return data.models ?? []
}
