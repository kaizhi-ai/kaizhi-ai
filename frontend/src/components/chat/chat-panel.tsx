import { useEffect, useRef, useState } from "react"
import type { UIMessage } from "ai"
import {
  ArrowUp,
  Globe,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Square,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { getToken } from "@/lib/auth-client"
import {
  appendChatMessage,
  chatMessagesToUIMessages,
  createChat,
  draftTitleFromText,
  textFromUIMessage,
  uploadChatAttachment,
  type ChatAttachment,
  type ChatMessage,
  type MessagePart,
} from "@/lib/chats-client"
import { DRAFT_CHAT_ID, isStreamingStatus } from "@/lib/chat-runtime-context"
import i18n from "@/lib/i18n"
import { useRuntimeChat } from "@/lib/use-runtime-chat"
import { Button } from "@/components/ui/button"
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { AssistantMessageParts } from "@/components/chat/message-parts"

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

function ChatImage({
  part,
  imageClassName,
  placeholderClassName,
}: {
  part: FileUIPart
  imageClassName: string
  placeholderClassName: string
}) {
  const { t } = useTranslation()
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
        if (!cancelled)
          setFetched({ url: part.url, src: dataUrl, failed: false })
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
          alt={part.filename ?? t("chat.imageMessage")}
          className={imageClassName}
        />
      ) : (
        <div className={placeholderClassName}>
          {failed ? (
            <span className="px-2 text-center text-xs">
              {t("chat.imageLoadFailed")}
            </span>
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

  if (!hasRenderableAssistantParts(message.parts)) return null

  return (
    <Message className="items-start">
      <div className="w-full space-y-3 break-words text-foreground dark:text-white">
        <AssistantMessageParts parts={message.parts} />
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((image, index) => (
              <ChatImage
                key={`${image.url}-${index}`}
                part={image}
                imageClassName="max-h-[28rem] max-w-full rounded-md border border-border object-contain"
                placeholderClassName="flex h-40 w-40 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
              />
            ))}
          </div>
        )}
      </div>
    </Message>
  )
}

function hasRenderableAssistantParts(parts: UIMessage["parts"]) {
  return parts.some(
    (part) =>
      (part.type === "text" && Boolean(part.text)) ||
      part.type === "file" ||
      part.type === "tool-web_search" ||
      part.type === "tool-google_search" ||
      part.type === "tool-image_generation" ||
      part.type === "source-url"
  )
}

export function ChatPanel({ chatId }: ChatPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [webSearchEnabled, setWebSearchEnabled] = useState(true)
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { messages, status, stop, clearError, loadingMessages, runtime } =
    useRuntimeChat(chatId)

  const isBusy = status === "submitted" || status === "streaming"

  async function createChatForMessage(text: string) {
    const created = await createChat(draftTitleFromText(text))
    runtime.markLoaded(created.id)
    navigate(`/chat/${created.id}`, { replace: true })
    return created.id
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || uploading) return

    const slots = MAX_ATTACHMENTS - attachments.length
    if (slots <= 0) {
      toast.error(t("chat.maxImages", { count: MAX_ATTACHMENTS }))
      return
    }
    if (files.length > slots) {
      toast.error(t("chat.maxImages", { count: MAX_ATTACHMENTS }))
    }

    const picked = Array.from(files).slice(0, slots)
    setUploading(true)
    try {
      for (const file of picked) {
        if (!ACCEPT_MIME.includes(file.type)) {
          toast.error(t("chat.selectFiles"))
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          toast.error(t("chat.fileTooLarge"))
          continue
        }

        try {
          const [uploaded, dataUrl] = await Promise.all([
            uploadChatAttachment(file),
            readBlobAsDataURL(file),
          ])
          setAttachments((prev) => [...prev, { ...uploaded, dataUrl }])
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("errors.uploadFailed")
          )
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
    const activeSession = runtime.getSession(chatId ?? DRAFT_CHAT_ID)
    if (
      (!text && pendingAttachments.length === 0) ||
      activeSession.sending ||
      isStreamingStatus(activeSession.chat.status) ||
      loadingMessages ||
      uploading
    ) {
      return
    }

    setInput("")
    setAttachments([])
    clearError()
    let savedUser: ChatMessage | null = null
    let targetSession = activeSession
    activeSession.sending = true
    try {
      const titleSeed =
        text || pendingAttachments[0]?.name || t("chat.imageMessage")
      const targetChatId = chatId ?? (await createChatForMessage(titleSeed))
      const storageParts: MessagePart[] = [
        ...pendingAttachments.map((attachment) => ({
          type: "file" as const,
          mediaType: attachment.mediaType,
          url: attachment.url,
          filename: attachment.name,
        })),
        ...(text ? [{ type: "text" as const, text }] : []),
      ]
      targetSession = runtime.getSession(targetChatId)
      if (targetSession !== activeSession) {
        targetSession.sending = true
        activeSession.sending = false
      }
      targetSession.chat.clearError()
      savedUser = await appendChatMessage(targetChatId, "user", storageParts)
      const savedUserMessage = chatMessagesToUIMessages([savedUser])[0]
      if (!savedUserMessage) throw new Error(t("errors.sendFailed"))

      await targetSession.chat.sendMessage(
        savedUserMessage,
        {
          body: {
            chatId: targetChatId,
            skipPersistUser: true,
            webSearch: webSearchEnabled,
            imageGeneration: imageGenerationEnabled,
          },
        }
      )
    } catch (err) {
      if (!savedUser) {
        setInput(text)
        setAttachments(pendingAttachments)
        toast.error(err instanceof Error ? err.message : t("errors.sendFailed"))
      }
    } finally {
      targetSession.sending = false
      activeSession.sending = false
    }
  }

  function renderBody() {
    if (loadingMessages) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      )
    }
    if (messages.length === 0 && !isBusy) {
      return (
        <div className="flex flex-1 flex-col justify-center gap-3 pb-24">
          <h1 className="text-2xl font-semibold tracking-normal">
            {t("chat.newChatTitle")}
          </h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            {t("chat.newChatHelp")}
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      aria-label={t("chat.removeImage")}
                      onClick={(event) => {
                        event.stopPropagation()
                        removeAttachment(attachment.url)
                      }}
                      className="absolute top-1 right-1 rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
                {uploading && (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                    <Loader variant="circular" size="sm" />
                  </div>
                )}
              </div>
            )}
            <PromptInputTextarea placeholder={t("chat.textareaPlaceholder")} />
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
                      aria-label={t("chat.tools")}
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
                    {t("chat.addImage")}
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={webSearchEnabled}
                    onCheckedChange={setWebSearchEnabled}
                  >
                    <Globe className="mr-2 size-4" />
                    {t("chat.webSearch")}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={imageGenerationEnabled}
                    onCheckedChange={setImageGenerationEnabled}
                  >
                    <ImageIcon className="mr-2 size-4" />
                    {t("chat.imageGeneration")}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <PromptInputAction
                tooltip={isBusy ? t("chat.stop") : t("chat.send")}
              >
                {isBusy ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label={t("chat.stop")}
                    onClick={() => void stop()}
                  >
                    <Square />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label={t("chat.send")}
                    disabled={
                      loadingMessages ||
                      uploading ||
                      (!input.trim() && attachments.length === 0)
                    }
                    onClick={() => void submit()}
                  >
                    <ArrowUp />
                  </Button>
                )}
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {t("chat.disclaimer")}
          </p>
        </div>
      </div>
    </div>
  )
}
