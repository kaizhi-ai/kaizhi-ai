import { Globe, Image as ImageIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ChatUIMessage, ChatUIPart } from "@/lib/chat-types"
import { Loader } from "@/components/ui/loader"
import { MessageContent } from "@/components/ui/message"
import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/ui/steps"

type NormalizedResult = { url: string; title?: string | null }
type WebSearchPart = Extract<ChatUIPart, { type: "tool-web_search" }>
type ImageGenerationPart = Extract<
  ChatUIPart,
  { type: "tool-image_generation" }
>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeResults(output: unknown): NormalizedResult[] {
  const out: NormalizedResult[] = []
  const pushEntry = (entry: unknown) => {
    const o = asRecord(entry)
    if (!o) return
    const url = typeof o.url === "string" ? o.url : null
    if (!url) return
    out.push({ url, title: typeof o.title === "string" ? o.title : null })
  }

  if (!output) return out
  if (Array.isArray(output)) {
    for (const result of output) pushEntry(result)
    return out
  }

  const o = asRecord(output)
  if (Array.isArray(o?.sources)) {
    for (const source of o.sources) pushEntry(source)
  }
  return out
}

function extractQuery(part: WebSearchPart): string {
  const input = asRecord(part.input)
  if (typeof input?.query === "string") return input.query

  if (part.state !== "output-available") return ""
  const output = asRecord(part.output)
  const action = asRecord(output?.action)
  if (typeof action?.query === "string") return action.query
  return ""
}

function collectSourceUrls(parts: ChatUIMessage["parts"]): NormalizedResult[] {
  const seen = new Set<string>()
  const out: NormalizedResult[] = []
  for (const part of parts) {
    if (part.type !== "source-url") continue
    if (!part.url || seen.has(part.url)) continue
    seen.add(part.url)
    out.push({ url: part.url, title: part.title ?? null })
  }
  return out
}

function generatedImageDataURL(part: ImageGenerationPart) {
  if (part.state !== "output-available") return null
  const result = part.output.result.trim()
  if (!result) return null
  if (result.startsWith("data:image/")) return result
  return `data:image/webp;base64,${result}`
}

function WebSearchStep({
  part,
  fallbackResults,
}: {
  part: WebSearchPart
  fallbackResults: NormalizedResult[]
}) {
  const { t } = useTranslation()
  const query = extractQuery(part)
  const parsed =
    part.state === "output-available" ? normalizeResults(part.output) : []
  const results = parsed.length > 0 ? parsed : fallbackResults
  const isDone = part.state === "output-available"
  const isError = part.state === "output-error"
  const isDenied = part.state === "output-denied"
  const isLoading = !isDone && !isError && !isDenied

  const label = isError
    ? t("chat.search.failed")
    : isDenied
      ? t("chat.search.notRun")
      : isDone
        ? query
          ? t("chat.search.completedWithQuery", {
              query,
              count: results.length,
            })
          : t("chat.search.completed", { count: results.length })
        : query
          ? t("chat.search.loadingWithQuery", { query })
          : t("chat.search.loading")

  return (
    <Steps defaultOpen={false} className="my-1">
      <StepsTrigger
        leftIcon={
          isLoading ? (
            <Loader variant="circular" size="sm" />
          ) : (
            <Globe className="size-4" />
          )
        }
        swapIconOnHover={!isLoading}
      >
        {label}
      </StepsTrigger>
      <StepsContent>
        {isError ? (
          <StepsItem className="text-destructive">
            {part.errorText ?? t("errors.unknown")}
          </StepsItem>
        ) : isDenied ? (
          <StepsItem>{t("chat.search.noSearchResults")}</StepsItem>
        ) : results.length === 0 ? (
          <StepsItem>
            {isDone ? t("chat.search.noResults") : t("chat.search.waiting")}
          </StepsItem>
        ) : (
          results.map((result, index) => (
            <StepsItem key={`${result.url}-${index}`}>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block hover:text-foreground"
              >
                <div className="line-clamp-1 text-sm font-medium text-foreground">
                  {result.title ?? result.url}
                </div>
                <div className="line-clamp-1 text-xs opacity-60">
                  {result.url}
                </div>
              </a>
            </StepsItem>
          ))
        )}
      </StepsContent>
    </Steps>
  )
}

function StandaloneSources({ results }: { results: NormalizedResult[] }) {
  const { t } = useTranslation()
  return (
    <Steps defaultOpen={false} className="my-1">
      <StepsTrigger leftIcon={<Globe className="size-4" />}>
        {t("chat.search.sources", { count: results.length })}
      </StepsTrigger>
      <StepsContent>
        {results.map((result, index) => (
          <StepsItem key={`${result.url}-${index}`}>
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block hover:text-foreground"
            >
              <div className="line-clamp-1 text-sm font-medium text-foreground">
                {result.title ?? result.url}
              </div>
              <div className="line-clamp-1 text-xs opacity-60">
                {result.url}
              </div>
            </a>
          </StepsItem>
        ))}
      </StepsContent>
    </Steps>
  )
}

function ImageGenerationStep({ part }: { part: ImageGenerationPart }) {
  const { t } = useTranslation()
  const imageSrc = generatedImageDataURL(part)
  const isError = part.state === "output-error"
  const isDenied = part.state === "output-denied"
  const isDone = Boolean(imageSrc)
  const isLoading = !isDone && !isError && !isDenied

  if (imageSrc) {
    return (
      <a
        href={imageSrc}
        target="_blank"
        rel="noreferrer noopener"
        className="my-1 block"
      >
        <img
          src={imageSrc}
          alt={t("chat.generatedImage")}
          className="max-h-[28rem] max-w-full rounded-md border border-border object-contain"
        />
      </a>
    )
  }

  const label = isError
    ? (part.errorText ?? t("chat.imageGenerationFailed"))
    : isDenied
      ? t("chat.imageGenerationNotRun")
      : isLoading
        ? t("chat.imageGenerationRunning")
        : t("chat.imageGenerationWaiting")

  return (
    <div
      className={
        isError
          ? "my-1 flex items-center gap-2 text-sm text-destructive"
          : "my-1 flex items-center gap-2 text-sm text-muted-foreground"
      }
    >
      {isLoading ? (
        <Loader variant="circular" size="sm" />
      ) : (
        <ImageIcon className="size-4" />
      )}
      <span>{label}</span>
    </div>
  )
}

export function AssistantMessageParts({
  parts,
}: {
  parts: ChatUIMessage["parts"]
}) {
  const sourceUrls = collectSourceUrls(parts)
  const hasSearchStep = parts.some((part) => part.type === "tool-web_search")

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "text") {
          if (!part.text) return null
          return (
            <MessageContent
              key={index}
              markdown
              className="w-full bg-transparent p-0 break-words text-foreground dark:text-white"
            >
              {part.text}
            </MessageContent>
          )
        }

        if (part.type === "tool-web_search") {
          return (
            <WebSearchStep
              key={index}
              part={part}
              fallbackResults={sourceUrls}
            />
          )
        }

        if (part.type === "tool-image_generation") {
          return <ImageGenerationStep key={index} part={part} />
        }

        return null
      })}
      {!hasSearchStep && sourceUrls.length > 0 && (
        <StandaloneSources results={sourceUrls} />
      )}
    </>
  )
}
