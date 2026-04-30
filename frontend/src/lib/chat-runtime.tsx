import { useEffect, useMemo, useRef, type ReactNode } from "react"
import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai"
import { Chat } from "@ai-sdk/react"
import { convertToModelMessages, stepCountIs, streamText } from "ai"
import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"

import { getToken } from "@/lib/auth-client"
import {
  ChatRuntimeContext,
  DRAFT_CHAT_ID,
  isStreamingStatus,
  type ChatRuntime,
  type RuntimeSession,
} from "@/lib/chat-runtime-context"
import {
  appendChatMessage,
  chatMessagesToUIMessages,
  listChatMessages,
  uiMessageToMessageParts,
} from "@/lib/chats-client"
import i18n from "@/lib/i18n"

const CHAT_MODEL = "gpt-5.5"
const ACCEPT_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"]

type FileUIPart = {
  type: "file"
  mediaType: string
  url: string
  filename?: string
}

function isFilePart(part: { type: string }): part is FileUIPart {
  if (part.type !== "file") return false
  const file = part as Partial<FileUIPart>
  return typeof file.mediaType === "string" && typeof file.url === "string"
}

function isLocalChatMediaURL(url: string) {
  try {
    const parsed = new URL(url, window.location.origin)
    return (
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith("/api/v1/chats/media/")
    )
  } catch {
    return false
  }
}

function isInlineImageURL(url: string, mediaType: string) {
  return (
    url.startsWith(`data:${mediaType};`) ||
    url.startsWith(`data:${mediaType},`) ||
    url.startsWith("blob:")
  )
}

function isImageFilePart(part: { type: string }): part is FileUIPart {
  if (!isFilePart(part)) return false
  return (
    ACCEPT_MIME.includes(part.mediaType) &&
    (isInlineImageURL(part.url, part.mediaType) ||
      isLocalChatMediaURL(part.url))
  )
}

function readBlobAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
      } else {
        reject(new Error(i18n.t("errors.readFileFailed")))
      }
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error(i18n.t("errors.readFileFailed")))
    reader.readAsDataURL(blob)
  })
}

async function fetchChatMediaAsDataURL(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) throw new Error(i18n.t("chat.imageLoadFailed"))

  return readBlobAsDataURL(await res.blob())
}

async function inlineChatFilesForModel(messages: UIMessage[], token: string) {
  return Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user") return message

      const parts = await Promise.all(
        message.parts.map(async (part) => {
          if (!isFilePart(part)) return part
          if (!isImageFilePart(part)) return null
          if (part.url.startsWith("data:")) return part

          if (!isLocalChatMediaURL(part.url) && !part.url.startsWith("blob:")) {
            return null
          }

          return {
            ...part,
            url: await fetchChatMediaAsDataURL(part.url, token),
          }
        })
      )

      return {
        ...message,
        parts: parts.filter((part) => part !== null) as UIMessage["parts"],
      }
    })
  )
}

function chatIdFromBody(body: unknown, fallback?: string) {
  if (body && typeof body === "object" && "chatId" in body) {
    const chatId = (body as { chatId?: unknown }).chatId
    if (typeof chatId === "string") return chatId
  }
  return fallback
}

function shouldPersistUserMessage(body: unknown) {
  if (body && typeof body === "object" && "skipPersistUser" in body) {
    return (body as { skipPersistUser?: unknown }).skipPersistUser !== true
  }
  return true
}

function shouldUseWebSearch(body: unknown) {
  if (body && typeof body === "object" && "webSearch" in body) {
    return (body as { webSearch?: unknown }).webSearch === true
  }
  return true
}

function createRuntimeTransport(): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal, body, chatId }) {
      const targetChatId = chatIdFromBody(body, chatId)
      if (!targetChatId || targetChatId === DRAFT_CHAT_ID) {
        throw new Error(i18n.t("errors.missingChatId"))
      }

      const userMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user")
      if (userMessage && shouldPersistUserMessage(body)) {
        await appendChatMessage(
          targetChatId,
          "user",
          uiMessageToMessageParts(userMessage)
        )
      }

      const token = getToken()
      if (!token) throw new Error(i18n.t("errors.notLoggedIn"))
      const openai = createOpenAI({
        apiKey: token,
        baseURL: `${window.location.origin}/v1`,
      })
      const modelMessages = await inlineChatFilesForModel(messages, token)
      const tools = shouldUseWebSearch(body)
        ? { web_search: openai.tools.webSearch() }
        : undefined

      const result = streamText({
        model: openai.responses(CHAT_MODEL),
        messages: await convertToModelMessages(modelMessages),
        tools,
        stopWhen: tools ? stepCountIs(5) : undefined,
        abortSignal,
        providerOptions: {
          openai: {
            store: false,
          } satisfies OpenAILanguageModelResponsesOptions,
        },
      })

      return result.toUIMessageStream({
        originalMessages: messages,
        sendSources: true,
        onFinish: async ({ responseMessage }) => {
          await appendChatMessage(
            targetChatId,
            "assistant",
            uiMessageToMessageParts(responseMessage)
          )
        },
      })
    },
    async reconnectToStream() {
      return null
    },
  }
}

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const sessionsRef = useRef(new Map<string, RuntimeSession>())

  const runtime = useMemo<ChatRuntime>(() => {
    function getSession(chatId: string) {
      const existing = sessionsRef.current.get(chatId)
      if (existing) return existing

      const session: RuntimeSession = {
        chat: new Chat<UIMessage>({
          id: chatId,
          messages: [],
          transport: createRuntimeTransport(),
          onError: (err) => {
            toast.error(i18n.t("chat.replyFailed", { message: err.message }))
          },
        }),
        loaded: chatId === DRAFT_CHAT_ID,
        sending: false,
      }
      sessionsRef.current.set(chatId, session)
      return session
    }

    async function ensureLoaded(chatId: string) {
      const session = getSession(chatId)
      if (session.loaded) return
      if (
        session.chat.messages.length > 0 ||
        isStreamingStatus(session.chat.status)
      ) {
        session.loaded = true
        return
      }
      if (session.loading) return session.loading

      session.loading = listChatMessages(chatId)
        .then((messages) => {
          if (
            session.chat.messages.length > 0 ||
            isStreamingStatus(session.chat.status)
          ) {
            session.loaded = true
            return
          }
          session.chat.messages = chatMessagesToUIMessages(messages)
          session.loaded = true
        })
        .finally(() => {
          session.loading = undefined
        })

      return session.loading
    }

    function markLoaded(chatId: string) {
      getSession(chatId).loaded = true
    }

    function removeSession(chatId: string) {
      const session = sessionsRef.current.get(chatId)
      void session?.chat.stop()
      sessionsRef.current.delete(chatId)
    }

    return { getSession, ensureLoaded, markLoaded, removeSession }
  }, [])

  useEffect(() => {
    const sessions = sessionsRef.current
    return () => {
      sessions.forEach((session) => {
        void session.chat.stop()
      })
      sessions.clear()
    }
  }, [])

  return (
    <ChatRuntimeContext.Provider value={runtime}>
      {children}
    </ChatRuntimeContext.Provider>
  )
}
