import { create } from "zustand"
import { persist } from "zustand/middleware"

import { apiFetch, type ApiError } from "@/lib/api"
import type {
  CsvStats,
  DataSourceMode,
  DbConnectionStatus,
  DbStatusResponse,
  EphemeralStatus,
} from "@/lib/types"

interface DataSourceState {
  /** Independent source switches. Both may be ON at once, blending the data. */
  useDatabase: boolean
  useCsv: boolean

  /** Whether the backend currently holds uploaded CSV data for this session. */
  csvLoaded: boolean
  csvStats: CsvStats | null
  isUploading: boolean
  uploadError: string | null
  /** Bumped whenever the ephemeral dataset changes, so views refetch. */
  csvVersion: number

  /** Live POS database connection telemetry. */
  dbStatus: DbConnectionStatus
  dbError: string | null
  dbTarget: string | null
  dbChecking: boolean

  setUseDatabase: (on: boolean) => void
  setUseCsv: (on: boolean) => void
  /** The sources that should actually be read right now (CSV only if loaded). */
  getActiveSources: () => DataSourceMode[]

  uploadCsvFiles: (files: File[]) => Promise<void>
  clearCsv: () => Promise<void>
  /** Ask the backend whether ephemeral CSV data is currently loaded. */
  refreshStatus: () => Promise<void>
  /** Poll the backend for live POS database health. */
  checkDbStatus: () => Promise<void>
}

export const useDataSourceStore = create<DataSourceState>()(
  persist(
    (set, get) => ({
      useDatabase: true,
      useCsv: false,

      csvLoaded: false,
      csvStats: null,
      isUploading: false,
      uploadError: null,
      csvVersion: 0,

      dbStatus: "unavailable",
      dbError: null,
      dbTarget: null,
      dbChecking: false,

      setUseDatabase: (on) => set({ useDatabase: on }),

      setUseCsv: (on) => {
        set({ useCsv: on })
        // Turning CSV on should reflect whatever the backend already holds.
        if (on) void get().refreshStatus()
      },

      getActiveSources: () => {
        const { useDatabase, useCsv, csvLoaded } = get()
        const sources: DataSourceMode[] = []
        if (useDatabase) sources.push("database")
        if (useCsv && csvLoaded) sources.push("csv")
        return sources
      },

      uploadCsvFiles: async (files) => {
        if (files.length === 0 || get().isUploading) return
        set({ isUploading: true, uploadError: null })

        const form = new FormData()
        for (const file of files) form.append("files", file)

        try {
          const stats = await apiFetch<EphemeralStatus>("/data/upload-ephemeral", {
            method: "POST",
            body: form,
          })
          set((s) => ({
            csvLoaded: true,
            csvStats: {
              stores: stats.stores,
              receipts: stats.receipts,
              items: stats.items,
              files: stats.files,
            },
            isUploading: false,
            // A successful upload implies the operator wants to see CSV data.
            useCsv: true,
            csvVersion: s.csvVersion + 1,
          }))
        } catch (err) {
          set({
            isUploading: false,
            uploadError:
              (err as ApiError)?.detail ||
              "Upload failed. Check the file format and try again.",
          })
        }
      },

      clearCsv: async () => {
        try {
          await apiFetch("/data/clear-ephemeral", { method: "POST" })
        } catch {
          // Even if the call fails, reset the local view — the data is ephemeral.
        }
        set((s) => ({
          csvLoaded: false,
          csvStats: null,
          uploadError: null,
          csvVersion: s.csvVersion + 1,
        }))
      },

      refreshStatus: async () => {
        try {
          const status = await apiFetch<EphemeralStatus>("/data/ephemeral-status")
          set({
            csvLoaded: status.loaded,
            csvStats: status.loaded
              ? {
                  stores: status.stores,
                  receipts: status.receipts,
                  items: status.items,
                  files: status.files,
                }
              : null,
          })
        } catch {
          set({ csvLoaded: false, csvStats: null })
        }
      },

      checkDbStatus: async () => {
        set({ dbChecking: true })
        try {
          const res = await apiFetch<DbStatusResponse>("/data-sources/status")
          set({
            dbStatus: res.status,
            dbError: res.detail,
            dbTarget: res.target,
            dbChecking: false,
          })
        } catch (err) {
          set({
            dbStatus: "unavailable",
            dbError:
              (err as ApiError)?.detail ||
              "Backend unreachable — cannot verify the database connection.",
            dbTarget: null,
            dbChecking: false,
          })
        }
      },
    }),
    {
      name: "aiba-data-source",
      // Only the operator's switch preferences should survive a refresh; the
      // CSV/telemetry state is always re-derived from the backend on load.
      partialize: (s) => ({ useDatabase: s.useDatabase, useCsv: s.useCsv }),
    }
  )
)
