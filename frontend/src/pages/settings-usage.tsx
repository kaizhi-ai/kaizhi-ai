import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { AuthUser } from "@/lib/auth-client"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"

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
  const windows = usageWindows(user, t)

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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{t("usage.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("usage.description")}
          </p>
        </div>
        <Button type="button" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw />
          {refreshing ? t("common.loading") : t("common.refresh")}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {windows.map((item) => (
          <UsageCard
            key={item.title}
            item={item}
            usdFmt={usdFmt}
            dateFmt={dateFmt}
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
  unlimited,
}: {
  item: UsageWindow
  usdFmt: Intl.NumberFormat
  dateFmt: Intl.DateTimeFormat
  unlimited: string
}) {
  const { t } = useTranslation()
  const percent = usagePercent(item.usage, item.quota)

  return (
    <section className="rounded-lg border p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{item.title}</h2>
        <div className="grid gap-1 text-sm text-muted-foreground">
          <p>
            {t("usage.periodStartedAt")}:{" "}
            {formatDateTime(item.startedAt, dateFmt)}
          </p>
          <p>
            {t("usage.resetAt")}: {formatDateTime(item.resetAt, dateFmt)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <div>
          <div className="text-sm text-muted-foreground">
            {t("usage.currentUsage")}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatUSD(item.usage, usdFmt)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Metric
            label={t("usage.quota")}
            value={
              numericCost(item.quota) === null
                ? unlimited
                : formatUSD(item.quota, usdFmt)
            }
          />
          <Metric
            label={t("usage.remaining")}
            value={remainingLabel(item.usage, item.quota, usdFmt, unlimited)}
          />
        </div>

        {percent !== null && (
          <div className="grid gap-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t("usage.usedPercent")}</span>
              <span>{Math.round(percent)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium tabular-nums">{value}</div>
    </div>
  )
}
