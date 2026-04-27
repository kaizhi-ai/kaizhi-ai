import {
  ArrowLeft,
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Settings,
  Shield,
} from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"

import { useAuth } from "@/lib/auth-context"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export function SettingsSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, signOut } = useAuth()
  const displayName =
    user?.name?.trim() || user?.email?.split("@")[0] || "未登录"
  const initial = (displayName || user?.email || "?").charAt(0).toUpperCase()

  function handleSignOut() {
    signOut()
    navigate("/login", { replace: true })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2 overflow-hidden px-1 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="truncate text-sm font-semibold whitespace-nowrap group-data-[collapsible=icon]:hidden">
            设置
          </span>
          <SidebarTrigger className="shrink-0" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="返回聊天"
                  onClick={() => navigate("/chat")}
                >
                  <ArrowLeft />
                  <span>返回聊天</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="通用"
                  isActive={location.pathname.startsWith("/settings/general")}
                  onClick={() => navigate("/settings/general")}
                >
                  <Settings />
                  <span>通用</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="API Keys"
                  isActive={location.pathname.startsWith("/settings/api-keys")}
                  onClick={() => navigate("/settings/api-keys")}
                >
                  <KeyRound />
                  <span>API Keys</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
                    tooltip={user?.email ?? "未登录"}
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
                  {user?.email && (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  )}
                </div>
                <ChevronsUpDown className="ml-auto text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                {user?.role === "admin" && (
                  <DropdownMenuItem onClick={() => navigate("/admin")}>
                    <Shield />
                    后台管理
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
