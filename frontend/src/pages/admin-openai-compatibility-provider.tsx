import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Eye, EyeOff, MoreHorizontal, Plus, Trash2 } from "lucide-react"

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
import { ModelRowsEditor } from "@/components/admin/model-rows-editors"

const DEFAULT_BASE_URL = "https://api.openai.com/v1"

type DeleteTarget = OpenAICompatibilityProvider
type EditTarget = OpenAICompatibilityProvider
type EditableAPIKeyEntry = {
  localId: string
  index?: number
  apiKey: string
  proxyUrl: string
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

function apiKeySummary(row: OpenAICompatibilityProvider) {
  const count = apiKeyCount(row)
  if (count === 0) return "-"
  const preview =
    row.api_key_entries?.find((entry) => entry.has_api_key)?.api_key_preview ||
    row.api_key_preview ||
    "已配置"
  if (count === 1) return preview
  return `${preview} +${count - 1}`
}

function proxySummary(row: OpenAICompatibilityProvider) {
  const proxies =
    row.api_key_entries
      ?.filter((entry) => entry.has_api_key)
      .map((entry) => entry.proxy_url?.trim() || "全局默认") ?? []
  if (proxies.length === 0) return row.proxy_url || "全局默认"
  const unique = Array.from(new Set(proxies))
  if (unique.length === 1) return unique[0]
  return `${unique.length} 个代理`
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
      proxyUrl: entry.proxy_url ?? "",
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
      proxyUrl: initial?.proxy_url ?? "",
      preview: initial?.api_key_preview,
      hasSavedKey: initial?.has_api_key ?? false,
      showKey: false,
    },
  ]
}

export default function AdminOpenAICompatibilityProviderPage() {
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
              : "加载 OpenAI Compatibility Provider 失败"
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
      setError(err instanceof Error ? err.message : "刷新失败")
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
      setError(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            OpenAI Compatibility Provider
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            走 /v1/chat/completions 协议的 OpenAI 兼容上游，例如 OneAPI、
            OpenRouter 或自建聚合网关。
          </p>
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => setAddOpen(true)}
        >
          <Plus />
          添加 Provider
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
              <TableHead className="min-w-40">名称</TableHead>
              <TableHead className="min-w-40">API Keys</TableHead>
              <TableHead className="min-w-64">Base URL</TableHead>
              <TableHead className="min-w-48">Proxy URL</TableHead>
              <TableHead className="w-24">模型</TableHead>
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
              rows.map((row) => (
                <TableRow key={row.id || row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {apiKeySummary(row)}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                    {row.base_url || DEFAULT_BASE_URL}
                  </TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
                    {proxySummary(row)}
                  </TableCell>
                  <TableCell>{row.models?.length ?? 0}</TableCell>
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
                        <DropdownMenuItem onClick={() => setEditTarget(row)}>
                          编辑
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
                          删除
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
                  暂无 OpenAI Compatibility Provider
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>添加 OpenAI Compatibility Provider</DialogTitle>
            <DialogDescription>填写上游名称、地址和凭证。</DialogDescription>
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
              {editTarget ? `编辑 ${editTarget.name}` : ""}
            </DialogTitle>
            <DialogDescription>编辑上游地址、凭证和模型。</DialogDescription>
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
            <AlertDialogTitle>删除该 Provider？</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget ? rowLabel(deleteTarget) : ""}”
              删除后不可用于模型访问。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "删除中…" : "删除"}
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
        proxyUrl: "",
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
        proxyUrl: entry.proxyUrl,
      }))
  }

  async function handleFetchModels() {
    const entry = fetchKeyEntry
    if (!entry) {
      setError("API Key 不能为空")
      return
    }
    setError(null)
    setFetching(true)
    try {
      const ids = await fetchOpenAICompatibilityProviderModels({
        name: initial?.name || name,
        apiKey: entry.apiKey,
        baseUrl,
        proxyUrl: entry.proxyUrl,
      })
      setModels(ids.map((id) => ({ name: id, alias: modelAliasFromName(id) })))
    } catch (err) {
      setError(err instanceof Error ? err.message : "拉取模型列表失败")
    } finally {
      setFetching(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError("名称不能为空")
      return
    }
    if (!baseUrl.trim()) {
      setError("Base URL 不能为空")
      return
    }
    const entries = normalizedAPIKeyEntries()
    if (entries.length === 0) {
      setError("API Key 不能为空")
      return
    }
    if (!models.some((model) => model.name.trim() && model.alias.trim())) {
      setError("模型不能为空，请添加模型或从上游 /models 拉取")
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
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {!isEdit && (
        <p className="text-sm text-muted-foreground">
          上游需兼容 OpenAI /v1/chat/completions 与 /v1/models。
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="openai-compat-name">名称</Label>
        <Input
          id="openai-compat-name"
          required
          placeholder="openrouter"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="openai-compat-base-url">Base URL</Label>
        <Input
          id="openai-compat-base-url"
          required
          placeholder={DEFAULT_BASE_URL}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          className="h-9"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>API Keys</Label>
        <div className="flex flex-col gap-2">
          {apiKeyEntries.map((entry, index) => (
            <div
              key={entry.localId}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${entry.localId}-key`}>
                  API Key {index + 1}
                </Label>
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
                    className="h-9 min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label={entry.showKey ? "隐藏" : "显示"}
                    onClick={() =>
                      updateAPIKeyEntry(entry.localId, {
                        showKey: !entry.showKey,
                      })
                    }
                  >
                    {entry.showKey ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${entry.localId}-proxy`}>Proxy URL</Label>
                <Input
                  id={`${entry.localId}-proxy`}
                  placeholder="socks5://user:pass@127.0.0.1:1080/"
                  value={entry.proxyUrl}
                  onChange={(event) =>
                    updateAPIKeyEntry(entry.localId, {
                      proxyUrl: event.target.value,
                    })
                  }
                  className="h-9 min-w-0 font-mono text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除 API Key"
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
          添加 API Key
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>
          模型{" "}
          <span className="text-muted-foreground">
            （必填，用于注册可访问模型）
          </span>
        </Label>
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
              {fetching ? "获取中…" : "从上游 /models 拉取"}
            </Button>
          }
        />
      </div>
      {error && <p className="text-sm break-all text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  )
}
