import { useEffect, useMemo, useState, type FormEvent } from "react"
import { MoreHorizontal, Plus, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  banAdminUser,
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  unbanAdminUser,
  updateAdminUser,
  type AdminUser,
  type AdminUserLanguage,
  type AdminUserRole,
} from "@/lib/admin-users-client"
import { useAuth } from "@/lib/auth-context"
import { languageOptions, supportedLanguage } from "@/lib/i18n"
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

function formatDate(value: string | undefined, dateFmt: Intl.DateTimeFormat) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return dateFmt.format(date)
}

function formatUSD(value: string | undefined, fmt: Intl.NumberFormat) {
  if (!value) return "-"
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "-"
  return fmt.format(amount)
}

function displayName(user: AdminUser) {
  return user.name?.trim() || "-"
}

function accountLabel(user: AdminUser) {
  const name = user.name?.trim()
  return name ? `${name} (${user.email})` : user.email
}

function roleValue(user: AdminUser): AdminUserRole {
  return user.role === "admin" ? "admin" : "user"
}

function languageValue(language?: string): AdminUserLanguage {
  return supportedLanguage(language) as AdminUserLanguage
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
  const { t, i18n } = useTranslation()
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.language]
  )
  const usdFmt = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }),
    [i18n.language]
  )
  const { user: currentUser, refresh } = useAuth()
  const currentUserId = currentUser?.id

  const [users, setUsers] = useState<AdminUser[]>([])
  const [filter, setFilter] = useState<UserFilter>("active")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [language, setLanguage] = useState<AdminUserLanguage | null>(null)
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<AdminUserRole>("user")
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [editEmail, setEditEmail] = useState("")
  const [editName, setEditName] = useState("")
  const [editLanguage, setEditLanguage] = useState<AdminUserLanguage>("zh-CN")
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
        if (!cancelled) setError(errorMessage(err, t("errors.loadUsersFailed")))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

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
    setName("")
    setLanguage(null)
    setPassword("")
    setRole("user")
    setCreateError(null)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const created = await createAdminUser({
        email,
        name,
        language,
        password,
        role,
      })
      setUsers((prev) => upsertUser(prev, created))
      resetCreateForm()
      setCreateOpen(false)
    } catch (err) {
      setCreateError(errorMessage(err, t("adminUsers.createFailed")))
    } finally {
      setCreating(false)
    }
  }

  function openEdit(target: AdminUser) {
    setEditTarget(target)
    setEditEmail(target.email)
    setEditName(target.name ?? "")
    setEditLanguage(languageValue(target.language))
    setEditRole(roleValue(target))
    setEditError(null)
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setEditError(null)
    setEditing(true)
    try {
      const payload: {
        email?: string
        name?: string
        language?: AdminUserLanguage
        role?: AdminUserRole
      } = {}
      const nextEmail = editEmail.trim()
      const nextName = editName.trim()
      if (nextEmail && nextEmail !== editTarget.email) payload.email = nextEmail
      if (nextName !== (editTarget.name ?? "")) payload.name = nextName
      if (editLanguage !== languageValue(editTarget.language)) {
        payload.language = editLanguage
      }
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
      setEditError(errorMessage(err, t("errors.saveFailed")))
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
      setPwdError(errorMessage(err, t("adminUsers.resetFailed")))
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
      setBanError(errorMessage(err, t("adminUsers.banFailed")))
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
      setUnbanError(errorMessage(err, t("adminUsers.unbanFailed")))
    } finally {
      setUnbanningId(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t("adminUsers.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("adminUsers.totalUsers", { count: users.length })}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as UserFilter)}
          >
            <TabsList>
              <TabsTrigger value="active">
                {t("adminUsers.activeCount", { count: activeUsers.length })}
              </TabsTrigger>
              <TabsTrigger value="banned">
                {t("adminUsers.bannedCount", { count: bannedUsers.length })}
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
                  {t("adminUsers.newUser")}
                </Button>
              }
            />
            <SheetContent>
              <form
                onSubmit={handleCreate}
                className="flex h-full flex-col gap-4"
              >
                <SheetHeader>
                  <SheetTitle>{t("adminUsers.newUser")}</SheetTitle>
                  <SheetDescription>
                    {t("adminUsers.createDescription")}
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-1 flex-col gap-4 px-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user-email">
                      {t("adminUsers.email")}
                    </Label>
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
                    <Label htmlFor="admin-user-name">
                      {t("settings.name")}
                    </Label>
                    <Input
                      id="admin-user-name"
                      autoComplete="off"
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user-password">
                      {t("common.password")}
                    </Label>
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
                        {t("adminUsers.randomPassword")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("adminUsers.minPassword")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user-role">
                      {t("adminUsers.role")}
                    </Label>
                    <Select
                      value={role}
                      onValueChange={(value) => {
                        if (!value) return
                        setRole(value as AdminUserRole)
                      }}
                    >
                      <SelectTrigger id="admin-user-role" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">
                          {t("adminUsers.roleUser")}
                        </SelectItem>
                        <SelectItem value="admin">
                          {t("adminUsers.roleAdmin")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user-language">
                      {t("settings.language")}
                    </Label>
                    <Select
                      value={language}
                      onValueChange={(value) => {
                        if (!value) return
                        setLanguage(value as AdminUserLanguage)
                      }}
                    >
                      <SelectTrigger
                        id="admin-user-language"
                        className="w-full"
                      >
                        <SelectValue
                          placeholder={t("adminUsers.languageDefault")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {languageOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {createError && (
                    <p className="text-sm text-destructive">{createError}</p>
                  )}
                </div>
                <SheetFooter>
                  <Button type="submit" disabled={creating}>
                    {creating
                      ? t("common.creating")
                      : t("adminUsers.createUser")}
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
        <Table className="min-w-5xl table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">
                {t("adminUsers.user")}
              </TableHead>
              <TableHead className="w-72">
                {t("adminUsers.email")}
              </TableHead>
              <TableHead className="w-20">
                {t("adminUsers.role")}
              </TableHead>
              <TableHead className="w-32 text-right">
                {t("adminUsers.usage5hQuota")}
              </TableHead>
              <TableHead className="w-32 text-right">
                {t("adminUsers.usage7dQuota")}
              </TableHead>
              <TableHead className="w-40">
                {t("common.createdAt")}
              </TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-muted-foreground"
                >
                  {t("common.loading")}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filteredUsers.map((item) => {
                const isSelf = currentUserId === item.id
                const isBanned = isBannedUser(item)
                return (
                  <TableRow key={item.id}>
                    <TableCell className="truncate font-medium">
                      {displayName(item)}
                    </TableCell>
                    <TableCell className="truncate">
                      {item.email}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {roleValue(item) === "admin"
                        ? t("adminUsers.roleAdmin")
                        : t("adminUsers.roleUser")}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {formatUSD(item.usage_5h_cost_usd, usdFmt)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {formatUSD(item.usage_7d_cost_usd, usdFmt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(item.created_at, dateFmt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("common.moreActions")}
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(item)}>
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openResetPassword(item)}
                          >
                            {t("adminUsers.resetPassword")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {isBanned ? (
                            <DropdownMenuItem
                              disabled={isSelf || unbanningId === item.id}
                              onClick={() => void handleUnban(item)}
                            >
                              {t("adminUsers.unban")}
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
                              {t("adminUsers.banUser")}
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
                  colSpan={7}
                  className="py-12 text-center text-muted-foreground"
                >
                  {filter === "banned"
                    ? t("adminUsers.noBannedUsers")
                    : t("adminUsers.noActiveUsers")}
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
              <SheetTitle>{t("adminUsers.editUser")}</SheetTitle>
              <SheetDescription>
                {t("adminUsers.editDescription")}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-4 px-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-admin-user-email">
                  {t("adminUsers.email")}
                </Label>
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
                <Label htmlFor="edit-admin-user-name">
                  {t("settings.name")}
                </Label>
                <Input
                  id="edit-admin-user-name"
                  autoComplete="off"
                  maxLength={80}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-admin-user-language">
                  {t("settings.language")}
                </Label>
                <Select
                  value={editLanguage}
                  onValueChange={(value) => {
                    if (!value) return
                    setEditLanguage(value as AdminUserLanguage)
                  }}
                >
                  <SelectTrigger
                    id="edit-admin-user-language"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-admin-user-role">
                  {t("adminUsers.role")}
                </Label>
                <Select
                  value={editRole}
                  onValueChange={(value) => {
                    if (!value) return
                    setEditRole(value as AdminUserRole)
                  }}
                  disabled={editTarget?.id === currentUserId}
                >
                  <SelectTrigger id="edit-admin-user-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">
                      {t("adminUsers.roleUser")}
                    </SelectItem>
                    <SelectItem value="admin">
                      {t("adminUsers.roleAdmin")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {editTarget?.id === currentUserId && (
                  <p className="text-xs text-muted-foreground">
                    {t("adminUsers.cannotEditOwnRole")}
                  </p>
                )}
              </div>
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
            </div>
            <SheetFooter>
              <Button type="submit" disabled={editing}>
                {editing ? t("common.saving") : t("common.save")}
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
                <SheetTitle>{t("adminUsers.passwordReset")}</SheetTitle>
                <SheetDescription>
                  {t("adminUsers.closePasswordDescription")}
                </SheetDescription>
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
                  {pwdCopied ? t("common.copied") : t("common.copy")}
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
                  {t("common.complete")}
                </Button>
              </SheetFooter>
            </div>
          ) : (
            <form
              onSubmit={handleResetPassword}
              className="flex h-full flex-col gap-4"
            >
              <SheetHeader>
                <SheetTitle>{t("adminUsers.resetPassword")}</SheetTitle>
                <SheetDescription>
                  {pwdTarget ? accountLabel(pwdTarget) : null}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-4 px-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reset-admin-user-password">
                    {t("adminUsers.newPassword")}
                  </Label>
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
                      {t("adminUsers.randomPassword")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("adminUsers.minPassword")}
                  </p>
                </div>
                {pwdError && (
                  <p className="text-sm text-destructive">{pwdError}</p>
                )}
              </div>
              <SheetFooter>
                <Button type="submit" disabled={pwdSubmitting}>
                  {pwdSubmitting
                    ? t("adminUsers.resetting")
                    : t("adminUsers.resetPassword")}
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
            <AlertDialogTitle>
              {t("adminUsers.banConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {banTarget
                ? t("adminUsers.banConfirmDescription", {
                    label: accountLabel(banTarget),
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {banError && (
            <p className="px-4 text-sm text-destructive">{banError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={banSubmitting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={banSubmitting}
              onClick={confirmBan}
            >
              {banSubmitting
                ? t("adminUsers.banning")
                : t("adminUsers.banUser")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
