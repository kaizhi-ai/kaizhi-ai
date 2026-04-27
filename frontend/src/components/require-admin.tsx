import { useTranslation } from "react-i18next"
import { Navigate, Outlet } from "react-router-dom"

import { useAuth } from "@/lib/auth-context"

export default function RequireAdmin() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        {t("common.loading")}
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.role !== "admin") {
    return <Navigate to="/chat" replace />
  }

  return <Outlet />
}
