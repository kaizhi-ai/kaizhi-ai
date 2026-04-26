import type { ReactNode } from "react"
import { Plus, X } from "lucide-react"

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
            placeholder="upstream name"
            value={row.name}
            onChange={(event) => updateName(index, event.target.value)}
            className="h-9 flex-1 font-mono text-xs"
          />
          <Input
            placeholder="alias (留空则同 name)"
            value={row.alias}
            onChange={(event) => update(index, { alias: event.target.value })}
            className="h-9 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="删除模型"
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
          添加
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
            placeholder="gpt-5-* 或 *codex*"
            value={value}
            onChange={(event) => update(index, event.target.value)}
            className="h-9 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="删除模型"
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
        添加
      </Button>
    </div>
  )
}
