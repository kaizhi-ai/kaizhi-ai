import { getToken } from "@/lib/auth-client"
import i18n from "@/lib/i18n"

export type OpenAICompatibilityProviderModel = {
  name: string
  alias: string
}

export type OpenAICompatibilityAPIKeyEntry = {
  index: number
  has_api_key: boolean
  api_key_preview?: string
  proxy_url?: string
}

export type OpenAICompatibilityAPIKeyInput = {
  index?: number
  apiKey?: string
  proxyUrl?: string
}

export type OpenAICompatibilityProvider = {
  id: string
  name: string
  index: number
  has_api_key: boolean
  api_key_preview?: string
  prefix?: string
  base_url?: string
  proxy_url?: string
  priority?: number
  models?: OpenAICompatibilityProviderModel[]
  headers?: string[]
  api_key_entries?: OpenAICompatibilityAPIKeyEntry[]
}

type ErrorBody = {
  error?: string
  message?: string
}

type OpenAICompatibilityProviderInput = {
  name: string
  baseUrl: string
  apiKeyEntries: OpenAICompatibilityAPIKeyInput[]
  models: OpenAICompatibilityProviderModel[]
}

type FetchModelsInput = {
  name?: string
  apiKey?: string
  baseUrl: string
  proxyUrl?: string
}

type APIKeyEntryPayload = {
  index?: number
  api_key?: string
  proxy_url: string
}

const OPENAI_COMPATIBILITY_PROVIDER_PATH =
  "/api/v1/openai-compatibility-provider"

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

function normalizeModels(models: OpenAICompatibilityProviderModel[]) {
  return models
    .map((model) => {
      const name = model.name.trim()
      const alias = model.alias.trim() || name
      return { name, alias }
    })
    .filter((model) => model.name)
}

function normalizeAPIKeyEntries(
  entries: OpenAICompatibilityAPIKeyInput[]
): APIKeyEntryPayload[] {
  return entries
    .map((entry) => {
      const apiKey = entry.apiKey?.trim() ?? ""
      const proxyUrl = entry.proxyUrl?.trim() ?? ""
      const payload: APIKeyEntryPayload = {
        proxy_url: proxyUrl,
      }
      if (entry.index !== undefined) payload.index = entry.index
      if (apiKey) payload.api_key = apiKey
      return payload
    })
    .filter((entry) => entry.api_key || entry.index !== undefined)
}

function providerPayload(input: OpenAICompatibilityProviderInput) {
  const payload: Record<string, unknown> = {
    name: input.name.trim().toLowerCase(),
    base_url: input.baseUrl.trim(),
    api_key_entries: normalizeAPIKeyEntries(input.apiKeyEntries),
    models: normalizeModels(input.models),
  }
  return payload
}

export async function listOpenAICompatibilityProviders(): Promise<
  OpenAICompatibilityProvider[]
> {
  const data = await request<{ providers?: OpenAICompatibilityProvider[] }>(
    OPENAI_COMPATIBILITY_PROVIDER_PATH
  )
  return data.providers ?? []
}

export async function createOpenAICompatibilityProvider(
  input: OpenAICompatibilityProviderInput
): Promise<OpenAICompatibilityProvider> {
  return request<OpenAICompatibilityProvider>(
    OPENAI_COMPATIBILITY_PROVIDER_PATH,
    {
      method: "POST",
      body: JSON.stringify(providerPayload(input)),
    }
  )
}

export async function updateOpenAICompatibilityProvider(
  originalName: string,
  input: OpenAICompatibilityProviderInput
): Promise<OpenAICompatibilityProvider> {
  return request<OpenAICompatibilityProvider>(
    `${OPENAI_COMPATIBILITY_PROVIDER_PATH}/${encodeURIComponent(originalName)}`,
    {
      method: "PATCH",
      body: JSON.stringify(providerPayload(input)),
    }
  )
}

export async function deleteOpenAICompatibilityProvider(
  name: string
): Promise<void> {
  await request<void>(
    `${OPENAI_COMPATIBILITY_PROVIDER_PATH}/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  )
}

export async function fetchOpenAICompatibilityProviderModels(
  input: FetchModelsInput
): Promise<string[]> {
  const payload: Record<string, string> = {
    base_url: input.baseUrl.trim(),
  }
  if (input.name) payload.name = input.name.trim().toLowerCase()
  const apiKey = input.apiKey?.trim()
  if (apiKey) payload.api_key = apiKey
  if (input.proxyUrl !== undefined) payload.proxy_url = input.proxyUrl.trim()
  const data = await request<{ ids?: string[] }>(
    `${OPENAI_COMPATIBILITY_PROVIDER_PATH}/models`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  )
  return data.ids ?? []
}
