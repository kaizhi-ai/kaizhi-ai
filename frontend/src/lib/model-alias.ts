export function modelAliasFromName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return ""
  const lastSlash = trimmed.lastIndexOf("/")
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}
