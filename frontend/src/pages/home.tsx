import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"

export default function HomePage() {
  const { user, signOut } = useAuth()

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="text-4xl font-semibold tracking-tight">kaizhi2</h1>
      <p className="text-muted-foreground">已登录：{user?.email}</p>
      <Button variant="outline" onClick={signOut}>
        退出登录
      </Button>
    </main>
  )
}
