import { del, get, patch, post } from "./http"

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

const OAUTH_PROVIDER_PATH = "/api/v1/oauth-provider"

export async function listOAuthProviders(
  provider: OAuthProviderId
): Promise<AuthFile[]> {
  const data = await get<{ files?: AuthFile[] }>(
    `${OAUTH_PROVIDER_PATH}/${provider}`
  )
  return data.files ?? []
}

export async function startOAuthProvider(
  provider: OAuthProviderId,
  options: { projectId?: string; proxyUrl?: string } = {}
): Promise<{ url: string; state: string }> {
  const projectId = options.projectId?.trim()
  const proxyUrl = options.proxyUrl?.trim()
  const body: Record<string, string> = {}
  if (provider === "gemini" && projectId) body.project_id = projectId
  if (proxyUrl) body.proxy_url = proxyUrl
  return post<{ url: string; state: string }>(
    `${OAUTH_PROVIDER_PATH}/${provider}/start`,
    body
  )
}

export async function finishOAuthProvider(
  provider: OAuthProviderId,
  input: { state: string; redirectUrl: string }
): Promise<void> {
  await post<void>(`${OAUTH_PROVIDER_PATH}/${provider}/finish`, {
    state: input.state,
    redirect_url: input.redirectUrl,
  })
}

export async function deleteOAuthProvider(
  provider: OAuthProviderId,
  name: string
): Promise<void> {
  const query = new URLSearchParams({ name })
  await del<void>(`${OAUTH_PROVIDER_PATH}/${provider}?${query.toString()}`)
}

export async function updateOAuthProviderProxyURL(
  provider: OAuthProviderId,
  name: string,
  proxyUrl: string
): Promise<AuthFile> {
  return patch<AuthFile>(`${OAUTH_PROVIDER_PATH}/${provider}/proxy`, {
    name,
    proxy_url: proxyUrl,
  })
}

export async function updateOAuthProviderDisabled(
  provider: OAuthProviderId,
  name: string,
  disabled: boolean
): Promise<AuthFile> {
  return patch<AuthFile>(`${OAUTH_PROVIDER_PATH}/${provider}/status`, {
    name,
    disabled,
  })
}
