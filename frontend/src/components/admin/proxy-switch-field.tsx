import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { Field, FieldLabel } from "@/components/ui/field"
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
    <Field
      orientation="horizontal"
      className={cn("w-fit items-center gap-2", className)}
    >
      <FieldLabel htmlFor={id} className="flex-none cursor-pointer">
        {t("proxy.useProxy")}
      </FieldLabel>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={t("proxy.useProxy")}
      />
    </Field>
  )
}
