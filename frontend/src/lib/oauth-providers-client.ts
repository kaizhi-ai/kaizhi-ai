import { getToken } from "@/lib/auth-client"

export type OAuthProviderId = "anthropic" | "codex" | "gemini"

export type AuthFile = {
  id: string
  name: string
  provider: string
  email?: string
  label?: string
  status: string
  status_message?: string
  disabled: boolean
  proxy_url?: string
  created_at: string
  updated_at: string
}

type ErrorBody = {
  error?: string
  message?: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  if (!token) throw new Error("请先登录")

  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? ""
    let message = `请求失败 (${res.status})`
    if (contentType.includes("application/json")) {
      const body = (await res.json().catch(() => null)) as ErrorBody | null
      message = body?.error ?? body?.message ?? message
    } else {
      const text = await res.text().catch(() => "")
      if (text) message = text
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function listOAuthProviders(
  provider: OAuthProviderId
): Promise<AuthFile[]> {
  const data = await request<{ files?: AuthFile[] }>(
    `/api/v1/provider/oauth/${provider}`
  )
  return data.files ?? []
}

export async function startOAuthProvider(
  provider: OAuthProviderId,
  options: { projectId?: string } = {}
): Promise<{ url: string; state: string }> {
  const query = new URLSearchParams()
  const projectId = options.projectId?.trim()
  if (provider === "gemini" && projectId) query.set("project_id", projectId)
  const qs = query.toString()
  return request<{ url: string; state: string }>(
    `/api/v1/provider/oauth/${provider}/start${qs ? `?${qs}` : ""}`,
    { method: "POST" }
  )
}

export async function finishOAuthProvider(
  provider: OAuthProviderId,
  input: { state: string; redirectUrl: string }
): Promise<void> {
  await request(`/api/v1/provider/oauth/${provider}/finish`, {
    method: "POST",
    body: JSON.stringify({
      state: input.state,
      redirect_url: input.redirectUrl,
    }),
  })
}

export async function deleteOAuthProvider(
  provider: OAuthProviderId,
  name: string
): Promise<void> {
  const query = new URLSearchParams({ name })
  await request(`/api/v1/provider/oauth/${provider}?${query.toString()}`, {
    method: "DELETE",
  })
}

export async function updateOAuthProviderProxyURL(
  provider: OAuthProviderId,
  name: string,
  proxyUrl: string
): Promise<AuthFile> {
  return request<AuthFile>(`/api/v1/provider/oauth/${provider}/proxy`, {
    method: "PATCH",
    body: JSON.stringify({ name, proxy_url: proxyUrl }),
  })
}
