import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  getAdminUsageSummary,
  listAdminUsageByModel,
  listAdminUsageByUser,
  type ModelUsage,
  type UsageSummary,
  type UserUsage,
} from "@/lib/usage-client"
import { Button } from "@/components/ui/button"
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

type UsageSection = "summary" | "models" | "users"
type UsageErrors = Partial<Record<UsageSection, string>>

type UsageLoadResult = {
  summary: UsageSummary | null
  models: ModelUsage[]
  users: UserUsage[]
  errors: UsageErrors
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function numericCost(value: string | null | undefined) {
  if (!value) return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function formatUSD(value: string | null | undefined, fmt: Intl.NumberFormat) {
  const amount = numericCost(value)
  if (amount === null) return "-"
  return fmt.format(amount)
}

function formatNumber(value: number | undefined, fmt: Intl.NumberFormat) {
  return fmt.format(value ?? 0)
}

function formatFailureRate(
  requestCount: number | undefined,
  failedCount: number | undefined,
  fmt: Intl.NumberFormat
) {
  if (!requestCount || requestCount <= 0) return fmt.format(0)
  return fmt.format((failedCount ?? 0) / requestCount)
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

function settledError(result: PromiseRejectedResult, fallback: string): string {
  return errorMessage(result.reason, fallback)
}

async function loadUsageRange(
  from: string,
  to: string,
  fallback: string
): Promise<UsageLoadResult> {
  const range = { from, to }
  const [summaryResult, modelItems, userItems] = await Promise.all([
    getAdminUsageSummary(range).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    ),
    listAdminUsageByModel(range).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    ),
    listAdminUsageByUser(range).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    ),
  ])
  const errors: UsageErrors = {}
  if (summaryResult.status === "rejected") {
    errors.summary = settledError(summaryResult, fallback)
  }
  if (modelItems.status === "rejected") {
    errors.models = settledError(modelItems, fallback)
  }
  if (userItems.status === "rejected") {
    errors.users = settledError(userItems, fallback)
  }
  return {
    summary:
      summaryResult.status === "fulfilled" ? summaryResult.value.usage : null,
    models: modelItems.status === "fulfilled" ? modelItems.value : [],
    users: userItems.status === "fulfilled" ? userItems.value : [],
    errors,
  }
}

