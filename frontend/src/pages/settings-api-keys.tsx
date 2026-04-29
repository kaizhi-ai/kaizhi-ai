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
import { toast } from "sonner"

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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const expiryOptions: APIKeyExpiry[] = ["30d", "90d", "365d", "never"]

type KeyFilter = "active" | "expired" | "revoked"
type ClientGuideClient =
  | "claude-code"
  | "codex"
  | "gemini"
  | "opencode"
  | "droid"
type ClientGuidePlatform = "macos" | "windows" | "linux"
type ClientGuideMethod = "env" | "config"

type ClientGuideBlock = {
  label: string
  code: string
}

type ClientGuideContent = {
  blocks: ClientGuideBlock[]
}

const clientGuideClients: ClientGuideClient[] = [
  "codex",
  "claude-code",
  "opencode",
  "droid",
  "gemini",
]
const clientGuidePlatforms: ClientGuidePlatform[] = [
  "macos",
  "windows",
  "linux",
]
const clientGuideMethods: ClientGuideMethod[] = ["config", "env"]

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
          toast.error(
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
      toast.error(
        err instanceof Error ? err.message : t("errors.revokeAPIKeyFailed")
      )
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t("apiKeys.title")}</h1>
      </div>

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

      <APIKeyClientGuide />

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

