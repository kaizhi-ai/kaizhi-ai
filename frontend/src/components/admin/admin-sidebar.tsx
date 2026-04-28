import {
  ArrowLeft,
  ChevronsUpDown,
  DollarSign,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  Settings,
  Users,
} from "lucide-react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, signOut } = useAuth()
  const displayName =
    user?.name?.trim() || user?.email?.split("@")[0] || t("nav.notSignedIn")
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
            {t("nav.admin")}
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
                  tooltip={t("nav.backToChat")}
                  onClick={() => navigate("/chat")}
                >
                  <ArrowLeft />
                  <span>{t("nav.backToChat")}</span>
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
                  tooltip={t("nav.userManagement")}
                  isActive={location.pathname.startsWith("/admin/users")}
                  onClick={() => navigate("/admin/users")}
                >
                  <Users />
                  <span>{t("nav.userManagement")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.modelPrices")}
                  isActive={location.pathname.startsWith("/admin/model-prices")}
                  onClick={() => navigate("/admin/model-prices")}
                >
                  <DollarSign />
                  <span>{t("nav.modelPrices")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.apiKeyProvider")}
                  isActive={location.pathname.startsWith(
                    "/admin/api-key-provider"
                  )}
                  onClick={() => navigate("/admin/api-key-provider")}
                >
                  <KeyRound />
                  <span>{t("nav.apiKeyProvider")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.openAICompatibility")}
                  isActive={location.pathname.startsWith(
                    "/admin/openai-compatibility-provider"
                  )}
                  onClick={() =>
                    navigate("/admin/openai-compatibility-provider")
                  }
                >
                  <Globe />
                  <span>{t("nav.openAICompatibility")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.oauthProvider")}
                  isActive={location.pathname.startsWith(
                    "/admin/oauth-providers"
                  )}
                  onClick={() => navigate("/admin/oauth-providers")}
                >
                  <LogIn />
                  <span>{t("nav.oauthProvider")}</span>
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
                    tooltip={user?.email ?? t("nav.notSignedIn")}
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
                <DropdownMenuItem onClick={() => navigate("/settings/general")}>
                  <Settings />
                  {t("nav.settings")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>
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
