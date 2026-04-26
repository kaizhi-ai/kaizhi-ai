import type { UIMessage } from "ai"
import { Globe } from "lucide-react"

import { Loader } from "@/components/ui/loader"
import { MessageContent } from "@/components/ui/message"
import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/ui/steps"

type WebSearchPart = {
  type: "tool-web_search" | "tool-google_search"
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied"
  input?: unknown
  output?: unknown
  errorText?: string
}

type NormalizedResult = { url: string; title?: string | null }
type SourceUrlPart = { type: "source-url"; url: string; title?: string }

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

  const output = asRecord(part.output)
  const action = asRecord(output?.action)
  if (typeof action?.query === "string") return action.query
  return ""
}

function collectSourceUrls(parts: UIMessage["parts"]): NormalizedResult[] {
  const seen = new Set<string>()
  const out: NormalizedResult[] = []
  for (const part of parts) {
    if (part.type !== "source-url") continue
    const source = part as SourceUrlPart
    if (!source.url || seen.has(source.url)) continue
    seen.add(source.url)
    out.push({ url: source.url, title: source.title ?? null })
  }
  return out
}

function WebSearchStep({
  part,
  fallbackResults,
}: {
  part: WebSearchPart
  fallbackResults: NormalizedResult[]
}) {
  const query = extractQuery(part)
  const parsed =
    part.state === "output-available" ? normalizeResults(part.output) : []
  const results = parsed.length > 0 ? parsed : fallbackResults
  const isDone = part.state === "output-available"
  const isError = part.state === "output-error"
  const isDenied = part.state === "output-denied"
  const isLoading = !isDone && !isError && !isDenied

  const label = isError
    ? "搜索失败"
    : isDenied
      ? "搜索未执行"
      : isDone
        ? query
          ? `已搜索 “${query}” · ${results.length} 个结果`
          : `已搜索 · ${results.length} 个结果`
        : query
          ? `搜索中 “${query}”`
          : "搜索中..."

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
            {part.errorText ?? "未知错误"}
          </StepsItem>
        ) : isDenied ? (
          <StepsItem>未获得搜索结果</StepsItem>
        ) : results.length === 0 ? (
          <StepsItem>{isDone ? "暂无结果" : "等待结果..."}</StepsItem>
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
  return (
    <Steps defaultOpen={false} className="my-1">
      <StepsTrigger leftIcon={<Globe className="size-4" />}>
        {`来源 · ${results.length} 个`}
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

export function AssistantMessageParts({
  parts,
}: {
  parts: UIMessage["parts"]
}) {
  const sourceUrls = collectSourceUrls(parts)
  const hasSearchStep = parts.some(
    (part) =>
      part.type === "tool-web_search" || part.type === "tool-google_search"
  )

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

        if (
          part.type === "tool-web_search" ||
          part.type === "tool-google_search"
        ) {
          return (
            <WebSearchStep
              key={index}
              part={part as unknown as WebSearchPart}
              fallbackResults={sourceUrls}
            />
          )
        }

        return null
      })}
      {!hasSearchStep && sourceUrls.length > 0 && (
        <StandaloneSources results={sourceUrls} />
      )}
    </>
  )
}
