"use client"

import * as React from "react"
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

function parseDateValue(value: string | undefined) {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

function dateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function sameDay(left: Date | null, right: Date | null) {
  if (!left || !right) return false
  return dateValue(left) === dateValue(right)
}

function monthLabel(date: Date, locale: string | undefined) {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(date)
}

function displayLabel(value: string | undefined, locale: string | undefined) {
  const date = parseDateValue(value)
  if (!date) return value || ""
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(date)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function calendarDays(month: Date) {
  const first = startOfMonth(month)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

function weekdays(locale: string | undefined) {
  const weekdayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
  })
  const monday = new Date(2024, 0, 1)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + index)
    return weekdayFormat.format(day)
  })
}

type DatePickerProps = {
  id?: string
  value: string
  onValueChange: (value: string) => void
  locale?: string
  className?: string
  disabled?: boolean
  previousMonthLabel?: string
  nextMonthLabel?: string
}

function DatePicker({
  id,
  value,
  onValueChange,
  locale,
  className,
  disabled,
  previousMonthLabel = "Previous month",
  nextMonthLabel = "Next month",
}: DatePickerProps) {
  const selectedDate = React.useMemo(() => parseDateValue(value), [value])
  const [open, setOpen] = React.useState(false)
  const [visibleMonth, setVisibleMonth] = React.useState(() =>
    startOfMonth(selectedDate ?? new Date())
  )
  const today = React.useMemo(() => new Date(), [])
  const weekdayLabels = React.useMemo(() => weekdays(locale), [locale])

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && selectedDate) {
      setVisibleMonth(startOfMonth(selectedDate))
    }
    setOpen(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full justify-start text-left font-normal",
          !value && "text-muted-foreground",
          className
        )}
      >
        <CalendarIcon />
        <span className="truncate">{displayLabel(value, locale)}</span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6}>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={previousMonthLabel}
            onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
          >
            <ChevronLeftIcon />
          </Button>
          <div className="min-w-0 truncate text-sm font-medium">
            {monthLabel(visibleMonth, locale)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={nextMonthLabel}
            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
          >
            <ChevronRightIcon />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {weekdayLabels.map((weekday) => (
            <div key={weekday} className="py-1">
              {weekday}
            </div>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
          {calendarDays(visibleMonth).map((day) => {
            const selected = sameDay(day, selectedDate)
            const outside = day.getMonth() !== visibleMonth.getMonth()
            return (
              <Button
                key={dateValue(day)}
                type="button"
                variant={selected ? "default" : "ghost"}
                size="icon-sm"
                aria-pressed={selected}
                className={cn(
                  "aspect-square w-full tabular-nums",
                  outside && "text-muted-foreground/50",
                  sameDay(day, today) && !selected && "text-primary"
                )}
                onClick={() => {
                  onValueChange(dateValue(day))
                  setOpen(false)
                }}
              >
                {day.getDate()}
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
