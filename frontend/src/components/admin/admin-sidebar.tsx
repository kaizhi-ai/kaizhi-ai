import {
  ArrowLeft,
  BarChart3,
  DollarSign,
  Globe,
  KeyRound,
  LogIn,
  Users,
} from "lucide-react"
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

export function AdminSidebar() {
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
                  tooltip={t("nav.usage")}
                  isActive={location.pathname.startsWith("/admin/usage")}
                  onClick={() => handleNavigate("/admin/usage")}
                >
                  <BarChart3 />
                  <span>{t("nav.usage")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.userManagement")}
                  isActive={location.pathname.startsWith("/admin/users")}
                  onClick={() => handleNavigate("/admin/users")}
                >
                  <Users />
                  <span>{t("nav.userManagement")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("nav.modelPrices")}
                  isActive={location.pathname.startsWith("/admin/model-prices")}
                  onClick={() => handleNavigate("/admin/model-prices")}
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
                  onClick={() => handleNavigate("/admin/api-key-provider")}
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
                    handleNavigate("/admin/openai-compatibility-provider")
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
                  onClick={() => handleNavigate("/admin/oauth-providers")}
                >
                  <LogIn />
                  <span>{t("nav.oauthProvider")}</span>
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
