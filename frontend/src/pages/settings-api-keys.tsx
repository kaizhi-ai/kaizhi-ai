import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Check,
  Copy,
  KeyRound,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react"
import { useTranslation } from "react-i18next"

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

const expiryOptions: APIKeyExpiry[] = ["30d", "90d", "365d", "never"]

type KeyFilter = "active" | "expired" | "revoked"

function formatDate(value: string | undefined, dateFmt: Intl.DateTimeFormat) {
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

function statusKey(key: APIKey): KeyFilter {
  if (key.status === "revoked") return "revoked"
  if (isExpiredKey(key)) return "expired"
  return "active"
}

function keyDisplay(key: APIKey) {
  return `${key.key_prefix}••••••••`
}

function matchesFilter(key: APIKey, filter: KeyFilter) {
  return statusKey(key) === filter
}

export default function SettingsAPIKeysPage() {
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
          setError(
            err instanceof Error ? err.message : t("errors.loadAPIKeysFailed")
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

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
      setError(
        err instanceof Error ? err.message : t("errors.revokeAPIKeyFailed")
      )
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t("apiKeys.title")}</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("apiKeys.description")}
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
            <TabsTrigger value="active">{t("apiKeys.active")}</TabsTrigger>
            <TabsTrigger value="expired">{t("apiKeys.expired")}</TabsTrigger>
            <TabsTrigger value="revoked">{t("apiKeys.revoked")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          {t("apiKeys.createTitle")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40">{t("common.name")}</TableHead>
              <TableHead className="min-w-44">{t("apiKeys.key")}</TableHead>
              <TableHead className="min-w-36">
                {t("apiKeys.expiresAt")}
              </TableHead>
              <TableHead className="min-w-36">
                {t("apiKeys.lastUsedAt")}
              </TableHead>
              <TableHead className="min-w-36">
                {t("common.createdAt")}
              </TableHead>
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
                  {t("common.loading")}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filteredKeys.map((key) => (
                <KeyRow
                  key={key.id}
                  apiKey={key}
                  dateFmt={dateFmt}
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
                  {t("apiKeys.noKeys")}
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
            <AlertDialogTitle>
              {t("apiKeys.revokeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("apiKeys.revokeConfirmDescription", {
                name: revokeTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={() => void confirmRevoke()}
            >
              {revoking ? t("common.revoking") : t("common.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function KeyRow({
  apiKey,
  dateFmt,
  onRename,
  onRevoke,
}: {
  apiKey: APIKey
  dateFmt: Intl.DateTimeFormat
  onRename: () => void
  onRevoke: () => void
}) {
  const { t } = useTranslation()
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
        {apiKey.expires_at
          ? formatDate(apiKey.expires_at, dateFmt)
          : t("apiKeys.neverExpires")}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(apiKey.last_used_at, dateFmt)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(apiKey.created_at, dateFmt)}
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
            <DropdownMenuItem disabled={revoked} onClick={onRename}>
              {t("common.rename")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={revoked}
              onClick={onRevoke}
            >
              <Trash2 />
              {t("common.revoke")}
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
  const { t } = useTranslation()
  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      key={target?.id ?? "none"}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("apiKeys.renameTitle")}</DialogTitle>
          <DialogDescription>
            {t("apiKeys.renameDescription")}
          </DialogDescription>
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
  const { t } = useTranslation()
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
      setError(err instanceof Error ? err.message : t("errors.renameFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  const trimmed = name.trim()
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rename-key-name">{t("common.name")}</Label>
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
          {submitting ? t("common.saving") : t("common.save")}
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
  const { t } = useTranslation()
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
      setError(
        err instanceof Error ? err.message : t("errors.createAPIKeyFailed")
      )
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
      setError(t("common.copyFailed"))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <DialogTitle>
              {createdKey
                ? t("apiKeys.createdTitle")
                : t("apiKeys.createTitle")}
            </DialogTitle>
          </div>
          <DialogDescription>
            {createdKey
              ? t("apiKeys.copyDescriptionCreated")
              : t("apiKeys.createDescription")}
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
                {copied ? t("common.copied") : t("common.copy")}
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t("common.complete")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">{t("common.name")}</Label>
              <Input
                id="key-name"
                required
                maxLength={128}
                placeholder={t("apiKeys.namePlaceholder")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-expiry">{t("apiKeys.expiry")}</Label>
              <select
                id="key-expiry"
                value={expiresIn}
                onChange={(event) =>
                  setExpiresIn(event.target.value as APIKeyExpiry)
                }
                className="h-9 rounded-md border border-input bg-popover px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {expiryOptions.map((option) => (
                  <option key={option} value={option}>
                    {t(`expiry.${option}`)}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? t("common.creating") : t("common.create")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
