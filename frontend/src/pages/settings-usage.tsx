import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { AuthUser } from "@/lib/auth-client"
import { useAuth } from "@/lib/auth-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

type UsageWindow = {
  title: string
  usage: string | undefined
  quota: string | null | undefined
  startedAt: string | undefined
  resetAt: string | null | undefined
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

function formatDateTime(
  value: string | null | undefined,
  fmt: Intl.DateTimeFormat
) {
  if (!value) return "-"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "-"
  return fmt.format(date)
}

function activeStartedAt(
  startedAt: string | undefined,
  resetAt: string | null | undefined
) {
  return resetAt ? startedAt : undefined
}

function remainingLabel(
  usage: string | undefined,
  quota: string | null | undefined,
  fmt: Intl.NumberFormat,
  unlimited: string
) {
  const usageAmount = numericCost(usage) ?? 0
  const quotaAmount = numericCost(quota)
  if (quotaAmount === null) return unlimited
  return fmt.format(Math.max(quotaAmount - usageAmount, 0))
}

function usagePercent(
  usage: string | undefined,
  quota: string | null | undefined
) {
  const usageAmount = numericCost(usage) ?? 0
  const quotaAmount = numericCost(quota)
  if (quotaAmount === null || quotaAmount <= 0) return null
  return Math.min(Math.max((usageAmount / quotaAmount) * 100, 0), 100)
}

function rawUsagePercent(
  usage: string | undefined,
  quota: string | null | undefined
) {
  const usageAmount = numericCost(usage) ?? 0
  const quotaAmount = numericCost(quota)
  if (quotaAmount === null || quotaAmount <= 0) return null
  return Math.max((usageAmount / quotaAmount) * 100, 0)
}

function formatRelativeDateTime(
  value: string | null | undefined,
  fmt: Intl.RelativeTimeFormat,
  now: Date
) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const diffMs = date.getTime() - now.getTime()
  const absMs = Math.abs(diffMs)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (absMs < minuteMs) return fmt.format(0, "second")
  if (absMs < hourMs) return fmt.format(Math.round(diffMs / minuteMs), "minute")
  if (absMs < dayMs) return fmt.format(Math.round(diffMs / hourMs), "hour")
  return fmt.format(Math.round(diffMs / dayMs), "day")
}

function progressColor(percent: number | null) {
  if (percent === null) return "bg-muted-foreground/30"
  if (percent >= 100) return "bg-destructive"
  if (percent >= 80) return "bg-amber-500"
  return "bg-primary"
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

function usageWindows(user: AuthUser | null, t: (key: string) => string) {
  const reset5H = user?.usage_5h_reset_at
  const reset7D = user?.usage_7d_reset_at
  return [
    {
      title: t("usage.window5h"),
      usage: user?.usage_5h_cost_usd,
      quota: user?.quota_5h_cost_usd,
      startedAt: activeStartedAt(user?.usage_5h_started_at, reset5H),
      resetAt: reset5H,
    },
    {
      title: t("usage.window7d"),
      usage: user?.usage_7d_cost_usd,
      quota: user?.quota_7d_cost_usd,
      startedAt: activeStartedAt(user?.usage_7d_started_at, reset7D),
      resetAt: reset7D,
    },
  ]
}

export default function SettingsUsagePage() {
  const { t, i18n } = useTranslation()
  const { user, refresh } = useAuth()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  )
  const relativeFmt = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }),
    [i18n.language]
  )
  const windows = usageWindows(user, t)
  const now = new Date()

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      await refresh()
    } catch (err) {
      setError(errorMessage(err, t("errors.loadUsageFailed")))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{t("usage.title")}</h1>
        </div>
        <Button type="button" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw />
          {refreshing ? t("common.loading") : t("common.refresh")}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {windows.map((item) => (
          <UsageCard
            key={item.title}
            item={item}
            usdFmt={usdFmt}
            dateFmt={dateFmt}
            relativeFmt={relativeFmt}
            now={now}
            unlimited={t("usage.unlimitedQuota")}
          />
        ))}
      </div>
    </div>
  )
}

function UsageCard({
  item,
  usdFmt,
  dateFmt,
  relativeFmt,
  now,
  unlimited,
}: {
  item: UsageWindow
  usdFmt: Intl.NumberFormat
  dateFmt: Intl.DateTimeFormat
  relativeFmt: Intl.RelativeTimeFormat
  now: Date
  unlimited: string
}) {
  const { t } = useTranslation()
  const percent = usagePercent(item.usage, item.quota)
  const rawPercent = rawUsagePercent(item.usage, item.quota)
  const usageLabel = formatUSD(item.usage, usdFmt)
  const remaining = remainingLabel(item.usage, item.quota, usdFmt, unlimited)
  const percentText =
    rawPercent === null ? unlimited : `${Math.round(rawPercent)}%`
  const percentSummary =
    rawPercent === null ? unlimited : `${t("usage.usedPercent")} ${percentText}`
  const startedAt = formatDateTime(item.startedAt, dateFmt)
  const resetAt = formatDateTime(item.resetAt, dateFmt)
  const resetRelative = formatRelativeDateTime(item.resetAt, relativeFmt, now)
  const primaryLabel =
    rawPercent === null ? t("usage.currentUsage") : t("usage.remaining")
  const primaryValue = rawPercent === null ? usageLabel : remaining

  return (
    <Card className="h-full py-5">
      <CardContent className="flex h-full flex-col px-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium">{item.title}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {resetRelative
              ? t("usage.resetRelative", { time: resetRelative })
              : `${t("usage.resetAt")}: ${resetAt}`}
          </p>
        </div>

        <div className="mt-6">
          <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground">
                {primaryLabel}
              </div>
              <div className="mt-1 truncate text-2xl font-semibold tabular-nums sm:text-3xl">
                {primaryValue}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <Progress
              value={percent}
              className="h-2.5"
              indicatorClassName={progressColor(rawPercent)}
            />
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {t("usage.remaining")}: {remaining}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {percentSummary}
              </span>
            </div>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {t("usage.periodStartedAt")}
            </dt>
            <dd className="mt-1 truncate tabular-nums">{startedAt}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {t("usage.resetAt")}
            </dt>
            <dd className="mt-1 truncate tabular-nums">{resetAt}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
