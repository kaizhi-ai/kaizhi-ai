import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Eye, EyeOff, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { modelAliasFromName } from "@/lib/model-alias"
import {
  createProviderAPIKey,
  deleteProviderAPIKey,
  fetchProviderAPIKeyModels,
  listProviderAPIKeys,
  updateProviderAPIKey,
  type ProviderAPIKey,
  type ProviderAPIKeyKind,
  type ProviderAPIKeyModel,
} from "@/lib/provider-api-keys-client"
import {
  proxyEnabledFromURL,
  proxyStatusKey,
  proxyURLFromEnabled,
} from "@/lib/proxy-mode"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import {
  ExcludedRowsEditor,
  ModelRowsEditor,
} from "@/components/admin/model-rows-editors"
import { ProxySwitchField } from "@/components/admin/proxy-switch-field"

const KEY_META: Record<
  ProviderAPIKeyKind,
  { label: string; descriptionKey: string; defaultBaseUrl: string }
> = {
  claude: {
    label: "Anthropic",
    descriptionKey: "provider.providerDescriptions.claude",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  gemini: {
    label: "Gemini",
    descriptionKey: "provider.providerDescriptions.gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
  },
  codex: {
    label: "OpenAI Response",
    descriptionKey: "provider.providerDescriptions.codex",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
}

const VENDOR_ORDER: ProviderAPIKeyKind[] = ["claude", "gemini", "codex"]

type Row = ProviderAPIKey & { provider: ProviderAPIKeyKind }
type DeleteTarget = Row
type EditTarget = Row

function normalizeRows(rows?: ProviderAPIKeyModel[]) {
  return rows?.map((row) => ({ name: row.name, alias: row.alias })) ?? []
}

function normalizeExcluded(rows?: string[]) {
  return rows?.map((row) => row.trim()).filter(Boolean) ?? []
}

function rowLabel(row: Row) {
  return row.api_key_preview || `${KEY_META[row.provider].label} #${row.index}`
}

export default function AdminAPIKeyProviderPage() {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<ProviderAPIKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addKind, setAddKind] = useState<ProviderAPIKeyKind>("claude")
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function refreshKeys() {
    const next = await listProviderAPIKeys()
    setKeys(next)
  }

  useEffect(() => {
    let cancelled = false
    listProviderAPIKeys()
      .then((next) => {
        if (!cancelled) setKeys(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t("errors.loadAPIKeyProvidersFailed")
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

  const rows = useMemo<Row[]>(
    () =>
      VENDOR_ORDER.flatMap((kind) =>
        (keys.filter((key) => key.provider === kind) as Row[]).sort(
          (a, b) => a.index - b.index
        )
      ),
    [keys]
  )

  async function handleSaved() {
    setAddOpen(false)
    setEditTarget(null)
    setError(null)
    try {
      await refreshKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.refreshFailed"))
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    try {
      await deleteProviderAPIKey(deleteTarget.id)
      await refreshKeys()
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">API Key Provider</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("provider.apiKeyProviderDescription")}
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
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table className="min-w-[840px]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-36">{t("common.type")}</TableHead>
              <TableHead className="min-w-40">API Key</TableHead>
              <TableHead className="min-w-56">Base URL</TableHead>
              <TableHead className="min-w-24">{t("common.proxy")}</TableHead>
              <TableHead className="w-24">
                {t("provider.whitelistModels")}
              </TableHead>
              <TableHead className="w-24">
                {t("provider.excludedModels")}
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
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {KEY_META[row.provider].label}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.api_key_preview || "-"}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                    {row.base_url || KEY_META[row.provider].defaultBaseUrl}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t(`proxy.${proxyStatusKey(row.proxy_url)}`)}
                  </TableCell>
                  <TableCell>{row.models?.length ?? 0}</TableCell>
                  <TableCell>{row.excluded_models?.length ?? 0}</TableCell>
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
                        <DropdownMenuItem onClick={() => setEditTarget(row)}>
                          {t("common.edit")}
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
                  colSpan={7}
                  className="py-12 text-center text-muted-foreground"
                >
                  {t("provider.emptyAPIKeyProvider")}
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
          if (!next) setAddKind("claude")
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("provider.addAPIKeyProvider")}</DialogTitle>
            <DialogDescription>
              {t("provider.selectTypeCredentials")}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="api-key-provider-kind">
              {t("common.type")}
            </FieldLabel>
            <Select
              value={addKind}
              onValueChange={(value) => setAddKind(value as ProviderAPIKeyKind)}
            >
              <SelectTrigger id="api-key-provider-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VENDOR_ORDER.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {KEY_META[kind].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ProviderKeyForm
            key={addKind}
            kind={addKind}
            onSuccess={() => void handleSaved()}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={editTarget !== null}
        onOpenChange={(next) => {
          if (!next) setEditTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editTarget
                ? t("provider.editAPIKeyTitle", {
                    provider: KEY_META[editTarget.provider].label,
                  })
                : ""}
            </DialogTitle>
            <DialogDescription>
              {t("provider.keyUnchangedPlaceholder")}
            </DialogDescription>
          </DialogHeader>
          {editTarget && (
            <ProviderKeyForm
              kind={editTarget.provider}
              initial={editTarget}
              onSuccess={() => void handleSaved()}
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
              {t("provider.deleteAPIKeyProviderTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("provider.deleteProviderDescription", {
                name: deleteTarget ? rowLabel(deleteTarget) : "",
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

function ProviderKeyForm({
  kind,
  initial,
  onSuccess,
}: {
  kind: ProviderAPIKeyKind
  initial?: Row
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const meta = KEY_META[kind]
  const isEdit = initial !== undefined
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState(
    initial?.base_url || meta.defaultBaseUrl
  )
  const [proxyEnabled, setProxyEnabled] = useState(() =>
    proxyEnabledFromURL(initial?.proxy_url)
  )
  const [models, setModels] = useState<ProviderAPIKeyModel[]>(
    normalizeRows(initial?.models)
  )
  const [excludedModels, setExcludedModels] = useState<string[]>(
    normalizeExcluded(initial?.excluded_models)
  )
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetching, setFetching] = useState(false)
  const proxyUrl = proxyURLFromEnabled(proxyEnabled)

  async function handleFetchModels() {
    setError(null)
    setFetching(true)
    try {
      const ids = await fetchProviderAPIKeyModels({
        provider: kind,
        id: initial?.id,
        apiKey,
        baseUrl,
        proxyUrl,
      })
      setModels(ids.map((id) => ({ name: id, alias: modelAliasFromName(id) })))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("errors.fetchModelsFailed")
      )
    } finally {
      setFetching(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!baseUrl.trim()) {
      setError(t("errors.baseURLRequired"))
      return
    }
    if (!isEdit && !apiKey.trim()) {
      setError(t("errors.apiKeyRequired"))
      return
    }

    setSubmitting(true)
    try {
      const input = {
        provider: kind,
        apiKey,
        baseUrl,
        proxyUrl,
        models,
        excludedModels,
      }
      if (initial) {
        await updateProviderAPIKey(initial.id, input)
      } else {
        await createProviderAPIKey(input)
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.saveFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {!isEdit && <FieldDescription>{t(meta.descriptionKey)}</FieldDescription>}
      <Field>
        <FieldLabel htmlFor={`provider-key-${kind}`}>API Key</FieldLabel>
        <div className="flex gap-2">
          <Input
            id={`provider-key-${kind}`}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            required={!isEdit}
            placeholder={isEdit ? t("provider.keyUnchangedPlaceholder") : ""}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="flex-1 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={showKey ? t("common.hide") : t("common.show")}
            onClick={() => setShowKey((value) => !value)}
          >
            {showKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor={`provider-base-url-${kind}`}>Base URL</FieldLabel>
        <Input
          id={`provider-base-url-${kind}`}
          required
          placeholder={meta.defaultBaseUrl}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </Field>
      <ProxySwitchField
        id={`provider-proxy-${kind}`}
        checked={proxyEnabled}
        onCheckedChange={setProxyEnabled}
      />
      <Field>
        <FieldLabel>{t("provider.whitelistModels")}</FieldLabel>
        <FieldDescription>{t("provider.whitelistModelsHint")}</FieldDescription>
        <ModelRowsEditor
          rows={models}
          onChange={setModels}
          fetchSlot={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fetching || !baseUrl.trim()}
              onClick={() => void handleFetchModels()}
            >
              {fetching ? t("common.fetching") : t("common.fetchFromModels")}
            </Button>
          }
        />
      </Field>
      <Field>
        <FieldLabel>{t("provider.excludedModels")}</FieldLabel>
        <FieldDescription>{t("provider.excludedModelsHint")}</FieldDescription>
        <ExcludedRowsEditor
          rows={excludedModels}
          onChange={setExcludedModels}
        />
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  )
}
