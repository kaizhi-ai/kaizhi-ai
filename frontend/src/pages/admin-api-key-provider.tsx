import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Eye, EyeOff, MoreHorizontal, Plus, Trash2 } from "lucide-react"

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
  proxyStatusLabel,
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
import {
  ExcludedRowsEditor,
  ModelRowsEditor,
} from "@/components/admin/model-rows-editors"
import { ProxySwitchField } from "@/components/admin/proxy-switch-field"

const KEY_META: Record<
  ProviderAPIKeyKind,
  { label: string; description: string; defaultBaseUrl: string }
> = {
  claude: {
    label: "Anthropic",
    description:
      "走 Anthropic /v1/messages 协议的 API Key，支持官方或兼容网关。",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  gemini: {
    label: "Gemini",
    description: "走 Google Gemini API 协议的 API Key。",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
  },
  codex: {
    label: "OpenAI Response",
    description: "走 /responses 协议的 API Key，例如 OpenAI 官方或兼容网关。",
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
            err instanceof Error ? err.message : "加载 API Key Provider 失败"
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
      setError(err instanceof Error ? err.message : "刷新失败")
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
      setError(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">API Key Provider</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            基于 API Key 的上游凭证，支持 Anthropic、Gemini 与 OpenAI Response
            协议。
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
              <TableHead className="min-w-36">类型</TableHead>
              <TableHead className="min-w-40">API Key</TableHead>
              <TableHead className="min-w-56">Base URL</TableHead>
              <TableHead className="min-w-24">代理</TableHead>
              <TableHead className="w-24">白名单</TableHead>
              <TableHead className="w-24">黑名单</TableHead>
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
                  加载中…
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
                    {proxyStatusLabel(row.proxy_url)}
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
                  colSpan={7}
                  className="py-12 text-center text-muted-foreground"
                >
                  暂无 API Key Provider
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
            <DialogTitle>添加 API Key Provider</DialogTitle>
            <DialogDescription>选择类型并填写上游凭证。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key-provider-kind">类型</Label>
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
          </div>
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
                ? `编辑 ${KEY_META[editTarget.provider].label} API Key`
                : ""}
            </DialogTitle>
            <DialogDescription>留空 API Key 则保持原值。</DialogDescription>
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
            <AlertDialogTitle>删除该 API Key Provider？</AlertDialogTitle>
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

function ProviderKeyForm({
  kind,
  initial,
  onSuccess,
}: {
  kind: ProviderAPIKeyKind
  initial?: Row
  onSuccess: () => void
}) {
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
      setError(err instanceof Error ? err.message : "拉取模型列表失败")
    } finally {
      setFetching(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!baseUrl.trim()) {
      setError("Base URL 不能为空")
      return
    }
    if (!isEdit && !apiKey.trim()) {
      setError("API Key 不能为空")
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
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {!isEdit && (
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`provider-key-${kind}`}>API Key</Label>
        <div className="flex gap-2">
          <Input
            id={`provider-key-${kind}`}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            required={!isEdit}
            placeholder={isEdit ? "留空则保持不变" : ""}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="h-9 flex-1 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={showKey ? "隐藏" : "显示"}
            onClick={() => setShowKey((value) => !value)}
          >
            {showKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`provider-base-url-${kind}`}>Base URL</Label>
        <Input
          id={`provider-base-url-${kind}`}
          required
          placeholder={meta.defaultBaseUrl}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          className="h-9"
        />
      </div>
      <ProxySwitchField
        id={`provider-proxy-${kind}`}
        checked={proxyEnabled}
        onCheckedChange={setProxyEnabled}
      />
      <div className="flex flex-col gap-1.5">
        <Label>
          白名单模型{" "}
          <span className="text-muted-foreground">
            （可选，留空则信任上游 /models）
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
              disabled={fetching || !baseUrl.trim()}
              onClick={() => void handleFetchModels()}
            >
              {fetching ? "获取中…" : "从上游 /models 拉取"}
            </Button>
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>
          黑名单模型{" "}
          <span className="text-muted-foreground">（可选，支持通配符 *）</span>
        </Label>
        <ExcludedRowsEditor
          rows={excludedModels}
          onChange={setExcludedModels}
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
