import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Save } from "lucide-react"
import { useTranslation } from "react-i18next"

import { updateCurrentUser } from "@/lib/auth-client"
import { useAuth } from "@/lib/auth-context"
import {
  languageOptions,
  setStoredLanguage,
  supportedLanguage,
  type SupportedLanguage,
} from "@/lib/i18n"
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

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : null
}

export default function SettingsGeneralPage() {
  const { t, i18n } = useTranslation()
  const { user, refresh } = useAuth()
  const [name, setName] = useState("")
  const [language, setLanguage] =
    useState<SupportedLanguage>(supportedLanguage())
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
    return (
      name.trim() !== (user.name ?? "") ||
      language !== supportedLanguage(user.language)
    )
  }, [language, name, user])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      await updateCurrentUser({ name, language })
      await refresh()
      setStoredLanguage(language)
      void i18n.changeLanguage(language)
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err) ?? t("errors.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("settings.generalTitle")}</h1>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
          {t("common.saved")}
        </div>
      )}

      <form onSubmit={handleSubmit} className="rounded-lg border p-4 sm:p-6">
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            <Label htmlFor="settings-name">{t("settings.name")}</Label>
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
            <Label htmlFor="settings-language">{t("settings.language")}</Label>
            <Select
              value={language}
              onValueChange={(value) => {
                if (!value) return
                const nextLanguage = supportedLanguage(value)
                setLanguage(nextLanguage)
                setStoredLanguage(nextLanguage)
                void i18n.changeLanguage(nextLanguage)
                setSaved(false)
              }}
            >
              <SelectTrigger id="settings-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !dirty}>
              <Save />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
