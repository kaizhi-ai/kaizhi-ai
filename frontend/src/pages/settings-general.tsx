import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Save } from "lucide-react"

import { updateCurrentUser } from "@/lib/auth-client"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const languageOptions = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
]

function supportedLanguage(value?: string) {
  return languageOptions.some((item) => item.value === value)
    ? (value as string)
    : "zh-CN"
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "保存失败"
}

export default function SettingsGeneralPage() {
  const { user, refresh } = useAuth()
  const [name, setName] = useState("")
  const [language, setLanguage] = useState("zh-CN")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setName(user?.name ?? "")
      setLanguage(supportedLanguage(user?.language))
      setError(null)
    })
    return () => {
      cancelled = true
    }
  }, [user?.name, user?.language])

  const dirty = useMemo(() => {
    if (!user) return false
    return name.trim() !== (user.name ?? "") || language !== user.language
  }, [language, name, user])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      await updateCurrentUser({ name, language })
      await refresh()
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">通用</h1>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
          已保存
        </div>
      )}

      <form onSubmit={handleSubmit} className="rounded-lg border p-4 sm:p-6">
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            <Label htmlFor="settings-name">名字</Label>
            <Input
              id="settings-name"
              value={name}
              maxLength={80}
              autoComplete="name"
              onChange={(e) => {
                setName(e.target.value)
                setSaved(false)
              }}
              className="h-9"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="settings-language">语言</Label>
            <Select
              value={language}
              onValueChange={(value) => {
                if (!value) return
                setLanguage(value)
                setSaved(false)
              }}
            >
              <SelectTrigger id="settings-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !dirty}>
              <Save />
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
