import type { UIMessage } from "ai"

import { getToken } from "@/lib/auth-client"

export type ChatRole = "system" | "user" | "assistant" | "tool"

export type MessagePart =
  | {
      type: "text"
      text: string
    }
  | {
      type: "file"
      mediaType: string
      url: string
      filename?: string
    }
  | {
      type: string
      [key: string]: unknown
    }

export type ChatAttachment = {
  url: string
  mediaType: string
  name: string
  size: number
}

const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])
const WEB_SEARCH_TOOL_TYPES = new Set(["tool-web_search", "tool-google_search"])
const WEB_SEARCH_TOOL_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
])
const LOCAL_CHAT_MEDIA_PATH_RE = /^\/api\/v1\/chats\/media\/[^/?#]+\/[^/?#]+$/

export type ChatSession = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export type ChatMessage = {
  id: string
  session_id: string
  role: ChatRole
  parts: MessagePart[]
  created_at: string
}

function authToken(): string {
  const token = getToken()
  if (!token) throw new Error("未登录")
  return token
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const body = init.body
  const hasBody = body !== undefined && body !== null
  if (hasBody && !(body instanceof FormData) && !headers.has("Content-Type")) {
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

function joinTextParts(parts: ReadonlyArray<{ type: string; text?: string }>) {
  return parts
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("")
    .trim()
}

function isSupportedLocalImage(mediaType: string, url: string) {
  return (
    SUPPORTED_IMAGE_MIME.has(mediaType) && LOCAL_CHAT_MEDIA_PATH_RE.test(url)
  )
}

function isHTTPURL(rawURL: string) {
  try {
    const url = new URL(rawURL)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function sanitizeSourceUrlPart(part: Record<string, unknown>) {
  if (typeof part.url !== "string" || !isHTTPURL(part.url)) return null
  return {
    type: "source-url" as const,
    sourceId: typeof part.sourceId === "string" ? part.sourceId : part.url,
    url: part.url,
    ...(typeof part.title === "string" ? { title: part.title } : {}),
  }
}

function sanitizeWebSearchToolPart(part: Record<string, unknown>) {
  if (
    typeof part.type !== "string" ||
    !WEB_SEARCH_TOOL_TYPES.has(part.type) ||
    typeof part.toolCallId !== "string" ||
    typeof part.state !== "string" ||
    !WEB_SEARCH_TOOL_STATES.has(part.state)
  ) {
    return null
  }

  const out: MessagePart = {
    type: part.type,
    toolCallId: part.toolCallId,
    state: part.state,
  }
  if (typeof part.title === "string") out.title = part.title
  if (typeof part.providerExecuted === "boolean") {
    out.providerExecuted = part.providerExecuted
  }
  if ("input" in part) out.input = part.input
  if ("output" in part) out.output = part.output
  if (typeof part.errorText === "string") out.errorText = part.errorText
  if (typeof part.preliminary === "boolean") out.preliminary = part.preliminary
  return out
}

export async function listChats(): Promise<ChatSession[]> {
  const data = await apiFetch<{ chats: ChatSession[] }>("/api/v1/chats")
  return data.chats
}

export async function createChat(title: string): Promise<ChatSession> {
  return apiFetch<ChatSession>("/api/v1/chats", {
    method: "POST",
    body: JSON.stringify({ title }),
  })
}

export async function deleteChat(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/chats/${id}`, { method: "DELETE" })
}

export async function listChatMessages(id: string): Promise<ChatMessage[]> {
  const data = await apiFetch<{ messages: ChatMessage[] }>(
    `/api/v1/chats/${id}/messages`
  )
  return data.messages
}

export async function appendChatMessage(
  chatId: string,
  role: ChatRole,
  parts: MessagePart[]
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/api/v1/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ role, parts }),
  })
}

export async function uploadChatAttachment(
  file: File
): Promise<ChatAttachment> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch<ChatAttachment>("/api/v1/chats/uploads", {
    method: "POST",
    body: form,
  })
}

export function draftTitleFromText(text: string): string {
  const title = text.trim().replace(/\s+/g, " ").slice(0, 40)
  return title || "新对话"
}

export function textFromUIMessage(message: UIMessage): string {
  return joinTextParts(message.parts)
}

export function uiMessageToMessageParts(message: UIMessage): MessagePart[] {
  const parts = message.parts
    .map((part): MessagePart | null => {
      if (part.type === "text") return { type: "text", text: part.text }
      if (part.type === "file") {
        const file = part as {
          mediaType?: unknown
          url?: unknown
          filename?: unknown
        }
        if (
          typeof file.mediaType !== "string" ||
          typeof file.url !== "string" ||
          !isSupportedLocalImage(file.mediaType, file.url)
        ) {
          return null
        }
        return {
          type: "file",
          mediaType: file.mediaType,
          url: file.url,
          ...(typeof file.filename === "string"
            ? { filename: file.filename }
            : {}),
        }
      }
      if (part.type === "source-url") {
        return sanitizeSourceUrlPart(part as unknown as Record<string, unknown>)
      }
      if (
        part.type === "tool-web_search" ||
        part.type === "tool-google_search"
      ) {
        return sanitizeWebSearchToolPart(
          part as unknown as Record<string, unknown>
        )
      }
      if (part.type === "step-start") return { type: "step-start" }
      return null
    })
    .filter((part) => part !== null)
  return parts.length > 0 ? parts : [{ type: "text", text: "" }]
}

export function chatMessagesToUIMessages(messages: ChatMessage[]): UIMessage[] {
  return messages
    .filter(
      (message) =>
        message.role === "system" ||
        message.role === "user" ||
        message.role === "assistant"
    )
    .map((message) => ({
      id: message.id,
      role: message.role as UIMessage["role"],
      parts: message.parts.flatMap<UIMessage["parts"][number]>((part) => {
        if (part.type === "text" && typeof part.text === "string") {
          return [{ type: "text" as const, text: part.text }]
        }
        if (
          part.type === "file" &&
          typeof part.mediaType === "string" &&
          typeof part.url === "string" &&
          isSupportedLocalImage(part.mediaType, part.url)
        ) {
          return [
            {
              type: "file" as const,
              mediaType: part.mediaType,
              url: part.url,
              ...(typeof part.filename === "string"
                ? { filename: part.filename }
                : {}),
            },
          ]
        }
        if (part.type === "source-url") {
          const source = sanitizeSourceUrlPart(part as Record<string, unknown>)
          return source ? [source as unknown as UIMessage["parts"][number]] : []
        }
        if (
          part.type === "tool-web_search" ||
          part.type === "tool-google_search"
        ) {
          const toolPart = sanitizeWebSearchToolPart(
            part as Record<string, unknown>
          )
          return toolPart
            ? [toolPart as unknown as UIMessage["parts"][number]]
            : []
        }
        if (part.type === "step-start") return [{ type: "step-start" as const }]
        return []
      }),
    }))
}
