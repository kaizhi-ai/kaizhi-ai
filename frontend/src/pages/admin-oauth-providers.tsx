import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Check,
  Copy,
  ExternalLink,
  LogIn,
  MoreHorizontal,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  deleteOAuthProvider,
  finishOAuthProvider,
  listOAuthProviders,
  startOAuthProvider,
  updateOAuthProviderDisabled,
  updateOAuthProviderProxyURL,
  type AuthFile,
  type OAuthProviderId,
} from "@/lib/oauth-providers-client"
import {
  proxyEnabledFromURL,
  proxyStatusKey,
  proxyURLFromEnabled,
} from "@/lib/proxy-mode"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ProxySwitchField } from "@/components/admin/proxy-switch-field"

const PROVIDERS: OAuthProviderId[] = ["codex", "anthropic", "gemini"]

const PROVIDER_META: Record<
  OAuthProviderId,
  { label: string; descriptionKey: string }
> = {
  codex: {
    label: "Codex (ChatGPT)",
    descriptionKey: "provider.providerDescriptions.oauthCodex",
  },
  anthropic: {
    label: "Claude (Anthropic)",
    descriptionKey: "provider.providerDescriptions.anthropic",
  },
  gemini: {
    label: "Gemini (Google)",
    descriptionKey: "provider.providerDescriptions.oauthGemini",
  },
}

type FilesByProvider = Record<OAuthProviderId, AuthFile[]>
type Row = { provider: OAuthProviderId; file: AuthFile }
type DeleteTarget = Row
type ProxyTarget = Row

function emptyFiles(): FilesByProvider {
  return { codex: [], anthropic: [], gemini: [] }
}

function formatDate(value: string | undefined, dateFmt: Intl.DateTimeFormat) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return dateFmt.format(date)
}

function fileTitle(file: AuthFile) {
  return file.email || file.label || file.name
}

function rowKey(row: Row) {
  return `${row.provider}-${row.file.id || row.file.name}`
}

function statusTranslationKey(file: AuthFile) {
  if (file.disabled) return "provider.status.disabled"
  switch (file.status) {
    case "active":
      return "provider.status.active"
    case "pending":
      return "provider.status.pending"
    case "refreshing":
      return "provider.status.refreshing"
    case "error":
      return "provider.status.error"
    case "disabled":
      return "provider.status.disabled"
    default:
      return null
  }
}

function statusClassName(file: AuthFile) {
  if (file.disabled || file.status === "disabled") {
    return "text-xs text-muted-foreground"
  }
  if (file.status === "error") return "text-xs text-destructive"
  return "text-xs text-foreground"
}

