import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { loginWithEmail } from "@/lib/auth-client"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type LocationState = { from?: { pathname?: string } } | null

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, refresh } = useAuth()
  const redirectTo = (location.state as LocationState)?.from?.pathname ?? "/"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true })
  }, [user, navigate, redirectTo])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await loginWithEmail(email, password)
    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }
    await refresh()
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm gap-6 bg-popover py-8">
        <CardHeader className="px-8">
          <CardTitle className="text-lg">登录</CardTitle>
          <CardDescription>使用邮箱和密码登录 Kaizhi Chat</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4 px-8">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading ? "登录中…" : "登录"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
