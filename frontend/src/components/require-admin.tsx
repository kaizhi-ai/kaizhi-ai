import { Navigate, Outlet } from "react-router-dom"

import { useAuth } from "@/lib/auth-context"

export default function RequireAdmin() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        加载中…
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
