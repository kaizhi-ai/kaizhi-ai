import { getToken } from "@/lib/auth-client"
import i18n from "@/lib/i18n"

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

type ErrorBody = {
  error?: string
  message?: string
}

const MODEL_PRICES_PATH = "/api/v1/admin/model-prices"

function authToken(): string {
  const token = getToken()
  if (!token) throw new Error(i18n.t("errors.notLoggedIn"))
  return token
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const body = init.body
  if (body !== undefined && body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  headers.set("Authorization", `Bearer ${authToken()}`)

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? ""
    let message = i18n.t("errors.requestFailedWithStatus", {
      status: res.status,
    })
    if (contentType.includes("application/json")) {
      const data = (await res.json().catch(() => null)) as ErrorBody | null
      message = data?.error ?? data?.message ?? message
    } else {
      const text = await res.text().catch(() => "")
      if (text) message = text
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

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
  const data = await request<{ prices?: ModelPrice[] }>(
    `${MODEL_PRICES_PATH}${suffix}`
  )
  return data.prices ?? []
}

export async function createModelPrice(
  input: ModelPriceInput
): Promise<ModelPrice> {
  const data = await request<{ price: ModelPrice }>(MODEL_PRICES_PATH, {
    method: "POST",
    body: JSON.stringify(pricePayload(input)),
  })
  return data.price
}

export async function updateModelPrice(
  id: string,
  input: ModelPriceInput
): Promise<ModelPrice> {
  const data = await request<{ price: ModelPrice }>(
    `${MODEL_PRICES_PATH}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(pricePayload(input)),
    }
  )
  return data.price
}

export async function deleteModelPrice(id: string): Promise<void> {
  await request<void>(`${MODEL_PRICES_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function importDefaultModelPrices(): Promise<ImportDefaultModelPricesResult> {
  const data = await request<{ result: ImportDefaultModelPricesResult }>(
    `${MODEL_PRICES_PATH}/import-defaults`,
    {
      method: "POST",
    }
  )
  return data.result
}

export async function listUnmatchedModels(
  from: string,
  to: string
): Promise<UnmatchedModel[]> {
  const params = new URLSearchParams({ from, to })
  const data = await request<{ models?: UnmatchedModel[] }>(
    `${MODEL_PRICES_PATH}/unmatched?${params.toString()}`
  )
  return data.models ?? []
}
