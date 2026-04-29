import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Check, Save } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { updateCurrentUser } from "@/lib/auth-client"
import { useAuth } from "@/lib/auth-context"
import {
  languageOptions,
  setStoredLanguage,
  supportedLanguage,
  type SupportedLanguage,
} from "@/lib/i18n"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [languageSaving, setLanguageSaving] = useState(false)
  const [languageError, setLanguageError] = useState<string | null>(null)
  const [languageSavedTick, setLanguageSavedTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setName(user?.name ?? "")
      setLanguage(supportedLanguage(user?.language))
    })
    return () => {
      cancelled = true
    }
  }, [user?.name, user?.language])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }),
    [i18n.language]
  )

  const profileDirty = useMemo(() => {
    if (!user) return false
    return name.trim() !== (user.name ?? "")
  }, [name, user])

  const displayName = user?.name?.trim() || user?.email?.split("@")[0] || ""
  const initial = (displayName || user?.email || "?").charAt(0).toUpperCase()
  const memberSince = user?.created_at
    ? dateFmt.format(new Date(user.created_at))
    : "-"
  const roleLabel =
    user?.role === "admin" ? t("settings.roleAdmin") : t("settings.roleUser")

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault()
    setProfileSaved(false)
    setProfileSaving(true)
    try {
      await updateCurrentUser({ name })
      await refresh()
      setProfileSaved(true)
    } catch (err) {
      toast.error(errorMessage(err) ?? t("errors.saveFailed"))
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleLanguageChange(value: string | null) {
    if (!value) return
    const next = supportedLanguage(value)
    if (next === language) return
    setLanguageError(null)
    setLanguageSaving(true)
    try {
      await updateCurrentUser({ language: next })
      await refresh()
      setLanguage(next)
      setStoredLanguage(next)
      void i18n.changeLanguage(next)
      setLanguageSavedTick((tick) => tick + 1)
    } catch (err) {
      setLanguageError(errorMessage(err) ?? t("settings.languageSaveFailed"))
    } finally {
      setLanguageSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-10 pb-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("settings.generalTitle")}</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <SectionHeader title={t("settings.account")} />
          <div className="flex items-center gap-4">
            <Avatar size="lg">
              <AvatarFallback className="text-base">{initial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {displayName || "-"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {user?.email ?? "-"}
              </div>
            </div>
          </div>
          <dl className="grid gap-3 pt-2 text-sm sm:grid-cols-3">
            <ReadOnlyField label={t("settings.email")} value={user?.email} />
            <ReadOnlyField
              label={t("settings.role")}
              value={<Badge variant="outline">{roleLabel}</Badge>}
            />
            <ReadOnlyField
              label={t("settings.memberSince")}
              value={memberSince}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <SectionHeader title={t("settings.profile")} />
          <form onSubmit={handleProfileSubmit} className="mt-4 grid gap-4">
            <Field>
              <FieldLabel htmlFor="settings-name">
                {t("settings.name")}
              </FieldLabel>
              <Input
                id="settings-name"
                value={name}
                maxLength={80}
                autoComplete="name"
                onChange={(e) => {
                  setName(e.target.value)
                  setProfileSaved(false)
                }}
              />
            </Field>

            <div className="flex items-center justify-end gap-3">
              {profileSaved && !profileDirty && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" />
                  {t("common.saved")}
                </span>
              )}
              <Button type="submit" disabled={profileSaving || !profileDirty}>
                <Save />
                {profileSaving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <SectionHeader title={t("settings.preferences")} />
          <Field className="mt-4" data-invalid={!!languageError}>
            <FieldLabel htmlFor="settings-language">
              {t("settings.language")}
            </FieldLabel>
            <Select
              value={language}
              onValueChange={(value) => void handleLanguageChange(value)}
            >
              <SelectTrigger
                id="settings-language"
                className="w-full"
                disabled={languageSaving}
              >
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
            <LanguageStatus
              saving={languageSaving}
              error={languageError}
              savedTick={languageSavedTick}
              savingLabel={t("common.saving")}
              savedLabel={t("settings.languageSavedHint")}
            />
          </Field>
        </CardContent>
      </Card>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-base font-medium">{title}</h2>
}

function ReadOnlyField({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm">
        {value === undefined || value === null || value === "" ? "-" : value}
      </dd>
    </div>
  )
}

function LanguageStatus({
  saving,
  error,
  savedTick,
  savingLabel,
  savedLabel,
}: {
  saving: boolean
  error: string | null
  savedTick: number
  savingLabel: string
  savedLabel: string
}) {
  if (error) {
    return <FieldError className="text-xs">{error}</FieldError>
  }
  if (saving) {
    return (
      <FieldDescription className="text-xs">{savingLabel}</FieldDescription>
    )
  }
  if (savedTick > 0) {
    return (
      <FieldDescription className="inline-flex items-center gap-1 text-xs">
        <Check className="size-3" />
        {savedLabel}
      </FieldDescription>
    )
  }
  return null
}
