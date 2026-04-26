import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Check,
  Copy,
  KeyRound,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react"

import {
  createAPIKey,
  listAPIKeys,
  renameAPIKey,
  revokeAPIKey,
  type APIKey,
  type APIKeyExpiry,
} from "@/lib/api-keys-client"
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
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

const expiryOptions: Array<{ value: APIKeyExpiry; label: string }> = [
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" },
  { value: "365d", label: "365 天" },
  { value: "never", label: "永不过期" },
]

type KeyFilter = "active" | "expired" | "revoked"

function formatDate(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return dateFmt.format(date)
}

function isExpiredKey(key: APIKey) {
  return (
    key.status !== "revoked" &&
    !!key.expires_at &&
    new Date(key.expires_at).getTime() <= Date.now()
  )
}

function statusLabel(key: APIKey) {
  if (key.status === "revoked") return "已撤销"
  if (isExpiredKey(key)) return "已过期"
  return "有效"
}

function keyDisplay(key: APIKey) {
  return `${key.key_prefix}••••••••`
}

function matchesFilter(key: APIKey, filter: KeyFilter) {
  if (filter === "active") return statusLabel(key) === "有效"
  if (filter === "expired") return statusLabel(key) === "已过期"
  return statusLabel(key) === "已撤销"
}

export default function SettingsAPIKeysPage() {
  const [keys, setKeys] = useState<APIKey[]>([])
  const [filter, setFilter] = useState<KeyFilter>("active")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<APIKey | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<APIKey | null>(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    let cancelled = false
    listAPIKeys()
      .then((next) => {
        if (!cancelled) setKeys(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载 API Keys 失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filteredKeys = useMemo(
    () => keys.filter((key) => matchesFilter(key, filter)),
    [filter, keys]
  )

  async function confirmRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    setError(null)
    try {
      await revokeAPIKey(revokeTarget.id)
      setKeys((prev) =>
        prev.map((key) =>
          key.id === revokeTarget.id
            ? {
                ...key,
                status: "revoked",
                revoked_at: new Date().toISOString(),
              }
            : key
        )
      )
      setRevokeTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤销 API Key 失败")
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-2xl text-sm text-muted-foreground">
            用于外部 CLI、SDK 或脚本通过当前网关访问模型服务。已创建的 Key
            只会显示前缀；新 Key 创建后请立即复制保存。
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as KeyFilter)}
        >
          <TabsList>
            <TabsTrigger value="active">有效</TabsTrigger>
            <TabsTrigger value="expired">已过期</TabsTrigger>
            <TabsTrigger value="revoked">已撤销</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          创建 API Key
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40">名称</TableHead>
              <TableHead className="min-w-44">Key</TableHead>
              <TableHead className="min-w-36">过期时间</TableHead>
              <TableHead className="min-w-36">最近使用</TableHead>
              <TableHead className="min-w-36">创建时间</TableHead>
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
                  加载中…
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filteredKeys.map((key) => (
                <KeyRow
                  key={key.id}
                  apiKey={key}
                  onRename={() => setRenameTarget(key)}
                  onRevoke={() => setRevokeTarget(key)}
                />
              ))}
            {!loading && filteredKeys.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-muted-foreground"
                >
                  暂无 API Key
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(key) => setKeys((prev) => [key, ...prev])}
      />

      <RenameKeyDialog
        target={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        onSaved={(updated) => {
          setKeys((prev) =>
            prev.map((key) => (key.id === updated.id ? updated : key))
          )
          setRenameTarget(null)
        }}
      />

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) setRevokeTarget(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>撤销该 API Key？</AlertDialogTitle>
            <AlertDialogDescription>
              “{revokeTarget?.name ?? ""}” 撤销后不能再用于模型访问。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={() => void confirmRevoke()}
            >
              {revoking ? "撤销中…" : "撤销"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function KeyRow({
  apiKey,
  onRename,
  onRevoke,
}: {
  apiKey: APIKey
  onRename: () => void
  onRevoke: () => void
}) {
  const revoked = apiKey.status === "revoked"

  return (
    <TableRow>
      <TableCell className="max-w-52 truncate font-medium">
        {apiKey.name}
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs text-muted-foreground">
          {keyDisplay(apiKey)}
        </code>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {apiKey.expires_at ? formatDate(apiKey.expires_at) : "永不过期"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(apiKey.last_used_at)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(apiKey.created_at)}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="更多操作" />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={revoked} onClick={onRename}>
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={revoked}
              onClick={onRevoke}
            >
              <Trash2 />
              撤销
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function RenameKeyDialog({
  target,
  onOpenChange,
  onSaved,
}: {
  target: APIKey | null
  onOpenChange: (open: boolean) => void
  onSaved: (key: APIKey) => void
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      key={target?.id ?? "none"}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重命名 API Key</DialogTitle>
          <DialogDescription>仅修改名称，不会改变 Key 本身。</DialogDescription>
        </DialogHeader>
        {target && <RenameKeyForm target={target} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function RenameKeyForm({
  target,
  onSaved,
}: {
  target: APIKey
  onSaved: (key: APIKey) => void
}) {
  const [name, setName] = useState(target.name)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === target.name) return
    setSubmitting(true)
    setError(null)
    try {
      const updated = await renameAPIKey(target.id, trimmed)
      onSaved(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败")
    } finally {
      setSubmitting(false)
    }
  }

  const trimmed = name.trim()
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rename-key-name">名称</Label>
        <Input
          id="rename-key-name"
          required
          maxLength={128}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitting || !trimmed || trimmed === target.name}
        >
          {submitting ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  )
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (key: APIKey) => void
}) {
  const [name, setName] = useState("")
  const [expiresIn, setExpiresIn] = useState<APIKeyExpiry>("90d")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setName("")
    setExpiresIn("90d")
    setSubmitting(false)
    setError(null)
    setCreatedKey(null)
    setCopied(false)
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) reset()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await createAPIKey(trimmed, expiresIn)
      const { key: rawKey, ...safeKey } = created
      setCreatedKey(rawKey)
      onCreated(safeKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建 API Key 失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!createdKey) return
    try {
      await navigator.clipboard.writeText(createdKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError("复制失败，请手动选中复制")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <DialogTitle>
              {createdKey ? "API Key 已创建" : "创建 API Key"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {createdKey
              ? "请立即复制并妥善保管。关闭窗口后将只显示 Key 前缀。"
              : "为外部客户端创建一把用户 API Key。"}
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
              <code className="min-w-0 flex-1 font-mono text-xs break-all">
                {createdKey}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCopy()}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                完成
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">名称</Label>
              <Input
                id="key-name"
                required
                maxLength={128}
                placeholder="例如：本机 Codex"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-expiry">有效期</Label>
              <select
                id="key-expiry"
                value={expiresIn}
                onChange={(event) =>
                  setExpiresIn(event.target.value as APIKeyExpiry)
                }
                className="h-9 rounded-md border border-input bg-popover px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {expiryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? "创建中…" : "创建"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
