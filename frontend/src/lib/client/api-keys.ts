import { del, get, post } from "./http"

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

export async function listAPIKeys(): Promise<APIKey[]> {
  const data = await get<{ api_keys: APIKey[] }>("/api/v1/api-keys")
  return data.api_keys
}

export async function createAPIKey(
  name: string,
  expiresIn: APIKeyExpiry
): Promise<CreatedAPIKey> {
  return post<CreatedAPIKey>("/api/v1/api-keys", {
    name,
    expires_in: expiresIn,
  })
}

export async function renameAPIKey(id: string, name: string): Promise<APIKey> {
  return post<APIKey>(`/api/v1/api-keys/${encodeURIComponent(id)}/rename`, {
    name,
  })
}

export async function revokeAPIKey(id: string): Promise<void> {
  await del<void>(`/api/v1/api-keys/${encodeURIComponent(id)}`)
}
