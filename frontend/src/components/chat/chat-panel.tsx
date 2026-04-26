import { useEffect, useMemo, useRef, useState } from "react"
import { createOpenAI } from "@ai-sdk/openai"
import { useChat } from "@ai-sdk/react"
import { convertToModelMessages, streamText } from "ai"
import type { ChatTransport, UIMessage } from "ai"
import { ArrowUp, Square } from "lucide-react"

import { getToken } from "@/lib/auth-client"
import {
  appendChatMessage,
  textFromUIMessage,
  uiMessageToMessageParts,
  type ChatMessage,
} from "@/lib/chats-client"
import { Button } from "@/components/ui/button"
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import { Loader } from "@/components/ui/loader"
import { Message, MessageContent } from "@/components/ui/message"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import { ScrollButton } from "@/components/ui/scroll-button"

const CHAT_MODEL = "gpt-5.5"

type ChatPanelProps = {
  chatId?: string
  initialMessages: UIMessage[]
  initialMessagesChatId?: string
  loading: boolean
  error: string | null
  onCreateChat: (text: string) => Promise<string>
  onPersistedMessage: (message: ChatMessage) => void
  onError: (message: string | null) => void
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user"
  const text = textFromUIMessage(message)
  if (!text) return null

  if (isUser) {
    return (
      <Message className="flex-row-reverse items-start justify-start">
        <MessageContent className="max-w-[85%] bg-muted px-3.5 py-2 text-foreground dark:text-white">
          {text}
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message className="items-start">
      <MessageContent
        markdown
        className="w-full bg-transparent p-0 break-words text-foreground dark:text-white"
      >
        {text}
      </MessageContent>
    </Message>
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

export function ChatPanel({
  chatId,
  initialMessages,
  initialMessagesChatId,
  loading,
  error: pageError,
  onCreateChat,
  onPersistedMessage,
  onError,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const sendingRef = useRef(false)

  const transport = useMemo<ChatTransport<UIMessage>>(
    () => ({
      async sendMessages({ messages, abortSignal, body }) {
        const targetChatId = chatIdFromBody(body, chatId)
        if (!targetChatId) throw new Error("缺少对话 ID")

        const userMessage = [...messages]
          .reverse()
          .find((message) => message.role === "user")
        if (userMessage && shouldPersistUserMessage(body)) {
          const saved = await appendChatMessage(
            targetChatId,
            "user",
            uiMessageToMessageParts(userMessage)
          )
          onPersistedMessage(saved)
        }

        const token = getToken()
        if (!token) throw new Error("未登录")
        const openai = createOpenAI({
          apiKey: token,
          baseURL: `${window.location.origin}/v1`,
        })

        const result = streamText({
          model: openai.responses(CHAT_MODEL),
          messages: await convertToModelMessages(messages),
          abortSignal,
        })

        return result.toUIMessageStream({
          originalMessages: messages,
          onFinish: async ({ responseMessage }) => {
            const saved = await appendChatMessage(
              targetChatId,
              "assistant",
              uiMessageToMessageParts(responseMessage)
            )
            onPersistedMessage(saved)
          },
        })
      },
      async reconnectToStream() {
        return null
      },
    }),
    [chatId, onPersistedMessage]
  )

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error: chatError,
    clearError,
  } = useChat({
    messages: initialMessages,
    transport,
    onError: (err) => {
      onError(`生成回复失败：${err.message}`)
    },
  })

  const isBusy = status === "submitted" || status === "streaming"
  const visibleError = pageError ?? chatError?.message ?? null

  const prevChatIdRef = useRef<string | undefined>(chatId)
  useEffect(() => {
    const prevChatId = prevChatIdRef.current
    prevChatIdRef.current = chatId

    if (isBusy || sendingRef.current) {
      return
    }

    if (prevChatId === undefined && chatId !== undefined) {
      clearError()
      return
    }

    if (initialMessagesChatId !== chatId) {
      setMessages([])
      clearError()
      return
    }
    setMessages(initialMessages)
    clearError()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, initialMessagesChatId, initialMessages, isBusy])

  async function submit() {
    const text = input.trim()
    if (!text || isBusy || sendingRef.current) return

    setInput("")
    onError(null)
    clearError()
    let savedUser: ChatMessage | null = null
    sendingRef.current = true
    try {
      const targetChatId = chatId ?? (await onCreateChat(text))
      savedUser = await appendChatMessage(targetChatId, "user", [
        { type: "text", text },
      ])
      const sendPromise = sendMessage(
        {
          id: savedUser.id,
          role: "user",
          parts: [{ type: "text", text }],
        },
        { body: { chatId: targetChatId, skipPersistUser: true } }
      )
      onPersistedMessage(savedUser)
      await sendPromise
    } catch (err) {
      if (!savedUser) setInput(text)
      onError(err instanceof Error ? err.message : "发送失败")
    } finally {
      sendingRef.current = false
    }
  }

  function renderBody() {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      )
    }
    if (messages.length === 0 && !isBusy && !visibleError) {
      return (
        <div className="flex flex-1 flex-col justify-center gap-3 pb-24">
          <h1 className="text-2xl font-semibold tracking-normal">
            今天想聊什么？
          </h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            输入第一条消息后会创建新对话。历史记录会保存在左侧列表中。
          </p>
        </div>
      )
    }
    return messages.map((message) => (
      <MessageBubble key={message.id} message={message} />
    ))
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ChatContainerRoot className="flex-1">
        <ChatContainerContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6">
          {renderBody()}
          {isBusy && (
            <Message className="items-start">
              <Loader variant="dots" />
            </Message>
          )}
          {visibleError && (
            <Message className="items-start">
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {visibleError}
              </div>
            </Message>
          )}
          <ChatContainerScrollAnchor />
        </ChatContainerContent>
        <div className="absolute right-6 bottom-28">
          <ScrollButton />
        </div>
      </ChatContainerRoot>

      <div className="bg-background/85 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <PromptInput
            value={input}
            onValueChange={setInput}
            onSubmit={() => void submit()}
            isLoading={isBusy}
            className="bg-popover"
          >
            <PromptInputTextarea placeholder="输入消息，Enter 发送，Shift+Enter 换行" />
            <PromptInputActions className="mt-2 justify-end">
              <PromptInputAction tooltip={isBusy ? "停止生成" : "发送"}>
                {isBusy ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label="停止生成"
                    onClick={() => void stop()}
                  >
                    <Square />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label="发送"
                    disabled={!input.trim()}
                    onClick={() => void submit()}
                  >
                    <ArrowUp />
                  </Button>
                )}
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            模型可能会产生不准确的信息，请谨慎核对。
          </p>
        </div>
      </div>
    </div>
  )
}
