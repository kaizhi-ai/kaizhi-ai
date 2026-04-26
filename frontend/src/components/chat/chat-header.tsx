import { SidebarTrigger } from "@/components/ui/sidebar"

type ChatHeaderProps = {
  title: string
}

export function ChatHeader({ title }: ChatHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-3">
      <SidebarTrigger className="md:hidden" />
      <span className="truncate text-sm font-medium">{title}</span>
    </header>
  )
}
