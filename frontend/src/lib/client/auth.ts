import i18n from "@/lib/i18n"

import { jsonBody, request } from "./http"
import { getToken, setToken } from "./token"

export type AuthUser = {
  id: string
  email: string
  name: string
  language: string
  status: string
  role: string
  quota_5h_cost_usd?: string | null
  quota_7d_cost_usd?: string | null
  usage_5h_cost_usd?: string
  usage_7d_cost_usd?: string
  usage_5h_started_at?: string
  usage_7d_started_at?: string
  usage_5h_reset_at?: string | null
  usage_7d_reset_at?: string | null
  created_at: string
  updated_at?: string
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<{ error?: { message: string } }> {
  try {
    const data = await request<{ access_token?: string }>("/api/v1/auth/login", {
      auth: false,
      method: "POST",
      body: jsonBody({ email, password }),
      errorMessage: (status) =>
        i18n.t("errors.loginFailedWithStatus", { status }),
    })
    if (data?.access_token) setToken(data.access_token)
    return {}
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : i18n.t("errors.network"),
      },
    }
  }
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!getToken()) return null
  try {
    const data = await request<{ user?: AuthUser }>("/api/v1/auth/me")
    return data?.user ?? null
  } catch {
    return null
  }
}

export async function updateCurrentUser(input: {
  name?: string
  language?: string
}): Promise<AuthUser> {
  const payload: Record<string, string> = {}
  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.language !== undefined) payload.language = input.language

  const data = await request<{ user: AuthUser }>("/api/v1/auth/me", {
    method: "PATCH",
    body: jsonBody(payload),
    errorMessage: (status) =>
      i18n.t("errors.saveFailedWithStatus", { status }),
  })
  return data.user
}

export async function logoutSession(token = getToken()): Promise<void> {
  if (!token) return
  try {
    await request<void>("/api/v1/auth/logout", {
      method: "POST",
      token,
    })
  } catch {
    // Best-effort: even if the network call fails, the local token is cleared
    // by the caller so the user is logged out from this device.
  }
}
