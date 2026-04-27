import { useTranslation } from "react-i18next"
import { Navigate, Outlet, useLocation } from "react-router-dom"

import { useAuth } from "@/lib/auth-context"

export default function RequireAuth() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        {t("common.loading")}
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
