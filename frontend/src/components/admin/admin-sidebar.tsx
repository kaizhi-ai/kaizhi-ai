import {
  ArrowLeft,
  ChevronsUpDown,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  Settings,
  Users,
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

export function AdminSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, signOut } = useAuth()
  const displayName = user?.email?.split("@")[0] || "未登录"
  const initial = (user?.email || "?").charAt(0).toUpperCase()

  function handleSignOut() {
    signOut()
    navigate("/login", { replace: true })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2 overflow-hidden px-1 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="truncate text-sm font-semibold whitespace-nowrap group-data-[collapsible=icon]:hidden">
            后台管理
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
                  tooltip="用户管理"
                  isActive={location.pathname.startsWith("/admin/users")}
                  onClick={() => navigate("/admin/users")}
                >
                  <Users />
                  <span>用户管理</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="API Key Provider"
                  isActive={location.pathname.startsWith(
                    "/admin/api-key-provider"
                  )}
                  onClick={() => navigate("/admin/api-key-provider")}
                >
                  <KeyRound />
                  <span>API Key Provider</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="OpenAI Compatibility"
                  isActive={location.pathname.startsWith(
                    "/admin/openai-compatibility-provider"
                  )}
                  onClick={() =>
                    navigate("/admin/openai-compatibility-provider")
                  }
                >
                  <Globe />
                  <span>OpenAI Compatibility</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="OAuth Provider"
                  isActive={location.pathname.startsWith(
                    "/admin/oauth-providers"
                  )}
                  onClick={() => navigate("/admin/oauth-providers")}
                >
                  <LogIn />
                  <span>OAuth Provider</span>
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
                <DropdownMenuItem
                  onClick={() => navigate("/settings/api-keys")}
                >
                  <Settings />
                  设置
                </DropdownMenuItem>
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
