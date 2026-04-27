import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type ProxySwitchFieldProps = {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
}

export function ProxySwitchField({
  id,
  checked,
  onCheckedChange,
  className,
}: ProxySwitchFieldProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2",
        className
      )}
    >
      <Label htmlFor={id} className="min-w-0 cursor-pointer">
        {t("proxy.useProxy")}
        <span className="block text-xs font-normal text-muted-foreground">
          {t("proxy.fieldDescription")}
        </span>
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={t("proxy.useProxy")}
      />
    </div>
  )
}
