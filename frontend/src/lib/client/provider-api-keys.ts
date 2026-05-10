import { del, get, patch, post } from "./http"

export type ProviderAPIKeyKind = "claude" | "gemini" | "codex"

export type ProviderAPIKeyModel = {
  name: string
  alias: string
}

export type ProviderAPIKey = {
  id: string
  provider: string
  name?: string
  index: number
  key_index?: number
  has_api_key: boolean
  api_key_preview?: string
  prefix?: string
  base_url?: string
  proxy_url?: string
  priority?: number
  models?: ProviderAPIKeyModel[]
  headers?: string[]
  excluded_models?: string[]
}

type ProviderAPIKeyInput = {
  provider: ProviderAPIKeyKind
  apiKey?: string
  baseUrl: string
  proxyUrl: string
  models: ProviderAPIKeyModel[]
  excludedModels: string[]
}

type ProviderFetchModelsInput = {
  provider: ProviderAPIKeyKind
  id?: string
  apiKey?: string
  baseUrl: string
  proxyUrl?: string
}

const API_KEY_PROVIDER_PATH = "/api/v1/api-key-provider"

function providerQuery(provider?: ProviderAPIKeyKind) {
  if (!provider) return ""
  return `?${new URLSearchParams({ provider }).toString()}`
}

function normalizeProviderModels(models: ProviderAPIKeyModel[]) {
  return models
    .map((model) => {
      const name = model.name.trim()
      const alias = model.alias.trim() || name
      return { name, alias }
    })
    .filter((model) => model.name)
}

function normalizeStrings(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean)
}

function providerAPIKeyPayload(
  input: ProviderAPIKeyInput,
  includeEmptyKey: boolean
) {
  const payload: Record<string, unknown> = {
    provider: input.provider,
    base_url: input.baseUrl.trim(),
    proxy_url: input.proxyUrl.trim(),
    models: normalizeProviderModels(input.models),
    excluded_models: normalizeStrings(input.excludedModels),
  }
  const apiKey = input.apiKey?.trim() ?? ""
  if (apiKey || includeEmptyKey) payload.api_key = apiKey
  return payload
}

export async function listProviderAPIKeys(
  provider?: ProviderAPIKeyKind
): Promise<ProviderAPIKey[]> {
  const data = await get<{ keys?: ProviderAPIKey[] }>(
    `${API_KEY_PROVIDER_PATH}${providerQuery(provider)}`
  )
  return data.keys ?? []
}

export async function createProviderAPIKey(
  input: ProviderAPIKeyInput
): Promise<ProviderAPIKey> {
  return post<ProviderAPIKey>(
    API_KEY_PROVIDER_PATH,
    providerAPIKeyPayload(input, true)
  )
}

export async function updateProviderAPIKey(
  id: string,
  input: ProviderAPIKeyInput
): Promise<ProviderAPIKey> {
  return patch<ProviderAPIKey>(
    `${API_KEY_PROVIDER_PATH}/${encodeURIComponent(id)}`,
    providerAPIKeyPayload(input, false)
  )
}

export async function deleteProviderAPIKey(id: string): Promise<void> {
  await del<void>(`${API_KEY_PROVIDER_PATH}/${encodeURIComponent(id)}`)
}

export async function fetchProviderAPIKeyModels(
  input: ProviderFetchModelsInput
): Promise<string[]> {
  const payload: Record<string, string> = {
    provider: input.provider,
    base_url: input.baseUrl.trim(),
  }
  if (input.id) payload.id = input.id
  const apiKey = input.apiKey?.trim()
  if (apiKey) payload.api_key = apiKey
  if (input.proxyUrl !== undefined) payload.proxy_url = input.proxyUrl.trim()
  const data = await post<{ ids?: string[] }>(
    `${API_KEY_PROVIDER_PATH}/models`,
    payload
  )
  return data.ids ?? []
}
