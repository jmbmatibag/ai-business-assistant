// Dual-source blending helpers.
//
// When more than one data source is active (Database + CSV), each data view
// fetches every active source in parallel and merges the results, stamping each
// row / metric with the origin it came from so the UI can render [DB] / [CSV]
// badges. A single source that errors (e.g. CSV mode with nothing uploaded)
// contributes nothing rather than failing the whole blend.

import { apiFetch } from "@/lib/api"
import type { DataOrigin, DataSourceMode } from "@/lib/types"
import { originOf } from "@/lib/types"

export type Tagged<T> = T & { origin: DataOrigin }

/**
 * Fetch a list endpoint for each active source and merge the rows, stamping each
 * with its origin.
 *
 * @param buildPath   builds the request path for a given source (append `?source=`)
 * @param sources     the active sources to fetch (from `getActiveSources()`)
 * @param selectRows  pulls the row array out of each source's response
 */
export async function fetchBlendedRows<Row>(
  buildPath: (source: DataSourceMode) => string,
  sources: DataSourceMode[],
  selectRows: (res: unknown) => Row[]
): Promise<Tagged<Row>[]> {
  const perSource = await Promise.all(
    sources.map(async (source) => {
      try {
        const res = await apiFetch<unknown>(buildPath(source))
        const origin = originOf(source)
        return selectRows(res).map((row) => ({ ...row, origin }))
      } catch {
        return [] as Tagged<Row>[]
      }
    })
  )
  return perSource.flat()
}

/**
 * Fetch a scalar-metrics endpoint per source. Returns the payload keyed by
 * origin (absent when that source errored) and the list of origins that
 * actually returned data — used to drive the badges and the merged display.
 */
export async function fetchPerSource<M>(
  buildPath: (source: DataSourceMode) => string,
  sources: DataSourceMode[]
): Promise<{ perOrigin: Partial<Record<DataOrigin, M>>; origins: DataOrigin[] }> {
  const entries = await Promise.all(
    sources.map(async (source) => {
      const origin = originOf(source)
      try {
        return [origin, await apiFetch<M>(buildPath(source))] as const
      } catch {
        return [origin, null] as const
      }
    })
  )

  const perOrigin: Partial<Record<DataOrigin, M>> = {}
  const origins: DataOrigin[] = []
  for (const [origin, res] of entries) {
    if (res !== null) {
      perOrigin[origin] = res
      origins.push(origin)
    }
  }
  return { perOrigin, origins }
}

/** Sum the given numeric keys across every per-origin metrics payload. */
export function sumMetrics<M>(
  perOrigin: Partial<Record<DataOrigin, M>>,
  keys: (keyof M)[]
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of keys) {
    let total = 0
    for (const m of Object.values(perOrigin)) {
      if (m) total += Number((m as Record<string, unknown>)[key as string] ?? 0)
    }
    out[key as string] = total
  }
  return out
}