export default function AdminUsagePage() {
  const { t, i18n } = useTranslation()
  const [from, setFrom] = useState(() => daysAgoDate(30))
  const [to, setTo] = useState(() => todayDate())
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [models, setModels] = useState<ModelUsage[]>([])
  const [users, setUsers] = useState<UserUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<UsageErrors>({})

  const numberFmt = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language]
  )
  const percentFmt = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: "percent",
        maximumFractionDigits: 1,
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

  async function handleRefresh() {
    setLoading(true)
    setErrors({})
    try {
      const result = await loadUsageRange(from, to, t("errors.loadUsageFailed"))
      setSummary(result.summary)
      setModels(result.models)
      setUsers(result.users)
      setErrors(result.errors)
    } catch (err) {
      setErrors({ summary: errorMessage(err, t("errors.loadUsageFailed")) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    loadUsageRange(from, to, t("errors.loadUsageFailed"))
      .then((result) => {
        if (cancelled) return
        setSummary(result.summary)
        setModels(result.models)
        setUsers(result.users)
        setErrors(result.errors)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrors({ summary: errorMessage(err, t("errors.loadUsageFailed")) })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, t, to])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex max-w-3xl flex-col gap-2">
            <h1 className="text-xl font-semibold">{t("adminUsage.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("adminUsage.description")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="usage-from">{t("adminUsage.from")}</Label>
              <Input
                id="usage-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setLoading(true)
                  setErrors({})
                  setFrom(event.target.value)
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-to">{t("adminUsage.to")}</Label>
              <Input
                id="usage-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setLoading(true)
                  setErrors({})
                  setTo(event.target.value)
                }}
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={loading}
              className="sm:mb-0"
            >
              <RefreshCw />
              {loading ? t("common.loading") : t("common.refresh")}
            </Button>
          </div>
        </div>
      </div>

      {errors.summary && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errors.summary}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label={t("adminUsage.cost")}
          value={formatUSD(summary?.cost_usd, usdFmt)}
        />
        <Metric
          label={t("adminUsage.requests")}
          value={formatNumber(summary?.request_count, numberFmt)}
          detail={t("adminUsage.failuresDetail", {
            count: formatNumber(summary?.failed_count, numberFmt),
          })}
        />
        <Metric
          label={t("adminUsage.failureRate")}
          value={formatFailureRate(
            summary?.request_count,
            summary?.failed_count,
            percentFmt
          )}
          detail={t("adminUsage.failureRateDetail", {
            failed: formatNumber(summary?.failed_count, numberFmt),
            total: formatNumber(summary?.request_count, numberFmt),
          })}
        />
        <Metric
          label={t("adminUsage.totalTokens")}
          value={formatNumber(summary?.total_tokens, numberFmt)}
          detail={t("adminUsage.unpricedTokensDetail", {
            count: formatNumber(summary?.unpriced_tokens, numberFmt),
          })}
        />
        <Metric
          label={t("adminUsage.cacheTokens")}
          value={formatNumber(summary?.cached_tokens, numberFmt)}
          detail={t("adminUsage.cacheTokensDetail", {
            read: formatNumber(summary?.cache_read_tokens, numberFmt),
            write: formatNumber(summary?.cache_write_tokens, numberFmt),
          })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label={t("adminUsage.inputTokens")}
          value={formatNumber(summary?.input_tokens, numberFmt)}
        />
        <Metric
          label={t("adminUsage.outputTokens")}
          value={formatNumber(summary?.output_tokens, numberFmt)}
        />
        <Metric
          label={t("adminUsage.reasoningTokens")}
          value={formatNumber(summary?.reasoning_tokens, numberFmt)}
        />
      </div>

      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("adminUsage.models")}</h2>
          <ModelUsageTable
            loading={loading}
            items={models}
            error={errors.models}
            numberFmt={numberFmt}
            percentFmt={percentFmt}
            usdFmt={usdFmt}
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("adminUsage.users")}</h2>
          <UserUsageTable
            loading={loading}
            items={users}
            error={errors.users}
            numberFmt={numberFmt}
            percentFmt={percentFmt}
            usdFmt={usdFmt}
          />
        </section>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {detail && (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      )}
    </div>
  )
}

function ModelUsageTable({
  loading,
  items,
  error,
  numberFmt,
  percentFmt,
  usdFmt,
}: {
  loading: boolean
  items: ModelUsage[]
  error?: string
  numberFmt: Intl.NumberFormat
  percentFmt: Intl.NumberFormat
  usdFmt: Intl.NumberFormat
}) {
  const { t } = useTranslation()

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table className="min-w-[1200px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">{t("adminUsage.provider")}</TableHead>
            <TableHead className="min-w-64">{t("adminUsage.model")}</TableHead>
            <TableHead className="text-right">
              {t("adminUsage.requests")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.failures")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.failureRate")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.inputTokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.outputTokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.reasoningTokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.cacheReadTokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.cacheWriteTokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.totalTokens")}
            </TableHead>
            <TableHead className="text-right">{t("adminUsage.cost")}</TableHead>
            <TableHead>{t("adminUsage.pricing")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell
                colSpan={13}
                className="py-10 text-center text-muted-foreground"
              >
                {t("common.loading")}
              </TableCell>
            </TableRow>
          ) : error ? (
            <TableRow>
              <TableCell
                colSpan={13}
                className="py-10 text-center text-destructive"
              >
                {error}
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={13}
                className="py-10 text-center text-muted-foreground"
              >
                {t("adminUsage.noModels")}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={`${item.provider}:${item.model}`}>
                <TableCell className="font-mono text-xs">
                  {item.provider || "-"}
                </TableCell>
                <TableCell className="max-w-80 truncate font-mono text-xs">
                  {item.model}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.request_count, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.failed_count, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatFailureRate(
                    item.request_count,
                    item.failed_count,
                    percentFmt
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.input_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.output_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.reasoning_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.cache_read_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.cache_write_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.total_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUSD(item.cost_usd, usdFmt)}
                </TableCell>
                <TableCell>
                  <PricingStatus item={item} numberFmt={numberFmt} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function PricingStatus({
  item,
  numberFmt,
}: {
  item: ModelUsage
  numberFmt: Intl.NumberFormat
}) {
  const { t } = useTranslation()
  if (!item.price_missing) {
    return (
      <span className="inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
        {t("adminUsage.priced")}
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
      {t("adminUsage.priceMissingWithTokens", {
        count: formatNumber(item.unpriced_tokens, numberFmt),
      })}
    </span>
  )
}

function UserUsageTable({
  loading,
  items,
  error,
  numberFmt,
  percentFmt,
  usdFmt,
}: {
  loading: boolean
  items: UserUsage[]
  error?: string
  numberFmt: Intl.NumberFormat
  percentFmt: Intl.NumberFormat
  usdFmt: Intl.NumberFormat
}) {
  const { t } = useTranslation()

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table className="min-w-[1100px]">
        <TableHeader>
          <TableRow>
            <TableHead>{t("adminUsage.user")}</TableHead>
            <TableHead className="text-right">
              {t("adminUsage.requests")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.failures")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.failureRate")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.totalTokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.inputTokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("adminUsage.outputTokens")}
            </TableHead>
            <TableHead className="text-right">{t("adminUsage.cost")}</TableHead>
            <TableHead className="text-right">
              {t("adminUsage.unpricedTokens")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell
                colSpan={9}
                className="py-10 text-center text-muted-foreground"
              >
                {t("common.loading")}
              </TableCell>
            </TableRow>
          ) : error ? (
            <TableRow>
              <TableCell
                colSpan={9}
                className="py-10 text-center text-destructive"
              >
                {error}
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={9}
                className="py-10 text-center text-muted-foreground"
              >
                {t("adminUsage.noUsers")}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.user_id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="truncate font-medium">
                      {item.user_name || item.user_email}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.user_email}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.request_count, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.failed_count, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatFailureRate(
                    item.request_count,
                    item.failed_count,
                    percentFmt
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.total_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.input_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.output_tokens, numberFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUSD(item.cost_usd, usdFmt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.unpriced_tokens, numberFmt)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
