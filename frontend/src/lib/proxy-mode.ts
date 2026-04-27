export const DIRECT_PROXY_URL = "direct"

export function proxyEnabledFromURL(value?: string | null) {
  const normalized = value?.trim().toLowerCase()
  return normalized !== DIRECT_PROXY_URL && normalized !== "none"
}

export function proxyURLFromEnabled(enabled: boolean) {
  return enabled ? "" : DIRECT_PROXY_URL
}

export function proxyStatusKey(value?: string | null) {
  return proxyEnabledFromURL(value) ? "enabled" : "direct"
}

export function proxySummaryKey(
  values: Array<string | null | undefined>,
  fallback?: string | null
) {
  const source = values.length > 0 ? values : [fallback]
  const unique = Array.from(new Set(source.map(proxyStatusKey)))
  if (unique.length === 1) return unique[0]
  return "mixed"
}
