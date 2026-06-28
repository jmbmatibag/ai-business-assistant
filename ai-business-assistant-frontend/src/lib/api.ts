// Thin fetch wrapper for the backend API.
//
// Requests go to a relative `/api/...` path which the Vite dev server proxies
// to the FastAPI backend (see vite.config.ts). The bearer token, when present,
// is attached automatically.

import { useAuthStore } from "@/store/useAuthStore"

export interface ApiError extends Error {
  status: number
  detail?: string
}

function makeError(status: number, detail?: string): ApiError {
  const err = new Error(detail || `Request failed (${status})`) as ApiError
  err.status = status
  err.detail = detail
  return err
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token

  const headers = new Headers(options.headers)
  // Let the browser set the multipart boundary for FormData; only default to
  // JSON for plain string bodies.
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData
  if (!headers.has("Content-Type") && options.body && !isFormData) {
    headers.set("Content-Type", "application/json")
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const res = await fetch(`/api${path}`, { ...options, headers })

  // An expired/invalid token on a protected call: clear auth so the guard
  // bounces the user back to /login.
  if (res.status === 401) {
    useAuthStore.getState().logout()
  }

  if (!res.ok) {
    let detail: string | undefined
    try {
      const data = await res.json()
      detail = typeof data?.detail === "string" ? data.detail : undefined
    } catch {
      // non-JSON error body; fall through with generic message
    }
    throw makeError(res.status, detail)
  }

  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}
