import { getToken } from "@/lib/auth-client"

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

type ErrorBody = {
  error?: string
  message?: string
}

type ProviderAPIKeyInput = {
  provider: ProviderAPIKeyKind
  apiKey?: string
  baseUrl: string
  proxyUrl: string
  models: ProviderAPIKeyModel[]
  excludedModels: string[]
}

type FetchModelsInput = {
  provider: ProviderAPIKeyKind
  id?: string
  apiKey?: string
  baseUrl: string
  proxyUrl?: string
}

const API_KEY_PROVIDER_PATH = "/api/v1/api-key-provider"

function authToken(): string {
  const token = getToken()
  if (!token) throw new Error("请先登录")
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
    let message = `请求失败 (${res.status})`
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

function providerQuery(provider?: ProviderAPIKeyKind) {
  if (!provider) return ""
  return `?${new URLSearchParams({ provider }).toString()}`
}

function normalizeModels(models: ProviderAPIKeyModel[]) {
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

function providerPayload(input: ProviderAPIKeyInput, includeEmptyKey: boolean) {
  const payload: Record<string, unknown> = {
    provider: input.provider,
    base_url: input.baseUrl.trim(),
    proxy_url: input.proxyUrl.trim(),
    models: normalizeModels(input.models),
    excluded_models: normalizeStrings(input.excludedModels),
  }
  const apiKey = input.apiKey?.trim() ?? ""
  if (apiKey || includeEmptyKey) payload.api_key = apiKey
  return payload
}

export async function listProviderAPIKeys(
  provider?: ProviderAPIKeyKind
): Promise<ProviderAPIKey[]> {
  const data = await request<{ keys?: ProviderAPIKey[] }>(
    `${API_KEY_PROVIDER_PATH}${providerQuery(provider)}`
  )
  return data.keys ?? []
}

export async function createProviderAPIKey(
  input: ProviderAPIKeyInput
): Promise<ProviderAPIKey> {
  return request<ProviderAPIKey>(API_KEY_PROVIDER_PATH, {
    method: "POST",
    body: JSON.stringify(providerPayload(input, true)),
  })
}

export async function updateProviderAPIKey(
  id: string,
  input: ProviderAPIKeyInput
): Promise<ProviderAPIKey> {
  return request<ProviderAPIKey>(
    `${API_KEY_PROVIDER_PATH}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(providerPayload(input, false)),
    }
  )
}

export async function deleteProviderAPIKey(id: string): Promise<void> {
  await request<void>(`${API_KEY_PROVIDER_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function fetchProviderAPIKeyModels(
  input: FetchModelsInput
): Promise<string[]> {
  const payload: Record<string, string> = {
    provider: input.provider,
    base_url: input.baseUrl.trim(),
  }
  if (input.id) payload.id = input.id
  const apiKey = input.apiKey?.trim()
  if (apiKey) payload.api_key = apiKey
  if (input.proxyUrl !== undefined) payload.proxy_url = input.proxyUrl.trim()
  const data = await request<{ ids?: string[] }>(
    `${API_KEY_PROVIDER_PATH}/models`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  )
  return data.ids ?? []
}
