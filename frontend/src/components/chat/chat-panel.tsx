import { useEffect, useMemo, useRef, useState } from "react"
import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai"
import { useChat } from "@ai-sdk/react"
import { convertToModelMessages, streamText } from "ai"
import type { ChatTransport, UIMessage } from "ai"
import { ArrowUp, Paperclip, Plus, Square, X } from "lucide-react"

import { getToken } from "@/lib/auth-client"
import {
  appendChatMessage,
  textFromUIMessage,
  uiMessageToMessageParts,
  uploadChatAttachment,
  type ChatAttachment,
  type ChatMessage,
  type MessagePart,
} from "@/lib/chats-client"
import { Button } from "@/components/ui/button"
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
const ACCEPT_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"]
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_ATTACHMENTS = 4

type LocalAttachment = ChatAttachment & {
  dataUrl: string
}

type FileUIPart = {
  type: "file"
  mediaType: string
  url: string
  filename?: string
}

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
        reject(new Error("读取文件失败"))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"))
    reader.readAsDataURL(blob)
  })
}

async function fetchChatMediaAsDataURL(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) throw new Error("图片加载失败")

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

          const modelPart = { ...part }
          return {
            ...modelPart,
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

function ChatImage({
  part,
  imageClassName,
  placeholderClassName,
}: {
  part: FileUIPart
  imageClassName: string
  placeholderClassName: string
}) {
  const localMedia = isLocalChatMediaURL(part.url)
  const directSrc = isInlineImageURL(part.url, part.mediaType) ? part.url : null
  const [fetched, setFetched] = useState<{
    url: string
    src: string | null
    failed: boolean
  } | null>(null)
  const fetchedMatches = fetched?.url === part.url
  const src = directSrc ?? (fetchedMatches ? fetched.src : null)
  const failed = !directSrc && fetchedMatches && fetched.failed

  useEffect(() => {
    let cancelled = false

    if (directSrc || !localMedia) {
      return
    }

    const token = getToken()
    if (!token) {
      queueMicrotask(() => {
        if (!cancelled) {
          setFetched({ url: part.url, src: null, failed: true })
        }
      })
      return
    }

    fetchChatMediaAsDataURL(part.url, token)
      .then((dataUrl) => {
        if (!cancelled) setFetched({ url: part.url, src: dataUrl, failed: false })
      })
      .catch(() => {
        if (!cancelled) setFetched({ url: part.url, src: null, failed: true })
      })

    return () => {
      cancelled = true
    }
  }, [directSrc, localMedia, part.url])

  if (!directSrc && !localMedia) return null

  return (
    <a
      href={src || undefined}
      target="_blank"
      rel="noreferrer noopener"
      className="block"
      onClick={(event) => {
        if (!src) event.preventDefault()
      }}
    >
      {src ? (
        <img
          src={src}
          alt={part.filename ?? "uploaded image"}
          className={imageClassName}
        />
      ) : (
        <div className={placeholderClassName}>
          {failed ? (
            <span className="px-2 text-center text-xs">图片加载失败</span>
          ) : (
            <Loader variant="circular" size="sm" />
          )}
        </div>
      )}
    </a>
  )
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user"
  const text = textFromUIMessage(message)
  const images = message.parts.filter(isImageFilePart)

  if (isUser) {
    if (!text && images.length === 0) return null

    return (
      <Message className="flex-row-reverse items-start justify-start">
        <div className="flex max-w-[85%] flex-col items-end gap-2">
          {images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {images.map((image, index) => (
                <ChatImage
                  key={`${image.url}-${index}`}
                  part={image}
                  imageClassName="max-h-60 max-w-60 rounded-md border border-border object-cover"
                  placeholderClassName="flex h-24 w-24 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
                />
              ))}
            </div>
          )}
          {text && (
            <MessageContent className="bg-muted px-3.5 py-2 text-foreground dark:text-white">
              {text}
            </MessageContent>
          )}
        </div>
      </Message>
    )
  }

  if (!text) return null

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
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
        const modelMessages = await inlineChatFilesForModel(messages, token)

        const result = streamText({
          model: openai.responses(CHAT_MODEL),
          messages: await convertToModelMessages(modelMessages),
          abortSignal,
          providerOptions: {
            openai: {
              store: false,
            } satisfies OpenAILanguageModelResponsesOptions,
          },
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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || uploading) return

    setUploadError(null)
    const slots = MAX_ATTACHMENTS - attachments.length
    if (slots <= 0) {
      setUploadError(`最多可上传 ${MAX_ATTACHMENTS} 张图片`)
      return
    }
    if (files.length > slots) {
      setUploadError(`最多可上传 ${MAX_ATTACHMENTS} 张图片`)
    }

    const picked = Array.from(files).slice(0, slots)
    setUploading(true)
    try {
      for (const file of picked) {
        if (!ACCEPT_MIME.includes(file.type)) {
          setUploadError("仅支持 PNG / JPEG / WebP / GIF")
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          setUploadError("单张图片不能超过 5MB")
          continue
        }

        try {
          const [uploaded, dataUrl] = await Promise.all([
            uploadChatAttachment(file),
            readBlobAsDataURL(file),
          ])
          setAttachments((prev) => [...prev, { ...uploaded, dataUrl }])
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : "上传失败")
        }
      }
    } finally {
      setUploading(false)
    }
  }

  function removeAttachment(url: string) {
    setAttachments((prev) => prev.filter((item) => item.url !== url))
  }

  async function submit() {
    const text = input.trim()
    const pendingAttachments = attachments
    if (
      (!text && pendingAttachments.length === 0) ||
      isBusy ||
      uploading ||
      sendingRef.current
    ) {
      return
    }

    setInput("")
    setAttachments([])
    setUploadError(null)
    onError(null)
    clearError()
    let savedUser: ChatMessage | null = null
    sendingRef.current = true
    try {
      const titleSeed = text || pendingAttachments[0]?.name || "图片消息"
      const targetChatId = chatId ?? (await onCreateChat(titleSeed))
      const storageParts: MessagePart[] = [
        ...pendingAttachments.map((attachment) => ({
          type: "file" as const,
          mediaType: attachment.mediaType,
          url: attachment.url,
          filename: attachment.name,
        })),
        ...(text ? [{ type: "text" as const, text }] : []),
      ]
      const modelParts: UIMessage["parts"] = [
        ...pendingAttachments.map((attachment) => ({
          type: "file" as const,
          mediaType: attachment.mediaType,
          url: attachment.dataUrl,
          filename: attachment.name,
        })),
        ...(text ? [{ type: "text" as const, text }] : []),
      ]

      savedUser = await appendChatMessage(targetChatId, "user", storageParts)
      const sendPromise = sendMessage(
        {
          id: savedUser.id,
          role: "user",
          parts: modelParts,
        },
        { body: { chatId: targetChatId, skipPersistUser: true } }
      )
      onPersistedMessage(savedUser)
      await sendPromise
    } catch (err) {
      if (!savedUser) {
        setInput(text)
        setAttachments(pendingAttachments)
      }
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
            {(attachments.length > 0 || uploading) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.url}
                    className="group relative h-16 w-16 overflow-hidden rounded-md border border-border bg-muted"
                  >
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      aria-label="移除图片"
                      onClick={(event) => {
                        event.stopPropagation()
                        removeAttachment(attachment.url)
                      }}
                      className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/85 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {uploading && (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                    <Loader variant="circular" size="sm" />
                  </div>
                )}
              </div>
            )}
            <PromptInputTextarea placeholder="输入消息，Enter 发送，Shift+Enter 换行" />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_MIME.join(",")}
              className="hidden"
              onChange={(event) => {
                void handleFiles(event.target.files)
                event.target.value = ""
              }}
            />
            <PromptInputActions className="mt-2 justify-between">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="更多工具"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Plus />
                    </Button>
                  }
                />
                <DropdownMenuContent
                  align="start"
                  side="top"
                  className="!w-auto min-w-48"
                >
                  <DropdownMenuItem
                    disabled={
                      uploading || attachments.length >= MAX_ATTACHMENTS
                    }
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="mr-2 size-4" />
                    添加图片
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                    disabled={
                      uploading || (!input.trim() && attachments.length === 0)
                    }
                    onClick={() => void submit()}
                  >
                    <ArrowUp />
                  </Button>
                )}
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
          {uploadError && (
            <p className="mt-2 text-center text-xs text-destructive">
              {uploadError}
            </p>
          )}
          <p className="mt-2 text-center text-xs text-muted-foreground">
            模型可能会产生不准确的信息，请谨慎核对。
          </p>
        </div>
      </div>
    </div>
  )
}
