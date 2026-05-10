import { get, patch, post } from "./http"

export type AdminUserRole = "user" | "admin"
export type AdminUserStatus = "active" | "banned"
export type AdminUserLanguage = "zh-CN" | "en-US"

export type AdminUser = {
  id: string
  email: string
  name: string
  language: string
  status: AdminUserStatus | string
  role: AdminUserRole | string
  quota_5h_cost_usd: string | null
  quota_7d_cost_usd: string | null
  usage_5h_cost_usd: string
  usage_7d_cost_usd: string
  usage_5h_started_at: string
  usage_7d_started_at: string
  usage_5h_reset_at: string | null
  usage_7d_reset_at: string | null
  created_at: string
  updated_at: string
}

const ADMIN_USERS_PATH = "/api/v1/admin/users"

function userPath(id: string) {
  return `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}`
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const data = await get<{ users?: AdminUser[] }>(ADMIN_USERS_PATH)
  return data.users ?? []
}

export async function createAdminUser(input: {
  email: string
  name?: string
  language?: AdminUserLanguage | string | null
  password: string
  role: AdminUserRole
  quota_5h_cost_usd?: string | null
  quota_7d_cost_usd?: string | null
}): Promise<AdminUser> {
  const payload: Record<string, string | null> = {
    email: input.email.trim(),
    name: input.name?.trim() ?? "",
    language: input.language ?? null,
    password: input.password,
    role: input.role,
  }
  if (input.quota_5h_cost_usd !== undefined) {
    payload.quota_5h_cost_usd = input.quota_5h_cost_usd
  }
  if (input.quota_7d_cost_usd !== undefined) {
    payload.quota_7d_cost_usd = input.quota_7d_cost_usd
  }
  const data = await post<{ user: AdminUser }>(ADMIN_USERS_PATH, payload)
  return data.user
}

export async function updateAdminUser(
  id: string,
  input: {
    email?: string
    name?: string
    language?: AdminUserLanguage | string
    role?: AdminUserRole
    quota_5h_cost_usd?: string | null
    quota_7d_cost_usd?: string | null
  }
): Promise<AdminUser> {
  const payload: Record<string, string | null> = {}
  if (input.email !== undefined) payload.email = input.email.trim()
  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.language !== undefined) payload.language = input.language
  if (input.role !== undefined) payload.role = input.role
  if (input.quota_5h_cost_usd !== undefined) {
    payload.quota_5h_cost_usd = input.quota_5h_cost_usd
  }
  if (input.quota_7d_cost_usd !== undefined) {
    payload.quota_7d_cost_usd = input.quota_7d_cost_usd
  }
  const data = await patch<{ user: AdminUser }>(userPath(id), payload)
  return data.user
}

export async function resetAdminUserPassword(
  id: string,
  password: string
): Promise<void> {
  await post<void>(`${userPath(id)}/password`, { password })
}

export async function banAdminUser(id: string): Promise<AdminUser> {
  const data = await post<{ user: AdminUser }>(`${userPath(id)}/ban`)
  return data.user
}

export async function unbanAdminUser(id: string): Promise<AdminUser> {
  const data = await post<{ user: AdminUser }>(`${userPath(id)}/unban`)
  return data.user
}
