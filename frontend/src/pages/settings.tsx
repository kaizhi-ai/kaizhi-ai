import { Navigate, Outlet, useLocation } from "react-router-dom"

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { SettingsSidebar } from "@/components/settings/settings-sidebar"

export default function SettingsPage() {
  const location = useLocation()

  if (location.pathname === "/settings") {
    return <Navigate to="/settings/general" replace />
  }

  return (
    <SidebarProvider className="h-dvh overflow-hidden bg-background text-foreground">
      <SettingsSidebar />
      <SidebarInset className="flex h-dvh min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:hidden">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium">设置</span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
