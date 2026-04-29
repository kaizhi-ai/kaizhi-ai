import {
  ChevronsUpDown,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  Shield,
  Trash2,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ChatSession } from "@/lib/chats-client"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar"

type AppSidebarProps = {
  chats: ChatSession[]
  activeChatId?: string
  userName?: string
  userEmail?: string
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (chat: ChatSession) => void
  onSettings: () => void
  onAdmin?: () => void
  onSignOut: () => void
  isAdmin?: boolean
}

function displayTitle(chat: ChatSession, fallback: string) {
  return chat.title.trim() || fallback
}

export function AppSidebar({
  chats,
  activeChatId,
  userName,
  userEmail,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onSettings,
  onAdmin,
  onSignOut,
  isAdmin = false,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const displayName =
    userName?.trim() || userEmail?.split("@")[0] || t("nav.notSignedIn")
  const initial = (displayName || userEmail || "?").charAt(0).toUpperCase()

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
            <SidebarMenuButton tooltip={t("chat.newChat")} onClick={onNewChat}>
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
                      onClick={() => onSelectChat(chat.id)}
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
      <SidebarFooter className="border-t border-sidebar-border p-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    tooltip={userEmail ?? t("nav.notSignedIn")}
                    size="lg"
                    className="h-16 rounded-none px-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!px-0"
                  />
                }
              >
                <Avatar size="sm">
                  <AvatarFallback>{initial}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col items-start group-data-[collapsible=icon]:hidden">
                  <span className="w-full truncate text-sm font-medium">
                    {displayName}
                  </span>
                  {userEmail && (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {userEmail}
                    </span>
                  )}
                </div>
                <ChevronsUpDown className="ml-auto text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem onClick={onSettings}>
                  <Settings />
                  {t("nav.settings")}
                </DropdownMenuItem>
                {isAdmin && onAdmin && (
                  <DropdownMenuItem onClick={onAdmin}>
                    <Shield />
                    {t("nav.admin")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOut />
                  {t("nav.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
