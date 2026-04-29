import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react"
import type { ColumnDef, FilterFn } from "@tanstack/react-table"
import { MoreHorizontal, Plus, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

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
import { DataTable, DataTableSortableHeader } from "@/components/ui/data-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

function formatQuota(
  value: string | null | undefined,
  fmt: Intl.NumberFormat,
  unlimitedLabel: string
) {
  if (value === null || value === undefined || value === "") {
    return unlimitedLabel
  }
  return formatUSD(value, fmt)
}

function quotaPayload(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function usageSortValue(value: string | undefined): number {
  if (!value) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
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

  const [createOpen, setCreateOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [language, setLanguage] = useState<AdminUserLanguage | null>(null)
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<AdminUserRole>("user")
  const [quota5H, setQuota5H] = useState("")
  const [quota7D, setQuota7D] = useState("")
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [editEmail, setEditEmail] = useState("")
  const [editName, setEditName] = useState("")
  const [editLanguage, setEditLanguage] = useState<AdminUserLanguage>("zh-CN")
  const [editRole, setEditRole] = useState<AdminUserRole>("user")
  const [editQuota5H, setEditQuota5H] = useState("")
  const [editQuota7D, setEditQuota7D] = useState("")
  const [editing, setEditing] = useState(false)

  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null)
  const [pwdValue, setPwdValue] = useState("")
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const [pwdDone, setPwdDone] = useState(false)
  const [pwdCopied, setPwdCopied] = useState(false)

  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const [banSubmitting, setBanSubmitting] = useState(false)
  const [unbanningId, setUnbanningId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listAdminUsers()
      .then((items) => {
        if (!cancelled) setUsers(items)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.error(errorMessage(err, t("errors.loadUsersFailed")))
        }
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
  const userGlobalFilter = useCallback<FilterFn<AdminUser>>(
    (row, _columnId, filterValue) => {
      const query = String(filterValue ?? "")
        .trim()
        .toLowerCase()
      if (!query) return true

      const item = row.original
      const role = roleValue(item)
      const roleLabel =
        role === "admin" ? t("adminUsers.roleAdmin") : t("adminUsers.roleUser")
      const statusLabel = isBannedUser(item)
        ? t("adminUsers.banned")
        : t("adminUsers.normal")

      return [
        item.name,
        item.email,
        item.language,
        role,
        roleLabel,
        statusLabel,
        item.usage_5h_cost_usd,
        item.usage_7d_cost_usd,
        item.quota_5h_cost_usd,
        item.quota_7d_cost_usd,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query)
      )
    },
    [t]
  )

  function resetCreateForm() {
    setEmail("")
    setName("")
    setLanguage(null)
    setPassword("")
    setRole("user")
    setQuota5H("")
    setQuota7D("")
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const created = await createAdminUser({
        email,
        name,
        language,
        password,
        role,
        quota_5h_cost_usd: quotaPayload(quota5H),
        quota_7d_cost_usd: quotaPayload(quota7D),
      })
      setUsers((prev) => upsertUser(prev, created))
      resetCreateForm()
      setCreateOpen(false)
    } catch (err) {
      toast.error(errorMessage(err, t("adminUsers.createFailed")))
    } finally {
      setCreating(false)
    }
  }

  const openEdit = useCallback((target: AdminUser) => {
    setEditTarget(target)
    setEditEmail(target.email)
    setEditName(target.name ?? "")
    setEditLanguage(languageValue(target.language))
    setEditRole(roleValue(target))
    setEditQuota5H(target.quota_5h_cost_usd ?? "")
    setEditQuota7D(target.quota_7d_cost_usd ?? "")
  }, [])

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setEditing(true)
    try {
      const payload: {
        email?: string
        name?: string
        language?: AdminUserLanguage
        role?: AdminUserRole
        quota_5h_cost_usd?: string | null
        quota_7d_cost_usd?: string | null
      } = {}
      const nextEmail = editEmail.trim()
      const nextName = editName.trim()
      if (nextEmail && nextEmail !== editTarget.email) payload.email = nextEmail
      if (nextName !== (editTarget.name ?? "")) payload.name = nextName
      if (editLanguage !== languageValue(editTarget.language)) {
        payload.language = editLanguage
      }
      if (editRole !== roleValue(editTarget)) payload.role = editRole
      const nextQuota5H = quotaPayload(editQuota5H)
      const nextQuota7D = quotaPayload(editQuota7D)
      if (nextQuota5H !== (editTarget.quota_5h_cost_usd ?? null)) {
        payload.quota_5h_cost_usd = nextQuota5H
      }
      if (nextQuota7D !== (editTarget.quota_7d_cost_usd ?? null)) {
        payload.quota_7d_cost_usd = nextQuota7D
      }

      if (Object.keys(payload).length === 0) {
        setEditTarget(null)
        return
      }
      const updated = await updateAdminUser(editTarget.id, payload)
      setUsers((prev) => upsertUser(prev, updated))
      setEditTarget(null)
      if (updated.id === currentUserId) void refresh()
    } catch (err) {
      toast.error(errorMessage(err, t("errors.saveFailed")))
    } finally {
      setEditing(false)
    }
  }

  const openResetPassword = useCallback((target: AdminUser) => {
    setPwdTarget(target)
    setPwdValue(generatePassword())
    setPwdDone(false)
    setPwdCopied(false)
  }, [])

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    if (!pwdTarget) return
    setPwdSubmitting(true)
    try {
      await resetAdminUserPassword(pwdTarget.id, pwdValue)
      setPwdDone(true)
    } catch (err) {
      toast.error(errorMessage(err, t("adminUsers.resetFailed")))
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
      toast.error(t("common.copyFailed"))
    }
  }

  async function confirmBan() {
    if (!banTarget) return
    setBanSubmitting(true)
    try {
      const updated = await banAdminUser(banTarget.id)
      setUsers((prev) => upsertUser(prev, updated))
      setBanTarget(null)
    } catch (err) {
      toast.error(errorMessage(err, t("adminUsers.banFailed")))
    } finally {
      setBanSubmitting(false)
    }
  }

  const handleUnban = useCallback(
    async (target: AdminUser) => {
      setUnbanningId(target.id)
      try {
        const updated = await unbanAdminUser(target.id)
        setUsers((prev) => upsertUser(prev, updated))
      } catch (err) {
        toast.error(errorMessage(err, t("adminUsers.unbanFailed")))
      } finally {
        setUnbanningId(null)
      }
    },
    [t]
  )

  const requestBan = useCallback((target: AdminUser) => {
    setBanTarget(target)
  }, [])

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.name?.trim() ?? "",
        header: ({ column }) => (
          <DataTableSortableHeader
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("adminUsers.user")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{displayName(row.original)}</span>
        ),
        meta: { headClassName: "min-w-32", label: t("adminUsers.user") },
      },
      {
        id: "email",
        accessorKey: "email",
        header: ({ column }) => (
          <DataTableSortableHeader
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("adminUsers.email")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.email}</span>
        ),
        meta: { headClassName: "min-w-56", label: t("adminUsers.email") },
      },
      {
        id: "role",
        accessorFn: (row) => roleValue(row),
        header: ({ column }) => (
          <DataTableSortableHeader
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("adminUsers.role")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {roleValue(row.original) === "admin"
              ? t("adminUsers.roleAdmin")
              : t("adminUsers.roleUser")}
          </span>
        ),
        meta: { headClassName: "min-w-20", label: t("adminUsers.role") },
      },
      {
        id: "usage5h",
        accessorFn: (row) => usageSortValue(row.usage_5h_cost_usd),
        sortingFn: "basic",
        header: ({ column }) => (
          <DataTableSortableHeader
            align="right"
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("adminUsers.usage5hQuota")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            <span>{formatUSD(row.original.usage_5h_cost_usd, usdFmt)}</span>
            <span className="text-xs text-muted-foreground">
              {" / "}
              {formatQuota(
                row.original.quota_5h_cost_usd,
                usdFmt,
                t("adminUsers.unlimitedQuota")
              )}
            </span>
          </span>
        ),
        meta: {
          headClassName: "min-w-44",
          align: "right",
          label: t("adminUsers.usage5hQuota"),
        },
      },
      {
        id: "usage7d",
        accessorFn: (row) => usageSortValue(row.usage_7d_cost_usd),
        sortingFn: "basic",
        header: ({ column }) => (
          <DataTableSortableHeader
            align="right"
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("adminUsers.usage7dQuota")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            <span>{formatUSD(row.original.usage_7d_cost_usd, usdFmt)}</span>
            <span className="text-xs text-muted-foreground">
              {" / "}
              {formatQuota(
                row.original.quota_7d_cost_usd,
                usdFmt,
                t("adminUsers.unlimitedQuota")
              )}
            </span>
          </span>
        ),
        meta: {
          headClassName: "min-w-44",
          align: "right",
          label: t("adminUsers.usage7dQuota"),
        },
      },
      {
        id: "createdAt",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataTableSortableHeader
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("common.createdAt")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.created_at, dateFmt)}
          </span>
        ),
        meta: { headClassName: "min-w-40", label: t("common.createdAt") },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => {
          const item = row.original
          const isSelf = currentUserId === item.id
          const isBanned = isBannedUser(item)
          return (
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
                <DropdownMenuItem onClick={() => openResetPassword(item)}>
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
                    onClick={() => requestBan(item)}
                  >
                    {t("adminUsers.banUser")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
        meta: { headClassName: "w-12" },
      },
    ],
    [
      t,
      dateFmt,
      usdFmt,
      currentUserId,
      unbanningId,
      openEdit,
      openResetPassword,
      handleUnban,
      requestBan,
    ]
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t("adminUsers.title")}</h1>
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
          <Button
            className="w-full sm:w-auto"
            onClick={() => setCreateOpen(true)}
          >
            <Plus />
            {t("adminUsers.newUser")}
          </Button>
          <Dialog
            open={createOpen}
            onOpenChange={(next) => {
              setCreateOpen(next)
              if (!next) resetCreateForm()
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <form onSubmit={handleCreate} className="flex flex-col gap-5">
                <DialogHeader>
                  <DialogTitle>{t("adminUsers.newUser")}</DialogTitle>
                  <DialogDescription>
                    {t("adminUsers.createDescription")}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="admin-user-email">
                      {t("adminUsers.email")}
                    </FieldLabel>
                    <Input
                      id="admin-user-email"
                      type="email"
                      autoComplete="off"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="admin-user-name">
                      {t("settings.name")}
                    </FieldLabel>
                    <Input
                      id="admin-user-name"
                      autoComplete="off"
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="admin-user-password">
                      {t("common.password")}
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="admin-user-password"
                        type="text"
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="min-w-0 flex-1 font-mono"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setPassword(generatePassword())}
                      >
                        <Sparkles />
                        {t("adminUsers.randomPassword")}
                      </Button>
                    </div>
                    <FieldDescription className="text-xs">
                      {t("adminUsers.minPassword")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="admin-user-role">
                      {t("adminUsers.role")}
                    </FieldLabel>
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
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="admin-user-language">
                      {t("settings.language")}
                    </FieldLabel>
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
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="admin-user-quota-5h">
                      {t("adminUsers.quota5h")}
                    </FieldLabel>
                    <Input
                      id="admin-user-quota-5h"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={t("adminUsers.unlimitedQuota")}
                      value={quota5H}
                      onChange={(e) => setQuota5H(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="admin-user-quota-7d">
                      {t("adminUsers.quota7d")}
                    </FieldLabel>
                    <Input
                      id="admin-user-quota-7d"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={t("adminUsers.unlimitedQuota")}
                      value={quota7D}
                      onChange={(e) => setQuota7D(e.target.value)}
                    />
                  </Field>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={creating}
                    onClick={() => setCreateOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating
                      ? t("common.creating")
                      : t("adminUsers.createUser")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredUsers}
        loading={loading}
        loadingLabel={t("common.loading")}
        emptyLabel={
          filter === "banned"
            ? t("adminUsers.noBannedUsers")
            : t("adminUsers.noActiveUsers")
        }
        noResultsLabel={t("adminUsers.noSearchResults")}
        searchPlaceholder={t("adminUsers.searchPlaceholder")}
        searchAriaLabel={t("adminUsers.searchAriaLabel")}
        getRowId={(row) => row.id}
        initialSorting={[{ id: "createdAt", desc: true }]}
        tableOptions={{ globalFilterFn: userGlobalFilter }}
      />

      <Dialog
        open={editTarget !== null}
        onOpenChange={(next) => {
          if (!next && !editing) setEditTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <form onSubmit={handleEdit} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{t("adminUsers.editUser")}</DialogTitle>
              <DialogDescription>
                {t("adminUsers.editDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="edit-admin-user-email">
                  {t("adminUsers.email")}
                </FieldLabel>
                <Input
                  id="edit-admin-user-email"
                  type="email"
                  autoComplete="off"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="edit-admin-user-name">
                  {t("settings.name")}
                </FieldLabel>
                <Input
                  id="edit-admin-user-name"
                  autoComplete="off"
                  maxLength={80}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-admin-user-language">
                  {t("settings.language")}
                </FieldLabel>
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
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-admin-user-role">
                  {t("adminUsers.role")}
                </FieldLabel>
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
                  <FieldDescription className="text-xs">
                    {t("adminUsers.cannotEditOwnRole")}
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-admin-user-quota-5h">
                  {t("adminUsers.quota5h")}
                </FieldLabel>
                <Input
                  id="edit-admin-user-quota-5h"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("adminUsers.unlimitedQuota")}
                  value={editQuota5H}
                  onChange={(e) => setEditQuota5H(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-admin-user-quota-7d">
                  {t("adminUsers.quota7d")}
                </FieldLabel>
                <Input
                  id="edit-admin-user-quota-7d"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("adminUsers.unlimitedQuota")}
                  value={editQuota7D}
                  onChange={(e) => setEditQuota7D(e.target.value)}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={editing}
                onClick={() => setEditTarget(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={editing}>
                {editing ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pwdTarget !== null}
        onOpenChange={(next) => {
          if (!next && !pwdSubmitting) {
            setPwdTarget(null)
            setPwdDone(false)
            setPwdCopied(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          {pwdDone ? (
            <div className="flex flex-col gap-5">
              <DialogHeader>
                <DialogTitle>{t("adminUsers.passwordReset")}</DialogTitle>
                <DialogDescription>
                  {t("adminUsers.closePasswordDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Input
                  readOnly
                  value={pwdValue}
                  className="font-mono"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={copyPassword}
                >
                  {pwdCopied ? t("common.copied") : t("common.copy")}
                </Button>
              </div>
              <DialogFooter>
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
              </DialogFooter>
            </div>
          ) : (
            <form
              onSubmit={handleResetPassword}
              className="flex flex-col gap-5"
            >
              <DialogHeader>
                <DialogTitle>{t("adminUsers.resetPassword")}</DialogTitle>
                <DialogDescription>
                  {pwdTarget ? accountLabel(pwdTarget) : null}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <Field>
                  <FieldLabel htmlFor="reset-admin-user-password">
                    {t("adminUsers.newPassword")}
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="reset-admin-user-password"
                      type="text"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={pwdValue}
                      onChange={(e) => setPwdValue(e.target.value)}
                      className="min-w-0 flex-1 font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setPwdValue(generatePassword())}
                    >
                      <Sparkles />
                      {t("adminUsers.randomPassword")}
                    </Button>
                  </div>
                  <FieldDescription className="text-xs">
                    {t("adminUsers.minPassword")}
                  </FieldDescription>
                </Field>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pwdSubmitting}
                  onClick={() => setPwdTarget(null)}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pwdSubmitting}>
                  {pwdSubmitting
                    ? t("adminUsers.resetting")
                    : t("adminUsers.resetPassword")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={banTarget !== null}
        onOpenChange={(next) => {
          if (!next && !banSubmitting) {
            setBanTarget(null)
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
