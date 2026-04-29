import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  DollarSign,
  Download,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import {
  createModelPrice,
  deleteModelPrice,
  importDefaultModelPrices,
  listModelPrices,
  updateModelPrice,
  type ModelPrice,
  type ModelPriceInput,
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
import { DataTable, DataTableSortableHeader } from "@/components/ui/data-table"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type FormState = {
  model: string
  inputUSDPerMillion: string
  cacheReadUSDPerMillion: string
  cacheWriteUSDPerMillion: string
  outputUSDPerMillion: string
  reasoningUSDPerMillion: string
  note: string
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

function priceSortValue(value?: string | null) {
  if (!value) return -1
  const n = Number(value)
  return Number.isFinite(n) ? n : -1
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
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const seedModel = searchParams.get("model") ?? ""

  const [prices, setPrices] = useState<ModelPrice[]>([])
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(() => seedModel !== "")
  const [formTarget, setFormTarget] = useState<ModelPrice | null>(null)
  const [form, setForm] = useState<FormState>(() =>
    emptyForm({ model: seedModel })
  )
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
          toast.error(errorMessage(err, t("errors.loadModelPricesFailed")))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  const openCreate = useCallback((seed?: Partial<FormState>) => {
    setFormTarget(null)
    setForm(emptyForm(seed))
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((price: ModelPrice) => {
    setFormTarget(price)
    setForm(formFromPrice(price))
    setFormOpen(true)
  }, [])

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
    setSubmitting(true)
    try {
      const saved = formTarget
        ? await updateModelPrice(formTarget.id, formInput())
        : await createModelPrice(formInput())
      setPrices((prev) => upsertPrice(prev, saved))
      setFormOpen(false)
    } catch (err) {
      toast.error(errorMessage(err, t("errors.saveFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteModelPrice(deleteTarget.id)
      setPrices((prev) => prev.filter((price) => price.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(errorMessage(err, t("errors.deleteFailed")))
    } finally {
      setDeleting(false)
    }
  }

  async function handleImportDefaults() {
    setImportingDefaults(true)
    try {
      const result = await importDefaultModelPrices()
      const items = await listModelPrices()
      setPrices(items)
      toast.success(
        t("modelPrices.importDefaultPricesResult", {
          created: result.created,
          skipped: result.skipped,
          total: result.total,
        })
      )
    } catch (err) {
      toast.error(errorMessage(err, t("errors.importDefaultPricesFailed")))
    } finally {
      setImportingDefaults(false)
    }
  }

  const priceColumns = useMemo<ColumnDef<ModelPrice>[]>(
    () => [
      {
        id: "model",
        accessorKey: "model",
        header: ({ column }) => (
          <DataTableSortableHeader
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("modelPrices.model")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.model}</span>
        ),
        meta: { headClassName: "min-w-52", label: t("modelPrices.model") },
      },
      {
        id: "input",
        accessorFn: (row) => priceSortValue(row.input_usd_per_million),
        sortingFn: "basic",
        header: ({ column }) => (
          <DataTableSortableHeader
            align="right"
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("modelPrices.inputPrice")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => displayPrice(row.original.input_usd_per_million),
        meta: { align: "right", label: t("modelPrices.inputPrice") },
      },
      {
        id: "cacheRead",
        accessorFn: (row) => priceSortValue(row.cache_read_usd_per_million),
        sortingFn: "basic",
        header: ({ column }) => (
          <DataTableSortableHeader
            align="right"
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("modelPrices.cacheReadPrice")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) =>
          displayPrice(row.original.cache_read_usd_per_million),
        meta: { align: "right", label: t("modelPrices.cacheReadPrice") },
      },
      {
        id: "cacheWrite",
        accessorFn: (row) => priceSortValue(row.cache_write_usd_per_million),
        sortingFn: "basic",
        header: ({ column }) => (
          <DataTableSortableHeader
            align="right"
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("modelPrices.cacheWritePrice")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) =>
          displayPrice(row.original.cache_write_usd_per_million),
        meta: { align: "right", label: t("modelPrices.cacheWritePrice") },
      },
      {
        id: "output",
        accessorFn: (row) => priceSortValue(row.output_usd_per_million),
        sortingFn: "basic",
        header: ({ column }) => (
          <DataTableSortableHeader
            align="right"
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("modelPrices.outputPrice")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => displayPrice(row.original.output_usd_per_million),
        meta: { align: "right", label: t("modelPrices.outputPrice") },
      },
      {
        id: "reasoning",
        accessorFn: (row) => priceSortValue(row.reasoning_usd_per_million),
        sortingFn: "basic",
        header: ({ column }) => (
          <DataTableSortableHeader
            align="right"
            isSorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            {t("modelPrices.reasoningPrice")}
          </DataTableSortableHeader>
        ),
        cell: ({ row }) => displayPrice(row.original.reasoning_usd_per_million),
        meta: { align: "right", label: t("modelPrices.reasoningPrice") },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => {
          const price = row.original
          return (
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
          )
        },
        meta: { headClassName: "w-12", align: "right" },
      },
    ],
    [openEdit, t]
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex max-w-3xl flex-col gap-2">
          <h1 className="text-xl font-semibold">{t("modelPrices.title")}</h1>
        </div>
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

      <div className="flex flex-col gap-4">
        <DataTable
          columns={priceColumns}
          data={prices}
          loading={loading}
          loadingLabel={t("common.loading")}
          emptyLabel={t("modelPrices.noPrices")}
          noResultsLabel={t("modelPrices.noSearchResults")}
          searchColumnId="model"
          searchPlaceholder={t("modelPrices.searchPlaceholder")}
          searchAriaLabel={t("modelPrices.searchAriaLabel")}
          getRowId={(row) => row.id}
        />
        <p className="text-xs text-muted-foreground">
          {t("modelPrices.pricePerMillion")}
        </p>
      </div>

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

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="price-model">
                  {t("modelPrices.model")}
                </FieldLabel>
                <Input
                  id="price-model"
                  value={form.model}
                  onChange={(event) => patchForm({ model: event.target.value })}
                  className="font-mono text-xs"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="price-input">
                  {t("modelPrices.inputPrice")}
                </FieldLabel>
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
              </Field>
              <Field>
                <FieldLabel htmlFor="price-cache-read">
                  {t("modelPrices.cacheReadPrice")}
                </FieldLabel>
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
              </Field>
              <Field>
                <FieldLabel htmlFor="price-cache-write">
                  {t("modelPrices.cacheWritePrice")}
                </FieldLabel>
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
              </Field>
              <Field>
                <FieldLabel htmlFor="price-output">
                  {t("modelPrices.outputPrice")}
                </FieldLabel>
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
              </Field>
              <Field>
                <FieldLabel htmlFor="price-reasoning">
                  {t("modelPrices.reasoningPrice")}
                </FieldLabel>
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
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="price-note">
                  {t("modelPrices.note")}
                </FieldLabel>
                <Input
                  id="price-note"
                  value={form.note}
                  onChange={(event) => patchForm({ note: event.target.value })}
                  placeholder={t("modelPrices.optional")}
                />
              </Field>
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