function APIKeyClientGuide() {
  const { t } = useTranslation()
  const fallbackOrigin = useMemo(() => {
    if (typeof window === "undefined") return "https://kaizhi.example.com"
    return normalizeClientBaseURL(window.location.origin)
  }, [])
  const [configuredOrigin, setConfiguredOrigin] = useState("")
  const [client, setClient] = useState<ClientGuideClient>("codex")
  const [platform, setPlatform] = useState<ClientGuidePlatform>("macos")
  const [method, setMethod] = useState<ClientGuideMethod>("config")

  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/app-config")
      .then((res) => {
        if (!res.ok) return null
        return res.json() as Promise<{ public_base_url?: string }>
      })
      .then((data) => {
        if (cancelled) return
        setConfiguredOrigin(normalizeClientBaseURL(data?.public_base_url))
      })
      .catch(() => {
        if (!cancelled) setConfiguredOrigin("")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const appOrigin = configuredOrigin || fallbackOrigin
  const apiKey = t("apiKeys.clientGuide.apiKeyPlaceholder")
  const guideContent = useMemo(
    () => buildClientGuideContent(client, platform, method, appOrigin, apiKey),
    [apiKey, appOrigin, client, method, platform]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("apiKeys.clientGuide.title")}</CardTitle>
        <CardDescription className="max-w-3xl">
          {t("apiKeys.clientGuide.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <ClientGuideTabRow
            label={t("apiKeys.clientGuide.client")}
            value={client}
            onValueChange={(value) => {
              setClient(value)
              if (value === "droid") setMethod("config")
            }}
            options={clientGuideClients.map((value) => ({
              value,
              label: t(clientGuideClientLabelKeys[value]),
            }))}
            listClassName="grid h-auto w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          />
          <ClientGuideTabRow
            label={t("apiKeys.clientGuide.platform")}
            value={platform}
            onValueChange={setPlatform}
            options={clientGuidePlatforms.map((value) => ({
              value,
              label: t(clientGuidePlatformLabelKeys[value]),
            }))}
            listClassName="grid h-auto w-full grid-cols-3"
          />
          <ClientGuideTabRow
            label={t("apiKeys.clientGuide.method")}
            value={method}
            onValueChange={setMethod}
            options={clientGuideMethods.map((value) => ({
              value,
              label: t(clientGuideMethodLabelKeys[value]),
              disabled: client === "droid" && value === "env",
            }))}
            listClassName="grid h-auto w-full grid-cols-2"
          />
        </div>

        <div className="grid gap-3">
          {guideContent.blocks.map((block) => (
            <ClientGuideCodeBlock
              key={`${block.label}:${block.code.slice(0, 24)}`}
              label={block.label}
              code={block.code}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

const clientGuideClientLabelKeys: Record<ClientGuideClient, string> = {
  "claude-code": "apiKeys.clientGuide.clients.claudeCode",
  codex: "apiKeys.clientGuide.clients.codex",
  gemini: "apiKeys.clientGuide.clients.gemini",
  opencode: "apiKeys.clientGuide.clients.openCode",
  droid: "apiKeys.clientGuide.clients.droid",
}

const clientGuidePlatformLabelKeys: Record<ClientGuidePlatform, string> = {
  macos: "apiKeys.clientGuide.platforms.macos",
  windows: "apiKeys.clientGuide.platforms.windows",
  linux: "apiKeys.clientGuide.platforms.linux",
}

const clientGuideMethodLabelKeys: Record<ClientGuideMethod, string> = {
  env: "apiKeys.clientGuide.methods.env",
  config: "apiKeys.clientGuide.methods.config",
}

function ClientGuideTabRow<TValue extends string>({
  label,
  value,
  onValueChange,
  options,
  listClassName,
}: {
  label: string
  value: TValue
  onValueChange: (value: TValue) => void
  options: { value: TValue; label: string; disabled?: boolean }[]
  listClassName: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Tabs
        value={value}
        onValueChange={(next) => onValueChange(next as TValue)}
      >
        <TabsList className={listClassName}>
          {options.map((option) => (
            <TabsTrigger
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="h-8"
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

function buildClientGuideContent(
  client: ClientGuideClient,
  platform: ClientGuidePlatform,
  method: ClientGuideMethod,
  appOrigin: string,
  apiKey: string
): ClientGuideContent {
  const openAIBaseURL = `${appOrigin}/v1`

  if (method === "env") {
    switch (client) {
      case "claude-code":
        return {
          blocks: envVariableBlocks(platform, [
            ["ANTHROPIC_BASE_URL", appOrigin],
            ["ANTHROPIC_AUTH_TOKEN", apiKey],
          ]),
        }
      case "codex":
        return {
          blocks: [
            ...envVariableBlocks(platform, [["KAIZHI_API_KEY", apiKey]]),
            {
              label: codexConfigPath(platform),
              code: codexConfigToml(openAIBaseURL, "env"),
            },
          ],
        }
      case "gemini":
        return {
          blocks: envVariableBlocks(platform, [
            ["GOOGLE_GEMINI_BASE_URL", appOrigin],
            ["GEMINI_API_KEY", apiKey],
            ["GEMINI_MODEL", "gemini-3-pro-preview"],
          ]),
        }
      case "opencode":
        return {
          blocks: [
            ...envVariableBlocks(platform, [["KAIZHI_API_KEY", apiKey]]),
            {
              label: opencodeConfigPath(platform),
              code: opencodeConfig(openAIBaseURL),
            },
          ],
        }
      case "droid":
        return buildClientGuideContent(
          client,
          platform,
          "config",
          appOrigin,
          apiKey
        )
    }
  }

  switch (client) {
    case "claude-code":
      return {
        blocks: [
          {
            label: claudeSettingsPath(platform),
            code: claudeSettingsJSON(appOrigin, apiKey),
          },
        ],
      }
    case "codex":
      return {
        blocks: [
          {
            label: codexConfigPath(platform),
            code: codexConfigToml(openAIBaseURL, "auth-json"),
          },
          {
            label: codexAuthPath(platform),
            code: JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2),
          },
        ],
      }
    case "gemini":
      return {
        blocks: [
          {
            label: geminiEnvPath(platform),
            code: [
              `GOOGLE_GEMINI_BASE_URL=${appOrigin}`,
              `GEMINI_API_KEY=${apiKey}`,
              "GEMINI_MODEL=gemini-3-pro-preview",
            ].join("\n"),
          },
          {
            label: geminiSettingsPath(platform),
            code: geminiSettingsJSON(),
          },
        ],
      }
    case "opencode":
      return {
        blocks: [
          {
            label: opencodeConfigPath(platform),
            code: opencodeConfig(openAIBaseURL, apiKey),
          },
        ],
      }
    case "droid":
      return {
        blocks: [
          {
            label: droidConfigPath(platform),
            code: droidConfigJSON(openAIBaseURL, apiKey),
          },
        ],
      }
  }
}

function envVariableBlocks(
  platform: ClientGuidePlatform,
  variables: [string, string][]
): ClientGuideBlock[] {
  if (platform === "windows") {
    return [
      {
        label: "PowerShell",
        code: variables
          .map(([name, value]) => `$env:${name} = "${value}"`)
          .join("\n"),
      },
      {
        label: "PowerShell (User)",
        code: variables
          .map(
            ([name, value]) =>
              `[System.Environment]::SetEnvironmentVariable("${name}", "${value}", [System.EnvironmentVariableTarget]::User)`
          )
          .join("\n"),
      },
    ]
  }

  const profilePath = platform === "macos" ? "~/.zshrc" : "~/.bashrc"
  const exports = variables
    .map(([name, value]) => `export ${name}="${value}"`)
    .join("\n")

  return [
    {
      label: "Shell",
      code: exports,
    },
    {
      label: profilePath,
      code: exports,
    },
  ]
}

function claudeSettingsPath(platform: ClientGuidePlatform) {
  if (platform === "windows") return "%USERPROFILE%\\.claude\\settings.json"
  return "~/.claude/settings.json"
}

function claudeSettingsJSON(appOrigin: string, apiKey: string) {
  return JSON.stringify(
    {
      env: {
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_BASE_URL: appOrigin,
      },
    },
    null,
    2
  )
}

function codexConfigPath(platform: ClientGuidePlatform) {
  if (platform === "windows") return "%USERPROFILE%\\.codex\\config.toml"
  return "~/.codex/config.toml"
}

function codexAuthPath(platform: ClientGuidePlatform) {
  if (platform === "windows") return "%USERPROFILE%\\.codex\\auth.json"
  return "~/.codex/auth.json"
}

function codexConfigToml(openAIBaseURL: string, authMode: "env" | "auth-json") {
  const authLine =
    authMode === "env"
      ? 'env_key = "KAIZHI_API_KEY"'
      : "requires_openai_auth = true"

  return `model_provider = "kaizhi"
model = "gpt-5.5"

[model_providers.kaizhi]
name = "Kaizhi"
base_url = "${openAIBaseURL}"
wire_api = "responses"
${authLine}`
}

function geminiEnvPath(platform: ClientGuidePlatform) {
  if (platform === "windows") return "%USERPROFILE%\\.gemini\\.env"
  return "~/.gemini/.env"
}

function geminiSettingsPath(platform: ClientGuidePlatform) {
  if (platform === "windows") return "%USERPROFILE%\\.gemini\\settings.json"
  return "~/.gemini/settings.json"
}

function geminiSettingsJSON() {
  return JSON.stringify(
    {
      ide: {
        enabled: true,
      },
      security: {
        auth: {
          selectedType: "gemini-api-key",
        },
      },
    },
    null,
    2
  )
}

function opencodeConfigPath(platform: ClientGuidePlatform) {
  if (platform === "windows") {
    return "%USERPROFILE%\\.config\\opencode\\opencode.json"
  }
  return "~/.config/opencode/opencode.json"
}

function opencodeConfig(
  openAIBaseURL: string,
  apiKey = "{env:KAIZHI_API_KEY}"
) {
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: "kaizhi/gpt-5.5",
      provider: {
        kaizhi: {
          npm: "@ai-sdk/openai",
          name: "Kaizhi",
          options: {
            baseURL: openAIBaseURL,
            apiKey,
          },
          models: {
            "gpt-5.5": {
              name: "GPT-5.5",
            },
          },
        },
      },
    },
    null,
    2
  )
}

function droidConfigPath(platform: ClientGuidePlatform) {
  if (platform === "windows") return "%USERPROFILE%\\.factory\\config.json"
  return "~/.factory/config.json"
}

function droidConfigJSON(openAIBaseURL: string, apiKey: string) {
  return JSON.stringify(
    {
      custom_models: [
        {
          model_display_name: "GPT-5.5 [Kaizhi]",
          model: "gpt-5.5",
          base_url: openAIBaseURL,
          api_key: apiKey,
          provider: "openai",
        },
      ],
    },
    null,
    2
  )
}

function normalizeClientBaseURL(value?: string | null) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? ""
  if (trimmed.endsWith("/v1")) return trimmed.slice(0, -3)
  return trimmed
}

function ClientGuideCodeBlock({
  label,
  code,
}: {
  label: string
  code: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // The visible code remains selectable when clipboard access is blocked.
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
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
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="rename-key-name">{t("common.name")}</FieldLabel>
        <Input
          id="rename-key-name"
          required
          maxLength={128}
          aria-invalid={!!error}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
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
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setName("")
    setExpiresIn("90d")
    setSubmitting(false)
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
    try {
      const created = await createAPIKey(trimmed, expiresIn)
      const { key: rawKey, ...safeKey } = created
      setCreatedKey(rawKey)
      onCreated(safeKey)
    } catch (err) {
      toast.error(
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
      toast.error(t("common.copyFailed"))
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
          {createdKey && (
            <DialogDescription>
              {t("apiKeys.copyDescriptionCreated")}
            </DialogDescription>
          )}
        </DialogHeader>

        {createdKey ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={createdKey}
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
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
            <div className="flex justify-end">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t("common.complete")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="key-name">{t("common.name")}</FieldLabel>
              <Input
                id="key-name"
                required
                maxLength={128}
                placeholder={t("apiKeys.namePlaceholder")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="key-expiry">
                {t("apiKeys.expiry")}
              </FieldLabel>
              <Select
                value={expiresIn}
                onValueChange={(value) =>
                  value && setExpiresIn(value as APIKeyExpiry)
                }
              >
                <SelectTrigger id="key-expiry" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {expiryOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`expiry.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
