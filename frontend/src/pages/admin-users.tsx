import { useEffect, useMemo, useState, type FormEvent } from "react"
import { MoreHorizontal, Plus, Sparkles } from "lucide-react"

import {
  banAdminUser,
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  unbanAdminUser,
  updateAdminUser,
  type AdminUser,
  type AdminUserRole,
} from "@/lib/admin-users-client"
import { useAuth } from "@/lib/auth-context"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const dateFmt = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function generatePassword(length = 16) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*"
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

function formatDate(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return dateFmt.format(date)
}

function displayName(user: AdminUser) {
  return user.email.split("@")[0] || user.email
}

function roleValue(user: AdminUser): AdminUserRole {
  return user.role === "admin" ? "admin" : "user"
}

function roleLabel(role: string) {
  return role === "admin" ? "管理员" : "普通用户"
}

type UserFilter = "active" | "banned"

function isBannedUser(user: AdminUser) {
  return user.status === "banned"
}

function upsertUser(users: AdminUser[], next: AdminUser) {
  const exists = users.some((user) => user.id === next.id)
  if (!exists) return [next, ...users]
  return users.map((user) => (user.id === next.id ? next : user))
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export default function AdminUsersPage() {
  const { user: currentUser, refresh } = useAuth()
  const currentUserId = currentUser?.id

  const [users, setUsers] = useState<AdminUser[]>([])
  const [filter, setFilter] = useState<UserFilter>("active")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<AdminUserRole>("user")
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [editEmail, setEditEmail] = useState("")
  const [editRole, setEditRole] = useState<AdminUserRole>("user")
  const [editError, setEditError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null)
  const [pwdValue, setPwdValue] = useState("")
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const [pwdDone, setPwdDone] = useState(false)
  const [pwdCopied, setPwdCopied] = useState(false)

  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const [banError, setBanError] = useState<string | null>(null)
  const [banSubmitting, setBanSubmitting] = useState(false)
  const [unbanningId, setUnbanningId] = useState<string | null>(null)
  const [unbanError, setUnbanError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listAdminUsers()
      .then((items) => {
        if (!cancelled) setUsers(items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, "加载用户失败"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const activeUsers = useMemo(
    () => users.filter((user) => !isBannedUser(user)),
    [users]
  )
  const bannedUsers = useMemo(
    () => users.filter((user) => isBannedUser(user)),
    [users]
  )
  const filteredUsers = filter === "banned" ? bannedUsers : activeUsers

  function resetCreateForm() {
    setEmail("")
    setPassword("")
    setRole("user")
    setCreateError(null)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const created = await createAdminUser({ email, password, role })
      setUsers((prev) => upsertUser(prev, created))
      resetCreateForm()
      setCreateOpen(false)
    } catch (err) {
      setCreateError(errorMessage(err, "创建失败"))
    } finally {
      setCreating(false)
    }
  }

  function openEdit(target: AdminUser) {
    setEditTarget(target)
    setEditEmail(target.email)
    setEditRole(roleValue(target))
    setEditError(null)
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setEditError(null)
    setEditing(true)
    try {
      const payload: { email?: string; role?: AdminUserRole } = {}
      const nextEmail = editEmail.trim()
      if (nextEmail && nextEmail !== editTarget.email) payload.email = nextEmail
      if (editRole !== roleValue(editTarget)) payload.role = editRole

      if (Object.keys(payload).length === 0) {
        setEditTarget(null)
        return
      }
      const updated = await updateAdminUser(editTarget.id, payload)
      setUsers((prev) => upsertUser(prev, updated))
      setEditTarget(null)
      if (updated.id === currentUserId) void refresh()
    } catch (err) {
      setEditError(errorMessage(err, "保存失败"))
    } finally {
      setEditing(false)
    }
  }

  function openResetPassword(target: AdminUser) {
    setPwdTarget(target)
    setPwdValue(generatePassword())
    setPwdError(null)
    setPwdDone(false)
    setPwdCopied(false)
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    if (!pwdTarget) return
    setPwdError(null)
    setPwdSubmitting(true)
    try {
      await resetAdminUserPassword(pwdTarget.id, pwdValue)
      setPwdDone(true)
    } catch (err) {
      setPwdError(errorMessage(err, "重置失败"))
    } finally {
      setPwdSubmitting(false)
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(pwdValue)
      setPwdCopied(true)
      setTimeout(() => setPwdCopied(false), 1500)
    } catch {
      setPwdCopied(false)
    }
  }

  async function confirmBan() {
    if (!banTarget) return
    setBanError(null)
    setBanSubmitting(true)
    try {
      const updated = await banAdminUser(banTarget.id)
      setUsers((prev) => upsertUser(prev, updated))
      setBanTarget(null)
    } catch (err) {
      setBanError(errorMessage(err, "封禁失败"))
    } finally {
      setBanSubmitting(false)
    }
  }

  async function handleUnban(target: AdminUser) {
    setUnbanError(null)
    setUnbanningId(target.id)
    try {
      const updated = await unbanAdminUser(target.id)
      setUsers((prev) => upsertUser(prev, updated))
    } catch (err) {
      setUnbanError(errorMessage(err, "解除封禁失败"))
    } finally {
      setUnbanningId(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">用户管理</h1>
          <p className="text-sm text-muted-foreground">
            共 {users.length} 个用户
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as UserFilter)}
          >
            <TabsList>
              <TabsTrigger value="active">
                正常 {activeUsers.length}
              </TabsTrigger>
              <TabsTrigger value="banned">
                已封禁 {bannedUsers.length}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Sheet
            open={createOpen}
            onOpenChange={(next) => {
              setCreateOpen(next)
              if (!next) resetCreateForm()
            }}
          >
            <SheetTrigger
              render={
                <Button className="w-full sm:w-auto">
                  <Plus />
                  新建用户
                </Button>
              }
            />
            <SheetContent>
              <form
                onSubmit={handleCreate}
                className="flex h-full flex-col gap-4"
              >
                <SheetHeader>
                  <SheetTitle>新建用户</SheetTitle>
                  <SheetDescription>
                    创建可登录后台和聊天的账号。
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-1 flex-col gap-4 px-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user-email">邮箱</Label>
                    <Input
                      id="admin-user-email"
                      type="email"
                      autoComplete="off"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user-password">密码</Label>
                    <div className="flex gap-2">
                      <Input
                        id="admin-user-password"
                        type="text"
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-9 min-w-0 flex-1 font-mono"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 shrink-0"
                        onClick={() => setPassword(generatePassword())}
                      >
                        <Sparkles />
                        随机
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      至少 8 位字符
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user-role">角色</Label>
                    <Select
                      value={role}
                      onValueChange={(value) => setRole(value as AdminUserRole)}
                    >
                      <SelectTrigger id="admin-user-role" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">普通用户</SelectItem>
                        <SelectItem value="admin">管理员</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {createError && (
                    <p className="text-sm text-destructive">{createError}</p>
                  )}
                </div>
                <SheetFooter>
                  <Button type="submit" disabled={creating}>
                    {creating ? "创建中..." : "创建用户"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {unbanError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {unbanError}
        </div>
      )}

      <div className="rounded-lg border">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-44">用户</TableHead>
              <TableHead className="min-w-56">邮箱</TableHead>
              <TableHead className="min-w-24">角色</TableHead>
              <TableHead className="min-w-24">状态</TableHead>
              <TableHead className="min-w-40">创建时间</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-muted-foreground"
                >
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filteredUsers.map((item) => {
                const isSelf = currentUserId === item.id
                const isBanned = isBannedUser(item)
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {displayName(item)}
                    </TableCell>
                    <TableCell className="max-w-80 truncate">
                      {item.email}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {roleLabel(item.role)}
                    </TableCell>
                    <TableCell>
                      {isBanned ? (
                        <span className="text-destructive">已封禁</span>
                      ) : (
                        <span className="text-muted-foreground">正常</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(item.created_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="更多操作"
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(item)}>
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openResetPassword(item)}
                          >
                            重置密码
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {isBanned ? (
                            <DropdownMenuItem
                              disabled={isSelf || unbanningId === item.id}
                              onClick={() => void handleUnban(item)}
                            >
                              解除封禁
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={isSelf}
                              onClick={() => {
                                setBanError(null)
                                setBanTarget(item)
                              }}
                            >
                              封禁
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            {!loading && filteredUsers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-muted-foreground"
                >
                  {filter === "banned" ? "暂无封禁用户" : "暂无正常用户"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet
        open={editTarget !== null}
        onOpenChange={(next) => {
          if (!next && !editing) setEditTarget(null)
        }}
      >
        <SheetContent>
          <form onSubmit={handleEdit} className="flex h-full flex-col gap-4">
            <SheetHeader>
              <SheetTitle>编辑用户</SheetTitle>
              <SheetDescription>修改邮箱或角色。</SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-4 px-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-admin-user-email">邮箱</Label>
                <Input
                  id="edit-admin-user-email"
                  type="email"
                  autoComplete="off"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-admin-user-role">角色</Label>
                <Select
                  value={editRole}
                  onValueChange={(value) => setEditRole(value as AdminUserRole)}
                  disabled={editTarget?.id === currentUserId}
                >
                  <SelectTrigger id="edit-admin-user-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">普通用户</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
                  </SelectContent>
                </Select>
                {editTarget?.id === currentUserId && (
                  <p className="text-xs text-muted-foreground">
                    不能修改自己的角色
                  </p>
                )}
              </div>
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
            </div>
            <SheetFooter>
              <Button type="submit" disabled={editing}>
                {editing ? "保存中..." : "保存"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={pwdTarget !== null}
        onOpenChange={(next) => {
          if (!next && !pwdSubmitting) {
            setPwdTarget(null)
            setPwdDone(false)
            setPwdCopied(false)
          }
        }}
      >
        <SheetContent>
          {pwdDone ? (
            <div className="flex h-full flex-col gap-4">
              <SheetHeader>
                <SheetTitle>密码已重置</SheetTitle>
                <SheetDescription>关闭后将不再显示。</SheetDescription>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-3 px-4">
                <div className="rounded-md bg-muted p-3 font-mono text-sm break-all select-all">
                  {pwdValue}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-fit"
                  onClick={copyPassword}
                >
                  {pwdCopied ? "已复制" : "复制密码"}
                </Button>
              </div>
              <SheetFooter>
                <Button
                  type="button"
                  onClick={() => {
                    setPwdTarget(null)
                    setPwdDone(false)
                    setPwdCopied(false)
                  }}
                >
                  完成
                </Button>
              </SheetFooter>
            </div>
          ) : (
            <form
              onSubmit={handleResetPassword}
              className="flex h-full flex-col gap-4"
            >
              <SheetHeader>
                <SheetTitle>重置密码</SheetTitle>
                <SheetDescription>
                  {pwdTarget
                    ? `${displayName(pwdTarget)} (${pwdTarget.email})`
                    : null}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-4 px-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reset-admin-user-password">新密码</Label>
                  <div className="flex gap-2">
                    <Input
                      id="reset-admin-user-password"
                      type="text"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={pwdValue}
                      onChange={(e) => setPwdValue(e.target.value)}
                      className="h-9 min-w-0 flex-1 font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 shrink-0"
                      onClick={() => setPwdValue(generatePassword())}
                    >
                      <Sparkles />
                      随机
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">至少 8 位字符</p>
                </div>
                {pwdError && (
                  <p className="text-sm text-destructive">{pwdError}</p>
                )}
              </div>
              <SheetFooter>
                <Button type="submit" disabled={pwdSubmitting}>
                  {pwdSubmitting ? "重置中..." : "重置密码"}
                </Button>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={banTarget !== null}
        onOpenChange={(next) => {
          if (!next && !banSubmitting) {
            setBanTarget(null)
            setBanError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>封禁该用户？</AlertDialogTitle>
            <AlertDialogDescription>
              {banTarget
                ? `${displayName(banTarget)} (${banTarget.email}) 将无法登录，现有会话会被吊销。`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {banError && (
            <p className="px-4 text-sm text-destructive">{banError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={banSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={banSubmitting}
              onClick={confirmBan}
            >
              {banSubmitting ? "封禁中..." : "封禁"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
