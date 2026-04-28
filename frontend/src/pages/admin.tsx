import { useTranslation } from "react-i18next"
import { Navigate, Outlet, useLocation } from "react-router-dom"

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { AdminSidebar } from "@/components/admin/admin-sidebar"

export default function AdminPage() {
  const { t } = useTranslation()
  const location = useLocation()

  if (location.pathname === "/admin") {
    return <Navigate to="/admin/usage" replace />
  }

  return (
    <SidebarProvider className="h-dvh overflow-hidden bg-background text-foreground">
      <AdminSidebar />
      <SidebarInset className="flex h-dvh min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:hidden">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium">{t("nav.admin")}</span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
