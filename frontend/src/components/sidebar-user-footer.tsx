import { ChevronsUpDown, LogOut, Settings, Shield } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { useAuth } from "@/lib/auth-context"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function SidebarUserFooter() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { isMobile, setOpenMobile } = useSidebar()
  const fallbackLabel = t("nav.notSignedIn")
  const userEmail = user?.email
  const displayName =
    user?.name?.trim() || userEmail?.split("@")[0] || fallbackLabel
  const initial = (displayName || userEmail || "?").charAt(0).toUpperCase()

  function closeMobileSidebar() {
    if (isMobile) setOpenMobile(false)
  }

  function handleSettings() {
    navigate("/settings/general")
    closeMobileSidebar()
  }

  function handleAdmin() {
    navigate("/admin")
    closeMobileSidebar()
  }

  function handleSignOut() {
    signOut()
    navigate("/login", { replace: true })
    closeMobileSidebar()
  }

  return (
    <SidebarFooter className="border-t border-sidebar-border p-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  tooltip={userEmail ?? fallbackLabel}
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
              <DropdownMenuItem onClick={handleSettings}>
                <Settings />
                {t("nav.settings")}
              </DropdownMenuItem>
              {user?.role === "admin" && (
                <DropdownMenuItem onClick={handleAdmin}>
                  <Shield />
                  {t("nav.admin")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut />
                {t("nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
