import { getToken } from "@/lib/auth-client"
import i18n from "@/lib/i18n"

export type UsageSummary = {
  request_count: number
  failed_count: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cached_tokens: number
  total_tokens: number
  cost_usd: string
  unpriced_tokens: number
}

export type APIKeyUsage = {
  api_key_id: string
  user_id?: string
  user_email?: string
  user_name?: string
  name: string
  key_prefix: string
  request_count: number
  failed_count: number
  total_tokens: number
}

export type UserUsage = {
  user_id: string
  user_email: string
  user_name: string
  request_count: number
  failed_count: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cached_tokens: number
  total_tokens: number
  cost_usd: string
  unpriced_tokens: number
}

export type ModelUsage = {
  provider: string
  model: string
  request_count: number
  failed_count: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cached_tokens: number
  total_tokens: number
  cost_usd: string
  price_missing: boolean
  unpriced_tokens: number
}

export type UsageRange = {
  from: string
  to: string
}

type ErrorBody = {
  error?: string
  message?: string
}

const ADMIN_USAGE_PATH = "/api/v1/admin/usage"

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

function rangeSuffix(range: UsageRange) {
  const params = new URLSearchParams()
  if (range.from) params.set("from", range.from)
  if (range.to) params.set("to", range.to)
  const query = params.toString()
  return query ? `?${query}` : ""
}

export async function getAdminUsageSummary(
  range: UsageRange
): Promise<{ from: string; to: string; usage: UsageSummary }> {
  return request(`${ADMIN_USAGE_PATH}${rangeSuffix(range)}`)
}

export async function listAdminUsageByAPIKey(
  range: UsageRange
): Promise<APIKeyUsage[]> {
  const data = await request<{
    from: string
    to: string
    api_keys?: APIKeyUsage[]
  }>(`${ADMIN_USAGE_PATH}/api-keys${rangeSuffix(range)}`)
  return data.api_keys ?? []
}

export async function listAdminUsageByUser(
  range: UsageRange
): Promise<UserUsage[]> {
  const data = await request<{
    from: string
    to: string
    users?: UserUsage[]
  }>(`${ADMIN_USAGE_PATH}/users${rangeSuffix(range)}`)
  return data.users ?? []
}

export async function listAdminUsageByModel(
  range: UsageRange
): Promise<ModelUsage[]> {
  const data = await request<{
    from: string
    to: string
    models?: ModelUsage[]
  }>(`${ADMIN_USAGE_PATH}/models${rangeSuffix(range)}`)
  return data.models ?? []
}
