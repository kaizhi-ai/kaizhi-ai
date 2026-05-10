import { request } from "./http"

export type AppConfig = {
  public_base_url?: string
}

export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    return (await request<AppConfig | null>("/api/v1/app-config", {
      auth: false,
    })) ?? null
  } catch {
    return null
  }
}
