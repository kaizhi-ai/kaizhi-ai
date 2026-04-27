import { useCallback, useEffect, useState, type ReactNode } from "react"

import {
  clearToken,
  fetchCurrentUser,
  getToken,
  logoutSession,
  type AuthUser,
} from "@/lib/auth-client"
import { AuthContext } from "@/lib/auth-context"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(() => getToken() !== null)

  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    fetchCurrentUser().then((u) => {
      if (cancelled) return
      setUser(u)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = user?.language || "zh-CN"
  }, [user?.language])

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      return null
    }
    const u = await fetchCurrentUser()
    setUser(u)
    return u
  }, [])

  const signOut = useCallback(() => {
    const token = getToken()
    clearToken()
    setUser(null)
    setLoading(false)
    void logoutSession(token)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
