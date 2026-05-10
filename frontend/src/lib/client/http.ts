import i18n from "@/lib/i18n"

import { clearToken, getToken } from "./token"

type ErrorBody = {
  error?: string
  message?: string
}

type ClientRequestInit = Omit<RequestInit, "body"> & {
  auth?: boolean
  body?: BodyInit | null
  errorMessage?: (status: number) => string
  token?: string | null
}

export async function responseErrorMessage(
  res: Response,
  fallback: string
): Promise<string> {
  const contentType = res.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as ErrorBody | null
    return data?.error ?? data?.message ?? fallback
  }

  const text = await res.text().catch(() => "")
  return text || fallback
}

export async function request<T>(
  path: string,
  {
    auth = true,
    body,
    errorMessage,
    headers: initialHeaders,
    token: explicitToken,
    ...init
  }: ClientRequestInit = {}
): Promise<T> {
  const headers = new Headers(initialHeaders)

  if (auth) {
    const token = explicitToken ?? getToken()
    if (!token) throw new Error(i18n.t("errors.notLoggedIn"))
    headers.set("Authorization", `Bearer ${token}`)
  }

  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
  }

  const res = await fetch(path, { ...init, body, headers })
  if (!res.ok) {
    if (auth && res.status === 401) clearToken()
    throw new Error(
      await responseErrorMessage(
        res,
        errorMessage?.(res.status) ??
          i18n.t("errors.requestFailedWithStatus", { status: res.status })
      )
    )
  }

  if (res.status === 204) return undefined as T
  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return undefined as T
  return (await res.json()) as T
}

export function jsonBody(input: unknown): BodyInit {
  return JSON.stringify(input)
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : jsonBody(body),
  })
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    body: body === undefined ? undefined : jsonBody(body),
  })
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" })
}
