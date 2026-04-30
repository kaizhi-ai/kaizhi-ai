import { useEffect, useRef, useState } from "react"
import { MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { useChatRuntime } from "@/lib/chat-runtime-context"
import { deleteChat, listChats, type ChatSession } from "@/lib/chats-client"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { ChatHeader } from "@/components/chat/chat-header"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SidebarUserFooter } from "@/components/sidebar-user-footer"

function displayTitle(chat: ChatSession, fallback: string) {
  return chat.title.trim() || fallback
}

type ChatSidebarProps = {
  chats: ChatSession[]
  activeChatId: string | undefined
  onDeleteChat: (chat: ChatSession) => void
}

function ChatSidebar({ chats, activeChatId, onDeleteChat }: ChatSidebarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()

  function handleNavigate(path: string) {
    navigate(path)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2 overflow-hidden px-1 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="truncate text-sm font-semibold whitespace-nowrap group-data-[collapsible=icon]:hidden">
            Kaizhi Chat
          </span>
          <SidebarTrigger className="shrink-0" />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("chat.newChat")}
              onClick={() => handleNavigate("/chat")}
            >
              <Plus />
              <span>{t("chat.newChat")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{t("chat.recent")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.map((chat) => {
                const isActive = chat.id === activeChatId
                return (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => handleNavigate(`/chat/${chat.id}`)}
                    >
                      <span className="truncate">
                        {displayTitle(chat, t("chat.newChat"))}
                      </span>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <SidebarMenuAction
                            showOnHover
                            aria-label={t("common.moreActions")}
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start">
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onDeleteChat(chat)}
                        >
                          <Trash2 />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarUserFooter />
    </Sidebar>
  )
}

export default function ChatPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const chatRuntime = useChatRuntime()
  const params = useParams()
  const activeChatId = params.id
  const [chats, setChats] = useState<ChatSession[]>([])
  const [loadingChats, setLoadingChats] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null)
  const [deleting, setDeleting] = useState(false)
  const refreshedChatIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    listChats()
      .then((next) => {
        if (!cancelled) setChats(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : t("errors.loadChatsFailed")
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingChats(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    if (
      !activeChatId ||
      loadingChats ||
      chats.some((chat) => chat.id === activeChatId)
    ) {
      return
    }
    if (refreshedChatIdRef.current === activeChatId) return

    let cancelled = false
    refreshedChatIdRef.current = activeChatId
    listChats()
      .then((next) => {
        if (!cancelled) setChats(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : t("errors.loadChatsFailed")
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeChatId, chats, loadingChats, t])

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteChat(pendingDelete.id)
      chatRuntime.removeSession(pendingDelete.id)
      setChats((prev) => prev.filter((chat) => chat.id !== pendingDelete.id))
      if (pendingDelete.id === activeChatId) {
        navigate("/chat", { replace: true })
      }
      setPendingDelete(null)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("errors.deleteChatFailed")
      )
    } finally {
      setDeleting(false)
    }
  }

  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const headerTitle = activeChatId
    ? activeChat?.title.trim() || t("chat.title")
    : t("chat.newChat")

  return (
    <SidebarProvider className="h-dvh overflow-hidden bg-background text-foreground">
      <ChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        onDeleteChat={setPendingDelete}
      />

      <SidebarInset className="flex h-dvh min-w-0 flex-col">
        <ChatHeader title={headerTitle} />
        <ChatPanel chatId={activeChatId} />
      </SidebarInset>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("chat.deleteDescription", {
                title: pendingDelete?.title.trim() || t("chat.newChat"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
