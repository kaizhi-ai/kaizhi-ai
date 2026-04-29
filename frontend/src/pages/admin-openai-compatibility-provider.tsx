import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Eye, EyeOff, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { modelAliasFromName } from "@/lib/model-alias"
import {
  createOpenAICompatibilityProvider,
  deleteOpenAICompatibilityProvider,
  fetchOpenAICompatibilityProviderModels,
  listOpenAICompatibilityProviders,
  updateOpenAICompatibilityProvider,
  type OpenAICompatibilityAPIKeyInput,
  type OpenAICompatibilityProvider,
  type OpenAICompatibilityProviderModel,
} from "@/lib/openai-compatibility-providers-client"
import {
  proxyEnabledFromURL,
  proxySummaryKey,
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
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ModelRowsEditor } from "@/components/admin/model-rows-editors"

const DEFAULT_BASE_URL = "https://api.openai.com/v1"

type DeleteTarget = OpenAICompatibilityProvider
type EditTarget = OpenAICompatibilityProvider
type EditableAPIKeyEntry = {
  localId: string
  index?: number
  apiKey: string
  proxyEnabled: boolean
  preview?: string
  hasSavedKey: boolean
  showKey: boolean
}

let apiKeyRowID = 0

function nextAPIKeyRowID() {
  apiKeyRowID += 1
  return `openai-compat-key-${apiKeyRowID}`
}

function normalizeRows(rows?: OpenAICompatibilityProviderModel[]) {
  return rows?.map((row) => ({ name: row.name, alias: row.alias })) ?? []
}

function rowLabel(row: OpenAICompatibilityProvider) {
  return row.name || `OpenAI Compatibility #${row.index}`
}

function apiKeyCount(row: OpenAICompatibilityProvider) {
  const entryCount =
    row.api_key_entries?.filter((entry) => entry.has_api_key).length ?? 0
  if (entryCount > 0) return entryCount
  return row.has_api_key ? 1 : 0
}

function apiKeySummary(row: OpenAICompatibilityProvider, configured: string) {
  const count = apiKeyCount(row)
  if (count === 0) return "-"
  const preview =
    row.api_key_entries?.find((entry) => entry.has_api_key)?.api_key_preview ||
    row.api_key_preview ||
    configured
  if (count === 1) return preview
  return `${preview} +${count - 1}`
}

function proxySummaryKeyFor(row: OpenAICompatibilityProvider) {
  const proxies =
    row.api_key_entries
      ?.filter((entry) => entry.has_api_key)
      .map((entry) => entry.proxy_url) ?? []
  return proxySummaryKey(proxies, row.proxy_url)
}

function keyRowsFromProvider(
  initial?: OpenAICompatibilityProvider
): EditableAPIKeyEntry[] {
  const entries = initial?.api_key_entries ?? []
  if (entries.length > 0) {
    return entries.map((entry) => ({
      localId: nextAPIKeyRowID(),
      index: entry.index,
      apiKey: "",
      proxyEnabled: proxyEnabledFromURL(entry.proxy_url),
      preview: entry.api_key_preview,
      hasSavedKey: entry.has_api_key,
      showKey: false,
    }))
  }
  return [
    {
      localId: nextAPIKeyRowID(),
      index: initial?.has_api_key ? 0 : undefined,
      apiKey: "",
      proxyEnabled: proxyEnabledFromURL(initial?.proxy_url),
      preview: initial?.api_key_preview,
      hasSavedKey: initial?.has_api_key ?? false,
      showKey: false,
    },
  ]
}

