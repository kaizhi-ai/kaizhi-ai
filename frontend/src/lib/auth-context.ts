import { createContext, useContext } from "react"

import type { AuthUser } from "@/lib/auth-client"

export type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  refresh: () => Promise<AuthUser | null>
  signOut: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
