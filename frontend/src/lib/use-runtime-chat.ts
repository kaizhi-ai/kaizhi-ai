import { useEffect, useMemo, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { toast } from "sonner"

import {
  DRAFT_CHAT_ID,
  isStreamingStatus,
  useChatRuntime,
} from "@/lib/chat-runtime-context"
import i18n from "@/lib/i18n"

export function useRuntimeChat(chatId?: string) {
  const runtime = useChatRuntime()
  const activeChatId = chatId ?? DRAFT_CHAT_ID
  const session = useMemo(
    () => runtime.getSession(activeChatId),
    [activeChatId, runtime]
  )
  const chat = useChat({ chat: session.chat })
  const { setMessages } = chat
  const [loadingMessages, setLoadingMessages] = useState(false)

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      if (!chatId) {
        setLoadingMessages(false)
        return
      }

      const targetSession = runtime.getSession(chatId)
      if (
        targetSession.loaded ||
        targetSession.chat.messages.length > 0 ||
        isStreamingStatus(targetSession.chat.status)
      ) {
        setMessages(targetSession.chat.messages)
        setLoadingMessages(false)
        return
      }

      setLoadingMessages(true)
      runtime
        .ensureLoaded(chatId)
        .then(() => {
          if (!cancelled) {
            setMessages(runtime.getSession(chatId).chat.messages)
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            toast.error(
              err instanceof Error
                ? err.message
                : i18n.t("errors.loadMessagesFailed")
            )
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingMessages(false)
        })
    })

    return () => {
      cancelled = true
    }
  }, [chatId, runtime, setMessages])

  return {
    ...chat,
    loadingMessages,
    runtime,
  }
}
