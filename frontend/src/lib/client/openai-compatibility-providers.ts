import { del, get, patch, post } from "./http"

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

type OpenAICompatibilityProviderInput = {
  name: string
  baseUrl: string
  apiKeyEntries: OpenAICompatibilityAPIKeyInput[]
  models: OpenAICompatibilityProviderModel[]
}

type OpenAICompatibilityFetchModelsInput = {
  name?: string
  apiKey?: string
  baseUrl: string
  proxyUrl?: string
}

type OpenAICompatibilityAPIKeyEntryPayload = {
  index?: number
  api_key?: string
  proxy_url: string
}

const OPENAI_COMPATIBILITY_PROVIDER_PATH =
  "/api/v1/openai-compatibility-provider"

function normalizeOpenAICompatibilityModels(
  models: OpenAICompatibilityProviderModel[]
) {
  return models
    .map((model) => {
      const name = model.name.trim()
      const alias = model.alias.trim() || name
      return { name, alias }
    })
    .filter((model) => model.name)
}

function normalizeOpenAICompatibilityAPIKeyEntries(
  entries: OpenAICompatibilityAPIKeyInput[]
): OpenAICompatibilityAPIKeyEntryPayload[] {
  return entries
    .map((entry) => {
      const apiKey = entry.apiKey?.trim() ?? ""
      const proxyUrl = entry.proxyUrl?.trim() ?? ""
      const payload: OpenAICompatibilityAPIKeyEntryPayload = {
        proxy_url: proxyUrl,
      }
      if (entry.index !== undefined) payload.index = entry.index
      if (apiKey) payload.api_key = apiKey
      return payload
    })
    .filter((entry) => entry.api_key || entry.index !== undefined)
}

function openAICompatibilityProviderPayload(
  input: OpenAICompatibilityProviderInput
) {
  return {
    name: input.name.trim().toLowerCase(),
    base_url: input.baseUrl.trim(),
    api_key_entries: normalizeOpenAICompatibilityAPIKeyEntries(
      input.apiKeyEntries
    ),
    models: normalizeOpenAICompatibilityModels(input.models),
  }
}

export async function listOpenAICompatibilityProviders(): Promise<
  OpenAICompatibilityProvider[]
> {
  const data = await get<{ providers?: OpenAICompatibilityProvider[] }>(
    OPENAI_COMPATIBILITY_PROVIDER_PATH
  )
  return data.providers ?? []
}

export async function createOpenAICompatibilityProvider(
  input: OpenAICompatibilityProviderInput
): Promise<OpenAICompatibilityProvider> {
  return post<OpenAICompatibilityProvider>(
    OPENAI_COMPATIBILITY_PROVIDER_PATH,
    openAICompatibilityProviderPayload(input)
  )
}

export async function updateOpenAICompatibilityProvider(
  originalName: string,
  input: OpenAICompatibilityProviderInput
): Promise<OpenAICompatibilityProvider> {
  return patch<OpenAICompatibilityProvider>(
    `${OPENAI_COMPATIBILITY_PROVIDER_PATH}/${encodeURIComponent(
      originalName
    )}`,
    openAICompatibilityProviderPayload(input)
  )
}

export async function deleteOpenAICompatibilityProvider(
  name: string
): Promise<void> {
  await del<void>(
    `${OPENAI_COMPATIBILITY_PROVIDER_PATH}/${encodeURIComponent(name)}`
  )
}

export async function fetchOpenAICompatibilityProviderModels(
  input: OpenAICompatibilityFetchModelsInput
): Promise<string[]> {
  const payload: Record<string, string> = {
    base_url: input.baseUrl.trim(),
  }
  if (input.name) payload.name = input.name.trim().toLowerCase()
  const apiKey = input.apiKey?.trim()
  if (apiKey) payload.api_key = apiKey
  if (input.proxyUrl !== undefined) payload.proxy_url = input.proxyUrl.trim()
  const data = await post<{ ids?: string[] }>(
    `${OPENAI_COMPATIBILITY_PROVIDER_PATH}/models`,
    payload
  )
  return data.ids ?? []
}
