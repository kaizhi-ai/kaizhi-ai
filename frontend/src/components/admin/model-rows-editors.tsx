import type { ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { modelAliasFromName } from "@/lib/model-alias"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type ModelRow = { name: string; alias: string }

export function ModelRowsEditor({
  rows,
  onChange,
  fetchSlot,
}: {
  rows: ModelRow[]
  onChange: (next: ModelRow[]) => void
  fetchSlot?: ReactNode
}) {
  const { t } = useTranslation()
  function update(index: number, patch: Partial<ModelRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function updateName(index: number, name: string) {
    onChange(
      rows.map((row, i) => {
        if (i !== index) return row
        const previousAutoAlias = modelAliasFromName(row.name)
        const shouldUpdateAlias =
          row.alias.trim() === "" || row.alias.trim() === previousAutoAlias
        return {
          ...row,
          name,
          alias: shouldUpdateAlias ? modelAliasFromName(name) : row.alias,
        }
      })
    )
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...rows, { name: "", alias: "" }])
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder={t("provider.upstreamName")}
            value={row.name}
            onChange={(event) => updateName(index, event.target.value)}
            className="h-9 flex-1 font-mono text-xs"
          />
          <Input
            placeholder={t("provider.modelAliasPlaceholder")}
            value={row.alias}
            onChange={(event) => update(index, { alias: event.target.value })}
            className="h-9 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("provider.modelDelete")}
            onClick={() => remove(index)}
            className="self-end sm:self-auto"
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          className="self-start"
        >
          <Plus />
          {t("common.add")}
        </Button>
        {fetchSlot}
      </div>
    </div>
  )
}

export function ExcludedRowsEditor({
  rows,
  onChange,
}: {
  rows: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useTranslation()
  function update(index: number, value: string) {
    onChange(rows.map((row, i) => (i === index ? value : row)))
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...rows, ""])
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            placeholder={t("provider.modelExcludedPlaceholder")}
            value={value}
            onChange={(event) => update(index, event.target.value)}
            className="h-9 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("provider.modelDelete")}
            onClick={() => remove(index)}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="self-start"
      >
        <Plus />
        {t("common.add")}
      </Button>
    </div>
  )
}
