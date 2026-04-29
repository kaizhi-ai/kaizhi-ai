import { ArrowLeft, BarChart3, KeyRound, Settings } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { SidebarUserFooter } from "@/components/sidebar-user-footer"

export function SettingsSidebar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
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
            {t("nav.settings")}
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
                  onClick={() => handleNavigate("/chat")}
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
                  tooltip={t("nav.general")}
                  isActive={location.pathname.startsWith("/settings/general")}
                  onClick={() => handleNavigate("/settings/general")}
                >
                  <Settings />
                  <span>{t("nav.general")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.usage")}
                  isActive={location.pathname.startsWith("/settings/usage")}
                  onClick={() => handleNavigate("/settings/usage")}
                >
                  <BarChart3 />
                  <span>{t("nav.usage")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.apiKeys")}
                  isActive={location.pathname.startsWith("/settings/api-keys")}
                  onClick={() => handleNavigate("/settings/api-keys")}
                >
                  <KeyRound />
                  <span>{t("nav.apiKeys")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarUserFooter />
    </Sidebar>
  )
}
