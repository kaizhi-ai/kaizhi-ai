import { get } from "./http"

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

const ADMIN_USAGE_PATH = "/api/v1/admin/usage"

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
  return get(`${ADMIN_USAGE_PATH}${rangeSuffix(range)}`)
}

export async function listAdminUsageByAPIKey(
  range: UsageRange
): Promise<APIKeyUsage[]> {
  const data = await get<{
    from: string
    to: string
    api_keys?: APIKeyUsage[]
  }>(`${ADMIN_USAGE_PATH}/api-keys${rangeSuffix(range)}`)
  return data.api_keys ?? []
}

export async function listAdminUsageByUser(
  range: UsageRange
): Promise<UserUsage[]> {
  const data = await get<{
    from: string
    to: string
    users?: UserUsage[]
  }>(`${ADMIN_USAGE_PATH}/users${rangeSuffix(range)}`)
  return data.users ?? []
}

export async function listAdminUsageByModel(
  range: UsageRange
): Promise<ModelUsage[]> {
  const data = await get<{
    from: string
    to: string
    models?: ModelUsage[]
  }>(`${ADMIN_USAGE_PATH}/models${rangeSuffix(range)}`)
  return data.models ?? []
}
