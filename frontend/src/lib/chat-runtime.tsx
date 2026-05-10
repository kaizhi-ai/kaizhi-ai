import { useEffect, useMemo, useRef, type ReactNode } from "react"
import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai"
import { Chat } from "@ai-sdk/react"
import { convertToModelMessages, stepCountIs, streamText } from "ai"
import type { ChatTransport, ToolSet } from "ai"
import { toast } from "sonner"

import {
  ChatRuntimeContext,
  DRAFT_CHAT_ID,
  isStreamingStatus,
  type ChatRuntime,
  type RuntimeSession,
} from "@/lib/chat-runtime-context"
import type { ChatToolSet, ChatUIMessage } from "@/lib/chat-types"
import { appendChatMessage, getToken, listChatMessages } from "@/lib/client"
import i18n from "@/lib/i18n"

const CHAT_MODEL = "gpt-5.5"
const ACCEPT_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"]
const DATA_IMAGE_URL_RE = /^data:([^;,]+);base64,(.*)$/is
const GENERATED_IMAGE_TOOL_TYPE = "tool-image_generation"

type GeneratedImageOutputPart = Extract<
  ChatUIMessage["parts"][number],
  { type: "tool-image_generation"; state: "output-available" }
>

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

function shouldUseImageGeneration(body: unknown) {
  if (body && typeof body === "object" && "imageGeneration" in body) {
    return (body as { imageGeneration?: unknown }).imageGeneration === true
  }
  return true
}

function isGeneratedImageOutputPart(
  part: ChatUIMessage["parts"][number]
): part is GeneratedImageOutputPart {
  if (part.type !== GENERATED_IMAGE_TOOL_TYPE) return false
  if (part.state !== "output-available" || part.preliminary === true) {
    return false
  }
  return (
    typeof part.output.result === "string" && part.output.result.trim() !== ""
  )
}

function generatedImageOutputToFilePart(part: GeneratedImageOutputPart) {
  const result = part.output.result.trim()
  const dataURLMatch = DATA_IMAGE_URL_RE.exec(result)
  const mediaType = dataURLMatch?.[1].toLowerCase() ?? "image/webp"
  if (!ACCEPT_MIME.includes(mediaType)) return null

  const imageURL = dataURLMatch
    ? `data:${mediaType};base64,${dataURLMatch[2].replace(/\s/g, "")}`
    : `data:${mediaType};base64,${result.replace(/\s/g, "")}`

  return {
    type: "file" as const,
    mediaType,
    url: imageURL,
    filename: `generated-image.${mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length)}`,
  }
}

function withGeneratedImageReferenceMessages(
  messages: ChatUIMessage[]
): ChatUIMessage[] {
  const out: ChatUIMessage[] = []
  let imageIndex = 0

  for (const message of messages) {
    out.push(message)

    for (const part of message.parts) {
      if (!isGeneratedImageOutputPart(part)) continue

      const filePart = generatedImageOutputToFilePart(part)
      if (!filePart) continue

      imageIndex += 1
      out.push({
        id: `${message.id}-generated-image-context-${imageIndex}`,
        role: "user",
        parts: [
          {
            type: "text",
            text: `Reference image ${imageIndex} generated earlier by the assistant.`,
          },
          filePart,
        ],
      })
    }
  }

  return out
}

function createImageGenerationTool(openai: ReturnType<typeof createOpenAI>) {
  const imageGeneration = openai.tools.imageGeneration({
    model: "gpt-image-2",
    size: "auto",
    quality: "auto",
    outputFormat: "webp",
  })

  imageGeneration.toModelOutput = ({ output }) => {
    const result = output.result
    const trimmed = result.trim()
    if (!trimmed) {
      return {
        type: "json" as const,
        value: { result },
      }
    }

    const dataURLMatch = DATA_IMAGE_URL_RE.exec(trimmed)
    const mediaType = dataURLMatch?.[1].toLowerCase() ?? "image/webp"
    if (!ACCEPT_MIME.includes(mediaType)) {
      return {
        type: "json" as const,
        value: { result },
      }
    }

    return {
      type: "content" as const,
      value: [
        {
          type: "image-data" as const,
          data: (dataURLMatch?.[2] ?? trimmed).replace(/\s/g, ""),
          mediaType,
        },
      ],
    }
  }

  return imageGeneration
}

function activeToolsFromOptions(
  tools: ChatToolSet,
  body: unknown
): ToolSet | undefined {
  const activeTools = {
    ...(shouldUseWebSearch(body) ? { web_search: tools.web_search } : {}),
    ...(shouldUseImageGeneration(body)
      ? { image_generation: tools.image_generation }
      : {}),
  }

  return Object.keys(activeTools).length > 0 ? activeTools : undefined
}

function createRuntimeTransport(): ChatTransport<ChatUIMessage> {
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
        await appendChatMessage(targetChatId, userMessage)
      }

      const token = getToken()
      if (!token) throw new Error(i18n.t("errors.notLoggedIn"))
      const openai = createOpenAI({
        apiKey: token,
        baseURL: `${window.location.origin}/v1`,
      })
      const tools: ChatToolSet = {
        web_search: openai.tools.webSearch(),
        image_generation: createImageGenerationTool(openai),
      }
      const activeTools = activeToolsFromOptions(tools, body)
      const modelInputMessages = withGeneratedImageReferenceMessages(messages)

      const result = streamText({
        model: openai.responses(CHAT_MODEL),
        messages: await convertToModelMessages<ChatUIMessage>(
          modelInputMessages,
          {
            tools,
          }
        ),
        tools: activeTools,
        stopWhen: activeTools ? stepCountIs(5) : undefined,
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
          try {
            await appendChatMessage(targetChatId, responseMessage)
          } catch (err) {
            toast.error(
              err instanceof Error && err.message
                ? err.message
                : i18n.t("errors.saveFailed")
            )
          }
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
        chat: new Chat<ChatUIMessage>({
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
          session.chat.messages = messages
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