export default function AdminOpenAICompatibilityProviderPage() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<OpenAICompatibilityProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function refreshProviders() {
    const next = await listOpenAICompatibilityProviders()
    setProviders(next)
  }

  useEffect(() => {
    let cancelled = false
    listOpenAICompatibilityProviders()
      .then((next) => {
        if (!cancelled) setProviders(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t("errors.loadOpenAICompatibilityProvidersFailed")
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

  const rows = useMemo(
    () => [...providers].sort((a, b) => a.index - b.index),
    [providers]
  )

  async function handleSaved() {
    setAddOpen(false)
    setEditTarget(null)
    setError(null)
    try {
      await refreshProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.refreshFailed"))
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    try {
      await deleteOpenAICompatibilityProvider(deleteTarget.name)
      await refreshProviders()
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
          <h1 className="text-xl font-semibold">
            OpenAI Compatibility Provider
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("provider.openAICompatibilityDescription")}
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
              <TableHead className="min-w-40">{t("common.name")}</TableHead>
              <TableHead className="min-w-40">API Keys</TableHead>
              <TableHead className="min-w-64">Base URL</TableHead>
              <TableHead className="min-w-24">{t("common.proxy")}</TableHead>
              <TableHead className="w-24">{t("provider.models")}</TableHead>
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
                <TableRow key={row.id || row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {apiKeySummary(row, t("provider.configured"))}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                    {row.base_url || DEFAULT_BASE_URL}
                  </TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
                    {t(`proxy.${proxySummaryKeyFor(row)}`)}
                  </TableCell>
                  <TableCell>{row.models?.length ?? 0}</TableCell>
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
                  colSpan={6}
                  className="py-12 text-center text-muted-foreground"
                >
                  {t("provider.emptyOpenAICompatibilityProvider")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {t("provider.addOpenAICompatibilityProvider")}
            </DialogTitle>
            <DialogDescription>
              {t("provider.selectTypeCredentials")}
            </DialogDescription>
          </DialogHeader>
          <OpenAICompatibilityProviderForm
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
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editTarget
                ? t("provider.editTitle", { name: editTarget.name })
                : ""}
            </DialogTitle>
            <DialogDescription>
              {t("provider.editAddressCredentialsModels")}
            </DialogDescription>
          </DialogHeader>
          {editTarget && (
            <OpenAICompatibilityProviderForm
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
              {t("provider.deleteOpenAIProviderTitle")}
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

function OpenAICompatibilityProviderForm({
  initial,
  onSuccess,
}: {
  initial?: OpenAICompatibilityProvider
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const isEdit = initial !== undefined
  const [name, setName] = useState(initial?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(initial?.base_url || DEFAULT_BASE_URL)
  const [apiKeyEntries, setAPIKeyEntries] = useState<EditableAPIKeyEntry[]>(
    () => keyRowsFromProvider(initial)
  )
  const [models, setModels] = useState<OpenAICompatibilityProviderModel[]>(
    normalizeRows(initial?.models)
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetching, setFetching] = useState(false)

  const fetchKeyEntry =
    apiKeyEntries.find((entry) => entry.apiKey.trim()) ??
    apiKeyEntries.find((entry) => entry.hasSavedKey)
  const canFetchModels = Boolean(
    baseUrl.trim() &&
    (fetchKeyEntry?.apiKey.trim() || fetchKeyEntry?.hasSavedKey)
  )

  function updateAPIKeyEntry(
    localId: string,
    patch: Partial<EditableAPIKeyEntry>
  ) {
    setAPIKeyEntries((entries) =>
      entries.map((entry) =>
        entry.localId === localId ? { ...entry, ...patch } : entry
      )
    )
  }

  function addAPIKeyEntry() {
    setAPIKeyEntries((entries) => [
      ...entries,
      {
        localId: nextAPIKeyRowID(),
        apiKey: "",
        proxyEnabled: true,
        hasSavedKey: false,
        showKey: false,
      },
    ])
  }

  function removeAPIKeyEntry(localId: string) {
    setAPIKeyEntries((entries) => {
      if (entries.length <= 1) return entries
      return entries.filter((entry) => entry.localId !== localId)
    })
  }

  function normalizedAPIKeyEntries(): OpenAICompatibilityAPIKeyInput[] {
    return apiKeyEntries
      .filter((entry) => entry.apiKey.trim() || entry.hasSavedKey)
      .map((entry) => ({
        index: entry.index,
        apiKey: entry.apiKey,
        proxyUrl: proxyURLFromEnabled(entry.proxyEnabled),
      }))
  }

  async function handleFetchModels() {
    const entry = fetchKeyEntry
    if (!entry) {
      setError(t("errors.apiKeyRequired"))
      return
    }
    setError(null)
    setFetching(true)
    try {
      const ids = await fetchOpenAICompatibilityProviderModels({
        name: initial?.name || name,
        apiKey: entry.apiKey,
        baseUrl,
        proxyUrl: proxyURLFromEnabled(entry.proxyEnabled),
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

    if (!name.trim()) {
      setError(t("errors.nameRequired"))
      return
    }
    if (!baseUrl.trim()) {
      setError(t("errors.baseURLRequired"))
      return
    }
    const entries = normalizedAPIKeyEntries()
    if (entries.length === 0) {
      setError(t("errors.apiKeyRequired"))
      return
    }
    if (!models.some((model) => model.name.trim() && model.alias.trim())) {
      setError(t("provider.modelsRequired"))
      return
    }

    setSubmitting(true)
    try {
      const input = {
        name,
        baseUrl,
        apiKeyEntries: entries,
        models,
      }
      if (initial) {
        await updateOpenAICompatibilityProvider(initial.name, input)
      } else {
        await createOpenAICompatibilityProvider(input)
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
      {!isEdit && (
        <FieldDescription>
          {t("provider.openAICompatibilityFormHelp")}
        </FieldDescription>
      )}
      <Field>
        <FieldLabel htmlFor="openai-compat-name">{t("common.name")}</FieldLabel>
        <Input
          id="openai-compat-name"
          required
          placeholder="openrouter"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="openai-compat-base-url">Base URL</FieldLabel>
        <Input
          id="openai-compat-base-url"
          required
          placeholder={DEFAULT_BASE_URL}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </Field>
      <FieldSet>
        <FieldLegend variant="label">API Keys</FieldLegend>
        <div className="flex flex-col gap-2">
          {apiKeyEntries.map((entry, index) => (
            <div
              key={entry.localId}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_96px_auto]"
            >
              <Field className="min-w-0">
                <FieldLabel htmlFor={`${entry.localId}-key`}>
                  {t("provider.apiKeyLabel", { index: index + 1 })}
                </FieldLabel>
                <div className="flex min-w-0 gap-2">
                  <Input
                    id={`${entry.localId}-key`}
                    type={entry.showKey ? "text" : "password"}
                    autoComplete="off"
                    placeholder={entry.hasSavedKey ? entry.preview || "" : ""}
                    value={entry.apiKey}
                    onChange={(event) =>
                      updateAPIKeyEntry(entry.localId, {
                        apiKey: event.target.value,
                      })
                    }
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label={
                      entry.showKey ? t("common.hide") : t("common.show")
                    }
                    onClick={() =>
                      updateAPIKeyEntry(entry.localId, {
                        showKey: !entry.showKey,
                      })
                    }
                  >
                    {entry.showKey ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor={`${entry.localId}-proxy`}>
                  {t("common.proxy")}
                </FieldLabel>
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    id={`${entry.localId}-proxy`}
                    checked={entry.proxyEnabled}
                    onCheckedChange={(checked) =>
                      updateAPIKeyEntry(entry.localId, {
                        proxyEnabled: checked,
                      })
                    }
                    aria-label={`${t("provider.apiKeyLabel", {
                      index: index + 1,
                    })} ${t("proxy.useProxy")}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {entry.proxyEnabled
                      ? t("proxy.enabled")
                      : t("proxy.direct")}
                  </span>
                </div>
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("provider.removeAPIKey")}
                disabled={apiKeyEntries.length <= 1}
                onClick={() => removeAPIKeyEntry(entry.localId)}
                className="self-end"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addAPIKeyEntry}
          className="self-start"
        >
          <Plus />
          {t("provider.addAPIKey")}
        </Button>
      </FieldSet>
      <Field>
        <FieldLabel>{t("provider.models")}</FieldLabel>
        <FieldDescription>{t("provider.modelsRequiredHint")}</FieldDescription>
        <ModelRowsEditor
          rows={models}
          onChange={setModels}
          fetchSlot={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fetching || !canFetchModels}
              onClick={() => void handleFetchModels()}
            >
              {fetching ? t("common.fetching") : t("common.fetchFromModels")}
            </Button>
          }
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
