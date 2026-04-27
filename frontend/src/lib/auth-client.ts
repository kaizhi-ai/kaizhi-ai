import i18n from "@/lib/i18n"

const TOKEN_KEY = "kaizhi.access_token"

export type AuthUser = {
  id: string
  email: string
  name: string
  language: string
  status: string
  role: string
  created_at: string
  updated_at?: string
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<{ error?: { message: string } }> {
  try {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        error: {
          message:
            data?.error ??
            i18n.t("errors.loginFailedWithStatus", { status: res.status }),
        },
      }
    }
    if (data?.access_token) {
      setToken(data.access_token)
    }
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
  const token = getToken()
  if (!token) return null
  try {
    const res = await fetch("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      if (res.status === 401) clearToken()
      return null
    }
    const data = await res.json().catch(() => null)
    return data?.user ?? null
  } catch {
    return null
  }
}

export async function updateCurrentUser(input: {
  name?: string
  language?: string
}): Promise<AuthUser> {
  const token = getToken()
  if (!token) throw new Error(i18n.t("errors.notLoggedIn"))

  const payload: Record<string, string> = {}
  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.language !== undefined) payload.language = input.language

  const res = await fetch("/api/v1/auth/me", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(
      data?.error ??
        i18n.t("errors.saveFailedWithStatus", { status: res.status })
    )
  }
  return data.user
}

export async function logoutSession(token = getToken()): Promise<void> {
  if (!token) return
  try {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    // Best-effort: even if the network call fails, the local token is cleared
    // by the caller so the user is logged out from this device.
  }
}
