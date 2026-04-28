import { getToken } from "@/lib/auth-client"
import i18n from "@/lib/i18n"

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

type ErrorBody = {
  error?: string
  message?: string
}

const ADMIN_USERS_PATH = "/api/v1/admin/users"

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

function userPath(id: string) {
  return `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}`
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const data = await request<{ users?: AdminUser[] }>(ADMIN_USERS_PATH)
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
  const data = await request<{ user: AdminUser }>(ADMIN_USERS_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
  })
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
  const data = await request<{ user: AdminUser }>(userPath(id), {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
  return data.user
}

export async function resetAdminUserPassword(
  id: string,
  password: string
): Promise<void> {
  await request<void>(`${userPath(id)}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  })
}

export async function banAdminUser(id: string): Promise<AdminUser> {
  const data = await request<{ user: AdminUser }>(`${userPath(id)}/ban`, {
    method: "POST",
  })
  return data.user
}

export async function unbanAdminUser(id: string): Promise<AdminUser> {
  const data = await request<{ user: AdminUser }>(`${userPath(id)}/unban`, {
    method: "POST",
  })
  return data.user
}
