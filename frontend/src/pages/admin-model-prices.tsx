import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  DollarSign,
  Download,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  createModelPrice,
  deleteModelPrice,
  importDefaultModelPrices,
  listModelPrices,
  listUnmatchedModels,
  updateModelPrice,
  type ModelPrice,
  type ModelPriceInput,
  type UnmatchedModel,
} from "@/lib/admin-model-prices-client"
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
  DialogFooter,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type View = "prices" | "unmatched"

type FormState = {
  model: string
  inputUSDPerMillion: string
  cacheReadUSDPerMillion: string
  cacheWriteUSDPerMillion: string
  outputUSDPerMillion: string
  reasoningUSDPerMillion: string
  note: string
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function emptyForm(seed?: Partial<FormState>): FormState {
  return {
    model: seed?.model ?? "",
    inputUSDPerMillion: seed?.inputUSDPerMillion ?? "",
    cacheReadUSDPerMillion: seed?.cacheReadUSDPerMillion ?? "",
    cacheWriteUSDPerMillion: seed?.cacheWriteUSDPerMillion ?? "",
    outputUSDPerMillion: seed?.outputUSDPerMillion ?? "",
    reasoningUSDPerMillion: seed?.reasoningUSDPerMillion ?? "",
    note: seed?.note ?? "",
  }
}

function formFromPrice(price: ModelPrice): FormState {
  return {
    model: price.model,
    inputUSDPerMillion: trimDecimal(price.input_usd_per_million),
    cacheReadUSDPerMillion: trimDecimal(price.cache_read_usd_per_million ?? ""),
    cacheWriteUSDPerMillion: trimDecimal(
      price.cache_write_usd_per_million ?? ""
    ),
    outputUSDPerMillion: trimDecimal(price.output_usd_per_million),
    reasoningUSDPerMillion: trimDecimal(price.reasoning_usd_per_million ?? ""),
    note: price.note ?? "",
  }
}

function trimDecimal(value: string) {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

function displayPrice(value?: string | null) {
  if (!value) return "-"
  return `$${trimDecimal(value)}`
}

function formatNumber(value: number, fmt: Intl.NumberFormat) {
  return fmt.format(value)
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

function upsertPrice(prices: ModelPrice[], next: ModelPrice) {
  const exists = prices.some((price) => price.id === next.id)
  if (!exists) return [next, ...prices]
  return prices.map((price) => (price.id === next.id ? next : price))
}

export default function AdminModelPricesPage() {
  const { t, i18n } = useTranslation()
  const numberFmt = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language]
  )

  const [view, setView] = useState<View>("prices")
  const [prices, setPrices] = useState<ModelPrice[]>([])
  const [unmatched, setUnmatched] = useState<UnmatchedModel[]>([])
  const [loading, setLoading] = useState(true)
  const [unmatchedLoading, setUnmatchedLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [from, setFrom] = useState(daysAgoDate(30))
  const [to, setTo] = useState(todayDate())

  const [formOpen, setFormOpen] = useState(false)
  const [formTarget, setFormTarget] = useState<ModelPrice | null>(null)
  const [form, setForm] = useState<FormState>(() => emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [importingDefaults, setImportingDefaults] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelPrice | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    listModelPrices()
      .then((items) => {
        if (!cancelled) setPrices(items)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err, t("errors.loadModelPricesFailed")))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    void refreshUnmatched()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredPrices = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return prices.filter((price) => {
      if (!needle) return true
      return price.model.toLowerCase().includes(needle)
    })
  }, [prices, query])

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function openCreate(seed?: Partial<FormState>) {
    setFormTarget(null)
    setForm(emptyForm(seed))
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(price: ModelPrice) {
    setFormTarget(price)
    setForm(formFromPrice(price))
    setFormError(null)
    setFormOpen(true)
  }

  function formInput(): ModelPriceInput {
    return {
      model: form.model,
      inputUSDPerMillion: form.inputUSDPerMillion,
      cacheReadUSDPerMillion: form.cacheReadUSDPerMillion,
      cacheWriteUSDPerMillion: form.cacheWriteUSDPerMillion,
      outputUSDPerMillion: form.outputUSDPerMillion,
      reasoningUSDPerMillion: form.reasoningUSDPerMillion,
      note: form.note,
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const saved = formTarget
        ? await updateModelPrice(formTarget.id, formInput())
        : await createModelPrice(formInput())
      setPrices((prev) => upsertPrice(prev, saved))
      setFormOpen(false)
      void refreshUnmatched()
    } catch (err) {
      setFormError(errorMessage(err, t("errors.saveFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    setNotice(null)
    try {
      await deleteModelPrice(deleteTarget.id)
      setPrices((prev) => prev.filter((price) => price.id !== deleteTarget.id))
      setDeleteTarget(null)
      void refreshUnmatched()
    } catch (err) {
      setError(errorMessage(err, t("errors.deleteFailed")))
    } finally {
      setDeleting(false)
    }
  }

  async function handleImportDefaults() {
    setImportingDefaults(true)
    setError(null)
    setNotice(null)
    try {
      const result = await importDefaultModelPrices()
      const items = await listModelPrices()
      setPrices(items)
      setNotice(
        t("modelPrices.importDefaultPricesResult", {
          created: result.created,
          skipped: result.skipped,
          total: result.total,
        })
      )
      void refreshUnmatched()
    } catch (err) {
      setError(errorMessage(err, t("errors.importDefaultPricesFailed")))
    } finally {
      setImportingDefaults(false)
    }
  }

  async function refreshUnmatched() {
    setUnmatchedLoading(true)
    setError(null)
    try {
      const items = await listUnmatchedModels(from, to)
      setUnmatched(items)
    } catch (err) {
      setError(errorMessage(err, t("errors.loadUnmatchedModelsFailed")))
    } finally {
      setUnmatchedLoading(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <div className="flex max-w-3xl flex-col gap-2">
          <h1 className="text-xl font-semibold">{t("modelPrices.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("modelPrices.description")}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList>
            <TabsTrigger value="prices">{t("modelPrices.prices")}</TabsTrigger>
            <TabsTrigger value="unmatched">
              {t("modelPrices.unmatched")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => void handleImportDefaults()}
            disabled={importingDefaults}
          >
            <Download />
            {importingDefaults
              ? t("modelPrices.importingDefaultPrices")
              : t("modelPrices.importDefaultPrices")}
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => openCreate()}
          >
            <Plus />
            {t("modelPrices.addPrice")}
          </Button>
        </div>
      </div>

      {view === "prices" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("modelPrices.searchPlaceholder")}
                className="pl-8"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-52">
                    {t("modelPrices.model")}
                  </TableHead>
                  <TableHead>{t("modelPrices.inputPrice")}</TableHead>
                  <TableHead>{t("modelPrices.cacheReadPrice")}</TableHead>
                  <TableHead>{t("modelPrices.cacheWritePrice")}</TableHead>
                  <TableHead>{t("modelPrices.outputPrice")}</TableHead>
                  <TableHead>{t("modelPrices.reasoningPrice")}</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : filteredPrices.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {t("modelPrices.noPrices")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPrices.map((price) => (
                    <TableRow key={price.id}>
                      <TableCell className="font-mono text-xs">
                        {price.model}
                      </TableCell>
                      <TableCell>
                        {displayPrice(price.input_usd_per_million)}
                      </TableCell>
                      <TableCell>
                        {displayPrice(price.cache_read_usd_per_million)}
                      </TableCell>
                      <TableCell>
                        {displayPrice(price.cache_write_usd_per_million)}
                      </TableCell>
                      <TableCell>
                        {displayPrice(price.output_usd_per_million)}
                      </TableCell>
                      <TableCell>
                        {displayPrice(price.reasoning_usd_per_million)}
                      </TableCell>
                      <TableCell className="text-right">
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
                            <DropdownMenuItem onClick={() => openEdit(price)}>
                              <DollarSign />
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget(price)}
                              className="text-destructive"
                            >
                              <Trash2 />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("modelPrices.pricePerMillion")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="unmatched-from">{t("modelPrices.from")}</Label>
              <Input
                id="unmatched-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unmatched-to">{t("modelPrices.to")}</Label>
              <Input
                id="unmatched-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refreshUnmatched()}
              disabled={unmatchedLoading}
              className="sm:mb-0"
            >
              <RefreshCw />
              {unmatchedLoading
                ? t("common.loading")
                : t("modelPrices.refreshUnmatched")}
            </Button>
          </div>

          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("modelPrices.unmatchedDescription")}
          </p>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("modelPrices.model")}</TableHead>
                  <TableHead>{t("modelPrices.requestCount")}</TableHead>
                  <TableHead>{t("modelPrices.totalTokens")}</TableHead>
                  <TableHead>{t("modelPrices.firstSeen")}</TableHead>
                  <TableHead>{t("modelPrices.lastSeen")}</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmatchedLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : unmatched.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {t("modelPrices.noUnmatched")}
                    </TableCell>
                  </TableRow>
                ) : (
                  unmatched.map((item) => (
                    <TableRow key={item.model}>
                      <TableCell className="font-mono text-xs">
                        {item.model}
                      </TableCell>
                      <TableCell>
                        {formatNumber(item.request_count, numberFmt)}
                      </TableCell>
                      <TableCell>
                        {formatNumber(item.total_tokens, numberFmt)}
                      </TableCell>
                      <TableCell>{item.first_seen}</TableCell>
                      <TableCell>{item.last_seen}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openCreate({
                              model: item.model,
                            })
                          }
                        >
                          <Plus />
                          {t("modelPrices.addFromUsage")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-3xl">
          <form onSubmit={handleSubmit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>
                {formTarget
                  ? t("modelPrices.editPrice")
                  : t("modelPrices.addPrice")}
              </DialogTitle>
              <DialogDescription>
                {t("modelPrices.formDescription")}
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="price-model">{t("modelPrices.model")}</Label>
                <Input
                  id="price-model"
                  value={form.model}
                  onChange={(event) => patchForm({ model: event.target.value })}
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="price-input">
                  {t("modelPrices.inputPrice")}
                </Label>
                <Input
                  id="price-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.00000001"
                  value={form.inputUSDPerMillion}
                  onChange={(event) =>
                    patchForm({ inputUSDPerMillion: event.target.value })
                  }
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="price-cache-read">
                  {t("modelPrices.cacheReadPrice")}
                </Label>
                <Input
                  id="price-cache-read"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.00000001"
                  value={form.cacheReadUSDPerMillion}
                  onChange={(event) =>
                    patchForm({
                      cacheReadUSDPerMillion: event.target.value,
                    })
                  }
                  placeholder={t("modelPrices.optional")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="price-cache-write">
                  {t("modelPrices.cacheWritePrice")}
                </Label>
                <Input
                  id="price-cache-write"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.00000001"
                  value={form.cacheWriteUSDPerMillion}
                  onChange={(event) =>
                    patchForm({
                      cacheWriteUSDPerMillion: event.target.value,
                    })
                  }
                  placeholder={t("modelPrices.optional")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="price-output">
                  {t("modelPrices.outputPrice")}
                </Label>
                <Input
                  id="price-output"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.00000001"
                  value={form.outputUSDPerMillion}
                  onChange={(event) =>
                    patchForm({ outputUSDPerMillion: event.target.value })
                  }
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="price-reasoning">
                  {t("modelPrices.reasoningPrice")}
                </Label>
                <Input
                  id="price-reasoning"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.00000001"
                  value={form.reasoningUSDPerMillion}
                  onChange={(event) =>
                    patchForm({ reasoningUSDPerMillion: event.target.value })
                  }
                  placeholder={t("modelPrices.optional")}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="price-note">{t("modelPrices.note")}</Label>
                <Input
                  id="price-note"
                  value={form.note}
                  onChange={(event) => patchForm({ note: event.target.value })}
                  placeholder={t("modelPrices.optional")}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("modelPrices.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("modelPrices.deleteDescription", {
                model: deleteTarget?.model ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
