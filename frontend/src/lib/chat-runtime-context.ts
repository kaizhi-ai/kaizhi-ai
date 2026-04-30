import { createContext, useContext } from "react"
import type { Chat } from "@ai-sdk/react"
import type { ChatStatus, UIMessage } from "ai"

export const DRAFT_CHAT_ID = "__draft_chat__"

export type RuntimeSession = {
  chat: Chat<UIMessage>
  loaded: boolean
  loading?: Promise<void>
  sending: boolean
}

export type ChatRuntime = {
  getSession: (chatId: string) => RuntimeSession
  ensureLoaded: (chatId: string) => Promise<void>
  markLoaded: (chatId: string) => void
  removeSession: (chatId: string) => void
}

export const ChatRuntimeContext = createContext<ChatRuntime | null>(null)

export function isStreamingStatus(status: ChatStatus) {
  return status === "submitted" || status === "streaming"
}

export function useChatRuntime() {
  const runtime = useContext(ChatRuntimeContext)
  if (!runtime) throw new Error("ChatRuntimeProvider is missing")
  return runtime
}
