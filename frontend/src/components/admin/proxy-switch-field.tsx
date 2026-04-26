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
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2",
        className
      )}
    >
      <Label htmlFor={id} className="min-w-0 cursor-pointer">
        使用代理
        <span className="block text-xs font-normal text-muted-foreground">
          开启走全局代理，关闭直连
        </span>
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label="使用代理"
      />
    </div>
  )
}