export default function AdminOAuthProvidersPage() {
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
  const [filesByProvider, setFilesByProvider] =
    useState<FilesByProvider>(emptyFiles)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addProvider, setAddProvider] = useState<OAuthProviderId>("codex")
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [proxyTarget, setProxyTarget] = useState<ProxyTarget | null>(null)
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(
    null
  )

  async function refreshProvider(provider: OAuthProviderId) {
    const files = await listOAuthProviders(provider)
    setFilesByProvider((prev) => ({ ...prev, [provider]: files }))
    return files
  }

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      Promise.all(PROVIDERS.map((provider) => listOAuthProviders(provider)))
        .then(([codex, anthropic, gemini]) => {
          if (!cancelled) setFilesByProvider({ codex, anthropic, gemini })
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : t("errors.loadOAuthProvidersFailed")
            )
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [t])

  const rows = useMemo<Row[]>(
    () =>
      PROVIDERS.flatMap((provider) =>
        filesByProvider[provider].map((file) => ({ provider, file }))
      ),
    [filesByProvider]
  )

  async function toggleDisabled(row: Row) {
    const key = rowKey(row)
    setStatusUpdatingKey(key)
    setError(null)
    try {
      const updated = await updateOAuthProviderDisabled(
        row.provider,
        row.file.name,
        !row.file.disabled
      )
      setFilesByProvider((prev) => ({
        ...prev,
        [row.provider]: prev[row.provider].map((file) =>
          file.id === updated.id || file.name === updated.name ? updated : file
        ),
      }))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("errors.saveStatusFailed")
      )
    } finally {
      setStatusUpdatingKey(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    try {
      await deleteOAuthProvider(deleteTarget.provider, deleteTarget.file.name)
      setFilesByProvider((prev) => ({
        ...prev,
        [deleteTarget.provider]: prev[deleteTarget.provider].filter(
          (file) => file.name !== deleteTarget.file.name
        ),
      }))
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">OAuth Provider</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("provider.oauthDescription")}
          </p>
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => setAddOpen(true)}
        >
          <Plus />
          {t("common.addProvider")}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table className="min-w-[840px]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-44">{t("common.type")}</TableHead>
              <TableHead className="min-w-56">
                {t("provider.oauthAccount")}
              </TableHead>
              <TableHead className="min-w-24">
                {t("adminUsers.status")}
              </TableHead>
              <TableHead className="min-w-24">{t("common.proxy")}</TableHead>
              <TableHead className="min-w-40">
                {t("adminUsers.updatedAt")}
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
              rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  className={row.file.disabled ? "bg-muted/20" : undefined}
                >
                  <TableCell className="text-xs text-muted-foreground">
                    {PROVIDER_META[row.provider].label}
                  </TableCell>
                  <TableCell className="max-w-80 truncate font-medium">
                    {fileTitle(row.file)}
                  </TableCell>
                  <TableCell
                    className={statusClassName(row.file)}
                    title={row.file.status_message}
                  >
                    {statusTranslationKey(row.file)
                      ? t(statusTranslationKey(row.file)!)
                      : row.file.status || "-"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t(`proxy.${proxyStatusKey(row.file.proxy_url)}`)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(row.file.updated_at, dateFmt)}
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
                        <DropdownMenuItem
                          disabled={statusUpdatingKey === rowKey(row)}
                          onClick={() => void toggleDisabled(row)}
                        >
                          {row.file.disabled ? <Power /> : <PowerOff />}
                          {row.file.disabled
                            ? t("provider.toggleDisabledEnable")
                            : t("provider.toggleDisabledDisable")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setProxyTarget(row)}>
                          {t("provider.editProxy")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-muted-foreground"
                >
                  {t("provider.emptyOAuthProvider")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          setAddOpen(next)
          if (!next) setAddProvider("codex")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("provider.addOAuthProvider")}</DialogTitle>
            <DialogDescription>
              {t("provider.oauthLoginDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oauth-provider">{t("common.type")}</Label>
            <Select
              value={addProvider}
              onValueChange={(value) =>
                setAddProvider(value as OAuthProviderId)
              }
            >
              <SelectTrigger id="oauth-provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {PROVIDER_META[provider].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <OAuthFlow
            key={addProvider}
            provider={addProvider}
            onSuccess={(files) => {
              setFilesByProvider((prev) => ({ ...prev, [addProvider]: files }))
              setAddOpen(false)
              setAddProvider("codex")
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={proxyTarget !== null}
        onOpenChange={(next) => {
          if (!next) setProxyTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {proxyTarget
                ? t("provider.editTitle", { name: fileTitle(proxyTarget.file) })
                : ""}
            </DialogTitle>
            <DialogDescription>{t("proxy.fieldDescription")}</DialogDescription>
          </DialogHeader>
          {proxyTarget && (
            <ProxyURLForm
              target={proxyTarget}
              onSaved={async () => {
                setProxyTarget(null)
                await refreshProvider(proxyTarget.provider)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("provider.deleteOAuthProviderTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("provider.deleteProviderDescription", {
                name: deleteTarget ? fileTitle(deleteTarget.file) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function OAuthFlow({
  provider,
  onSuccess,
}: {
  provider: OAuthProviderId
  onSuccess: (files: AuthFile[]) => void
}) {
  const { t } = useTranslation()
  const meta = PROVIDER_META[provider]
  const [authState, setAuthState] = useState<string | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [projectId, setProjectId] = useState("")
  const [proxyEnabled, setProxyEnabled] = useState(true)
  const [redirectUrl, setRedirectUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const proxyUrl = proxyURLFromEnabled(proxyEnabled)

  async function start() {
    setError(null)
    setStarting(true)
    try {
      const result = await startOAuthProvider(provider, { projectId, proxyUrl })
      setAuthUrl(result.url)
      setAuthState(result.state)
      setRedirectUrl("")
      setCopied(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("errors.startOAuthFailed")
      )
    } finally {
      setStarting(false)
    }
  }

  async function copyAuthURL() {
    if (!authUrl) return
    try {
      await navigator.clipboard.writeText(authUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError(t("common.copyFailed"))
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!authState || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await finishOAuthProvider(provider, {
        state: authState,
        redirectUrl,
      })
      const nextFiles = await listOAuthProviders(provider)
      onSuccess(nextFiles)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("errors.oauthLoginFailed")
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!authUrl) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t(meta.descriptionKey)}
        </p>
        {provider === "gemini" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gemini-project">Project ID</Label>
            <Input
              id="gemini-project"
              placeholder={t("provider.geminiProjectPlaceholder")}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-9 font-mono"
            />
          </div>
        )}
        <ProxySwitchField
          id="oauth-proxy-new"
          checked={proxyEnabled}
          onCheckedChange={setProxyEnabled}
        />
        {error && <p className="text-sm break-all text-destructive">{error}</p>}
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => void start()}
            disabled={starting}
          >
            <LogIn />
            {starting ? t("common.preparing") : t("provider.startOAuth")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>{t("provider.oauthAuthURL")}</Label>
        <div className="flex gap-2">
          <Input
            readOnly
            value={authUrl}
            className="h-9 flex-1 bg-muted/40 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("common.copy")}
            onClick={() => void copyAuthURL()}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("provider.oauthOpen")}
            onClick={() => window.open(authUrl, "_blank", "noopener")}
          >
            <ExternalLink />
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="oauth-redirect">{t("provider.oauthRedirectURL")}</Label>
        <Textarea
          id="oauth-redirect"
          required
          wrap="soft"
          rows={3}
          placeholder="http://localhost:1455/?code=...&state=..."
          value={redirectUrl}
          onChange={(event) => setRedirectUrl(event.target.value)}
          className="field-sizing-fixed max-w-full min-w-0 resize-y overflow-x-hidden font-mono text-xs [overflow-wrap:anywhere] break-all whitespace-pre-wrap"
        />
      </div>
      {error && <p className="text-sm break-all text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting || !redirectUrl.trim()}>
          {submitting ? t("common.submittingLogin") : t("common.submit")}
        </Button>
      </div>
    </form>
  )
}

function ProxyURLForm({
  target,
  onSaved,
}: {
  target: ProxyTarget
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [proxyEnabled, setProxyEnabled] = useState(() =>
    proxyEnabledFromURL(target.file.proxy_url)
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await updateOAuthProviderProxyURL(
        target.provider,
        target.file.name,
        proxyURLFromEnabled(proxyEnabled)
      )
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.saveFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <ProxySwitchField
        id="oauth-proxy"
        checked={proxyEnabled}
        onCheckedChange={setProxyEnabled}
      />
      {error && <p className="text-sm break-all text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  )
}
