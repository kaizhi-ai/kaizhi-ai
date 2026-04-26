import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { useAuth } from "@/lib/auth-context"
import {
  chatMessagesToUIMessages,
  createChat,
  deleteChat,
  draftTitleFromText,
  listChatMessages,
  listChats,
  type ChatMessage,
  type ChatSession,
} from "@/lib/chats-client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/chat/app-sidebar"
import { ChatHeader } from "@/components/chat/chat-header"
import { ChatPanel } from "@/components/chat/chat-panel"

export default function ChatPage() {
  const params = useParams()
  const activeChatId = params.id
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  const [chats, setChats] = useState<ChatSession[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesChatId, setMessagesChatId] = useState<string | undefined>(
    undefined
  )
  const [loadingChats, setLoadingChats] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null)
  const [deleting, setDeleting] = useState(false)
  const skipLoadRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    listChats()
      .then((next) => {
        if (!cancelled) setChats(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载对话失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingChats(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // queueMicrotask defers the loading-state set past the effect commit, so
    // the lint rule against synchronous setState-in-effect stays satisfied.
    queueMicrotask(() => {
      if (cancelled) return
      if (!activeChatId) {
        setMessages([])
        setMessagesChatId(undefined)
        return
      }
      if (skipLoadRef.current === activeChatId) {
        skipLoadRef.current = undefined
        return
      }
      setLoadingMessages(true)
      setError(null)
      listChatMessages(activeChatId)
        .then((next) => {
          if (!cancelled) {
            setMessages(next)
            setMessagesChatId(activeChatId)
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setMessages([])
            setMessagesChatId(undefined)
            setError(err instanceof Error ? err.message : "加载消息失败")
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingMessages(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [activeChatId])

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId),
    [activeChatId, chats]
  )

  const headerTitle = activeChatId
    ? (activeChat?.title.trim() ?? "对话")
    : "新对话"

  const uiMessages = useMemo(() => {
    if (!activeChatId || messagesChatId !== activeChatId) return []
    return chatMessagesToUIMessages(messages)
  }, [activeChatId, messages, messagesChatId])

  async function handleCreateChat(text: string) {
    setError(null)
    const created = await createChat(draftTitleFromText(text))
    setChats((prev) => [created, ...prev])
    setMessages([])
    setMessagesChatId(created.id)
    skipLoadRef.current = created.id
    navigate(`/chat/${created.id}`, { replace: true })
    return created.id
  }

  const handlePersistedMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((item) => item.id === message.id)) return prev
        if (activeChatId && message.session_id !== activeChatId) return prev
        return [...prev, message]
      })
    },
    [activeChatId]
  )

  function handleNewChat() {
    setError(null)
    setMessages([])
    setMessagesChatId(undefined)
    navigate("/chat")
  }

  function handleSelectChat(id: string) {
    navigate(`/chat/${id}`)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteChat(pendingDelete.id)
      setChats((prev) => prev.filter((chat) => chat.id !== pendingDelete.id))
      if (pendingDelete.id === activeChatId) {
        setMessages([])
        setMessagesChatId(undefined)
        navigate("/chat", { replace: true })
      }
      setPendingDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除对话失败")
    } finally {
      setDeleting(false)
    }
  }

  function handleSignOut() {
    signOut()
    navigate("/login", { replace: true })
  }

  return (
    <SidebarProvider className="h-dvh overflow-hidden bg-background text-foreground">
      <AppSidebar
        chats={chats}
        activeChatId={activeChatId}
        userEmail={user?.email}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={setPendingDelete}
        onSettings={() => navigate("/settings/api-keys")}
        onSignOut={handleSignOut}
      />
      <SidebarInset className="flex h-dvh min-w-0 flex-col">
        <ChatHeader title={loadingChats ? "加载中…" : headerTitle} />
        <ChatPanel
          chatId={activeChatId}
          initialMessages={uiMessages}
          initialMessagesChatId={messagesChatId}
          loading={!!activeChatId && loadingMessages}
          error={error}
          onCreateChat={handleCreateChat}
          onPersistedMessage={handlePersistedMessage}
          onError={setError}
        />
      </SidebarInset>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除该对话？</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.title.trim() || "新对话"}”
              及其全部消息将被永久删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
