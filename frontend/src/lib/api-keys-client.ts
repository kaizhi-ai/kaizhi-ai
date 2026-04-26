import { getToken } from "@/lib/auth-client"

export type APIKeyStatus = "active" | "revoked" | string

export type APIKey = {
  id: string
  user_id: string
  name: string
  kind: string
  key_prefix: string
  status: APIKeyStatus
  last_used_at?: string
  created_at: string
  expires_at?: string
  revoked_at?: string
}

export type CreatedAPIKey = APIKey & {
  key: string
}

export type APIKeyExpiry = "30d" | "90d" | "365d" | "never"

function authToken(): string {
  const token = getToken()
  if (!token) throw new Error("未登录")
  return token
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const body = init.body
  const hasBody = body !== undefined && body !== null
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  headers.set("Authorization", `Bearer ${authToken()}`)

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const message =
      typeof data?.error === "string" ? data.error : `请求失败 (${res.status})`
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function listAPIKeys(): Promise<APIKey[]> {
  const data = await apiFetch<{ api_keys: APIKey[] }>("/api/v1/api-keys")
  return data.api_keys
}

export async function createAPIKey(
  name: string,
  expiresIn: APIKeyExpiry
): Promise<CreatedAPIKey> {
  return apiFetch<CreatedAPIKey>("/api/v1/api-keys", {
    method: "POST",
    body: JSON.stringify({ name, expires_in: expiresIn }),
  })
}

export async function renameAPIKey(id: string, name: string): Promise<APIKey> {
  return apiFetch<APIKey>(`/api/v1/api-keys/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  })
}

export async function revokeAPIKey(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/api-keys/${id}`, { method: "DELETE" })
}
