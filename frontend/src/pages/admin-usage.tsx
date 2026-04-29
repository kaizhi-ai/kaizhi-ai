import { useEffect, useMemo, useState } from "react"
import { Plus, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import {
  listUnmatchedModels,
  type UnmatchedModel,
} from "@/lib/admin-model-prices-client"
import {
  getAdminUsageSummary,
  listAdminUsageByModel,
  listAdminUsageByUser,
  type ModelUsage,
  type UsageSummary,
  type UserUsage,
} from "@/lib/usage-client"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldLabel } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type UsageSection = "summary" | "models" | "users" | "unmatched"
type UsageErrors = Partial<Record<UsageSection, string>>

type UsageLoadResult = {
  summary: UsageSummary | null
  models: ModelUsage[]
  users: UserUsage[]
  unmatched: UnmatchedModel[]
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

function failureRateValue(
  requestCount: number | undefined,
  failedCount: number | undefined
) {
  if (!requestCount || requestCount <= 0) return 0
  return (failedCount ?? 0) / requestCount
}

function distributionShareLabel(
  value: number | undefined,
  total: number | undefined,
  fmt: Intl.NumberFormat
) {
  if (!total || total <= 0) return fmt.format(0)
  return fmt.format((value ?? 0) / total)
}

function modelCostValue(item: ModelUsage) {
  return numericCost(item.cost_usd) ?? 0
}

function userCostValue(item: UserUsage) {
  return numericCost(item.cost_usd) ?? 0
}

function distributionPercent(value: number, total: number) {
  if (total <= 0) return 0
  return Math.min(Math.max((value / total) * 100, 0), 100)
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
  fallback: string,
  unmatchedFallback = fallback
): Promise<UsageLoadResult> {
  const range = { from, to }
  const [summaryResult, modelItems, userItems, unmatchedItems] =
    await Promise.all([
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
      listUnmatchedModels(from, to).then(
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
  if (unmatchedItems.status === "rejected") {
    errors.unmatched = settledError(unmatchedItems, unmatchedFallback)
  }
  return {
    summary:
      summaryResult.status === "fulfilled" ? summaryResult.value.usage : null,
    models: modelItems.status === "fulfilled" ? modelItems.value : [],
    users: userItems.status === "fulfilled" ? userItems.value : [],
    unmatched:
      unmatchedItems.status === "fulfilled" ? unmatchedItems.value : [],
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
  const [unmatched, setUnmatched] = useState<UnmatchedModel[]>([])
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
      const result = await loadUsageRange(
        from,
        to,
        t("errors.loadUsageFailed"),
        t("errors.loadUnmatchedModelsFailed")
      )
      setSummary(result.summary)
      setModels(result.models)
      setUsers(result.users)
      setUnmatched(result.unmatched)
      setErrors(result.errors)
      if (result.errors.summary) toast.error(result.errors.summary)
    } catch (err) {
      const message = errorMessage(err, t("errors.loadUsageFailed"))
      setErrors({ summary: message })
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    loadUsageRange(
      from,
      to,
      t("errors.loadUsageFailed"),
      t("errors.loadUnmatchedModelsFailed")
    )
      .then((result) => {
        if (cancelled) return
        setSummary(result.summary)
        setModels(result.models)
        setUsers(result.users)
        setUnmatched(result.unmatched)
        setErrors(result.errors)
        if (result.errors.summary) toast.error(result.errors.summary)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = errorMessage(err, t("errors.loadUsageFailed"))
          setErrors({ summary: message })
          toast.error(message)
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
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field>
              <FieldLabel htmlFor="usage-from">
                {t("adminUsage.from")}
              </FieldLabel>
              <DatePicker
                id="usage-from"
                value={from}
                locale={i18n.language}
                onValueChange={(value) => {
                  setLoading(true)
                  setErrors({})
                  setFrom(value)
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="usage-to">{t("adminUsage.to")}</FieldLabel>
              <DatePicker
                id="usage-to"
                value={to}
                locale={i18n.language}
                onValueChange={(value) => {
                  setLoading(true)
                  setErrors({})
                  setTo(value)
                }}
              />
            </Field>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <UsageOverview
          summary={summary}
          numberFmt={numberFmt}
          percentFmt={percentFmt}
          usdFmt={usdFmt}
        />
        <ModelDistribution
          loading={loading}
          items={models}
          error={errors.models}
          numberFmt={numberFmt}
          percentFmt={percentFmt}
          usdFmt={usdFmt}
        />
      </div>

      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <UnmatchedModelsList
            loading={loading}
            items={unmatched}
            error={errors.unmatched}
            numberFmt={numberFmt}
          />
        </section>
        <section className="flex flex-col gap-3">
          <UserUsageList
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

function UsageOverview({
  summary,
  numberFmt,
  percentFmt,
  usdFmt,
}: {
  summary: UsageSummary | null
  numberFmt: Intl.NumberFormat
  percentFmt: Intl.NumberFormat
  usdFmt: Intl.NumberFormat
}) {
  const { t } = useTranslation()

  return (
    <Card className="py-5">
      <CardContent className="px-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">{t("adminUsage.overview")}</h2>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">
              {t("adminUsage.cost")}
            </div>
            <div className="mt-1 truncate text-3xl font-semibold tabular-nums">
              {formatUSD(summary?.cost_usd, usdFmt)}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryItem
              label={t("adminUsage.requests")}
              value={formatNumber(summary?.request_count, numberFmt)}
              detail={t("adminUsage.failuresDetail", {
                count: formatNumber(summary?.failed_count, numberFmt),
              })}
            />
            <SummaryItem
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
            <SummaryItem
              label={t("adminUsage.totalTokens")}
              value={formatNumber(summary?.total_tokens, numberFmt)}
              detail={t("adminUsage.unpricedTokensDetail", {
                count: formatNumber(summary?.unpriced_tokens, numberFmt),
              })}
            />
            <SummaryItem
              label={t("adminUsage.cacheTokens")}
              value={formatNumber(summary?.cached_tokens, numberFmt)}
              detail={t("adminUsage.cacheTokensDetail", {
                read: formatNumber(summary?.cache_read_tokens, numberFmt),
                write: formatNumber(summary?.cache_write_tokens, numberFmt),
              })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryItem({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums">
        {value}
      </div>
      {detail && (
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {detail}
        </div>
      )}
    </div>
  )
}

function ModelDistribution({
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
  const totalCost = items.reduce((sum, item) => sum + modelCostValue(item), 0)
  const totalRequests = items.reduce(
    (sum, item) => sum + (item.request_count ?? 0),
    0
  )
  const rankByCost = totalCost > 0
  const ranked = [...items]
    .sort((a, b) =>
      rankByCost
        ? modelCostValue(b) - modelCostValue(a)
        : (b.request_count ?? 0) - (a.request_count ?? 0)
    )
    .slice(0, 5)

  return (
    <Card className="py-5">
      <CardContent className="px-5">
        <div className="min-w-0">
          <h2 className="text-base font-medium">
            {t("adminUsage.modelDistribution")}
          </h2>
        </div>

        <div className="mt-5 grid gap-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-destructive">
              {error}
            </div>
          ) : ranked.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("adminUsage.noModels")}
            </div>
          ) : (
            ranked.map((item, index) => {
              const value = rankByCost
                ? modelCostValue(item)
                : item.request_count
              const total = rankByCost ? totalCost : totalRequests
              return (
                <DistributionBar
                  key={`${item.provider}:${item.model}`}
                  label={item.model}
                  detail={item.provider || "-"}
                  value={
                    rankByCost
                      ? formatUSD(item.cost_usd, usdFmt)
                      : formatNumber(item.request_count, numberFmt)
                  }
                  share={distributionShareLabel(value, total, percentFmt)}
                  percent={distributionPercent(value, total)}
                  barClassName={
                    item.price_missing
                      ? "bg-amber-500"
                      : MODEL_DISTRIBUTION_COLORS[
                          index % MODEL_DISTRIBUTION_COLORS.length
                        ]
                  }
                />
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const MODEL_DISTRIBUTION_COLORS = [
  "bg-primary",
  "bg-chart-2",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-1",
]

function DistributionBar({
  label,
  detail,
  value,
  share,
  percent,
  barClassName,
}: {
  label: string
  detail?: string
  value: string
  share: string
  percent: number
  barClassName: string
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          {detail && (
            <span className="block truncate text-xs text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
        <span className="font-medium whitespace-nowrap tabular-nums">
          {value}
          <span className="ml-2 text-xs text-muted-foreground">{share}</span>
        </span>
      </div>
      <Progress
        value={percent}
        className="h-2"
        indicatorClassName={barClassName}
      />
    </div>
  )
}

function UnmatchedModelsList({
  loading,
  items,
  error,
  numberFmt,
}: {
  loading: boolean
  items: UnmatchedModel[]
  error?: string
  numberFmt: Intl.NumberFormat
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  function addModelPrice(model: string) {
    navigate({
      pathname: "/admin/model-prices",
      search: `?model=${encodeURIComponent(model)}`,
    })
  }

  const rows = [...items].sort(
    (a, b) => (b.request_count ?? 0) - (a.request_count ?? 0)
  )

  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <div className="border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-medium">
              {t("adminUsage.unmatchedModels")}
            </h2>
          </div>
        </div>

        <div className="px-5 py-5">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-destructive">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("adminUsage.noUnmatchedModels")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-52">
                      {t("adminUsage.model")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("adminUsage.requests")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("adminUsage.totalTokens")}
                    </TableHead>
                    <TableHead className="min-w-40">
                      {t("adminUsage.firstSeen")}
                    </TableHead>
                    <TableHead className="min-w-40">
                      {t("adminUsage.lastSeen")}
                    </TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.model}>
                      <TableCell className="font-mono text-xs">
                        {item.model}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(item.request_count, numberFmt)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(item.total_tokens, numberFmt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.first_seen}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.last_seen}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addModelPrice(item.model)}
                        >
                          <Plus />
                          {t("adminUsage.addModelPrice")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function UserUsageList({
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
  const totalCost = items.reduce((sum, item) => sum + userCostValue(item), 0)
  const totalRequests = items.reduce(
    (sum, item) => sum + (item.request_count ?? 0),
    0
  )
  const rankByCost = totalCost > 0
  const ranked = [...items].sort((a, b) =>
    rankByCost
      ? userCostValue(b) - userCostValue(a)
      : (b.request_count ?? 0) - (a.request_count ?? 0)
  )

  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <div className="border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-medium">
              {t("adminUsage.userDistribution")}
            </h2>
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-destructive">
            {error}
          </div>
        ) : ranked.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t("adminUsage.noUsers")}
          </div>
        ) : (
          <div className="divide-y">
            {ranked.map((item) => {
              const value = rankByCost
                ? userCostValue(item)
                : item.request_count
              const total = rankByCost ? totalCost : totalRequests
              return (
                <UserUsageRow
                  key={item.user_id}
                  item={item}
                  primaryValue={
                    rankByCost
                      ? formatUSD(item.cost_usd, usdFmt)
                      : formatNumber(item.request_count, numberFmt)
                  }
                  primaryLabel={
                    rankByCost ? t("adminUsage.cost") : t("adminUsage.requests")
                  }
                  share={distributionShareLabel(value, total, percentFmt)}
                  percent={distributionPercent(value, total)}
                  numberFmt={numberFmt}
                  percentFmt={percentFmt}
                />
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UserUsageRow({
  item,
  primaryLabel,
  primaryValue,
  share,
  percent,
  numberFmt,
  percentFmt,
}: {
  item: UserUsage
  primaryLabel: string
  primaryValue: string
  share: string
  percent: number
  numberFmt: Intl.NumberFormat
  percentFmt: Intl.NumberFormat
}) {
  const { t } = useTranslation()
  const failureRate = failureRateValue(item.request_count, item.failed_count)
  const hasUnpricedTokens = (item.unpriced_tokens ?? 0) > 0
  const hasDisplayName =
    item.user_name &&
    item.user_name.trim() &&
    item.user_name !== item.user_email

  return (
    <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {hasDisplayName ? item.user_name : item.user_email}
          </span>
          {hasDisplayName && (
            <span className="truncate text-xs text-muted-foreground">
              {item.user_email}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>
            {t("adminUsage.requests")}:{" "}
            <span className="tabular-nums">
              {formatNumber(item.request_count, numberFmt)}
            </span>
          </span>
          <span>
            {t("adminUsage.failureRate")}:{" "}
            <span
              className={cn(
                "tabular-nums",
                failureRate >= 0.05
                  ? "text-destructive"
                  : failureRate >= 0.01
                    ? "text-amber-700 dark:text-amber-300"
                    : undefined
              )}
            >
              {formatFailureRate(
                item.request_count,
                item.failed_count,
                percentFmt
              )}
            </span>
          </span>
          <span>
            {t("adminUsage.totalTokens")}:{" "}
            <span className="tabular-nums">
              {formatNumber(item.total_tokens, numberFmt)}
            </span>
          </span>
          {hasUnpricedTokens && (
            <Badge variant="outline">
              {t("adminUsage.unpricedTokensDetail", {
                count: formatNumber(item.unpriced_tokens, numberFmt),
              })}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-2 lg:text-right">
        <div>
          <div className="text-xs text-muted-foreground">{primaryLabel}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {primaryValue}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {share}
            </span>
          </div>
        </div>
        <Progress
          value={percent}
          className="h-2"
          indicatorClassName={hasUnpricedTokens ? "bg-amber-500" : "bg-primary"}
        />
      </div>
    </div>
  )
}
