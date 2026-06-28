import { AlertCircle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import type { DbConnectionStatus } from "@/lib/types"
import { useDataSourceStore } from "@/store/useDataSourceStore"

const STATUS: Record<
  DbConnectionStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  connected: {
    label: "Connected",
    className: "bg-success/10 text-success",
    icon: CheckCircle2,
  },
  error: {
    label: "Disconnected",
    className: "bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  unavailable: {
    label: "Unavailable",
    className: "bg-warning/10 text-warning",
    icon: AlertCircle,
  },
}

/**
 * Compact status pill — just the colored label, no surrounding telemetry box.
 * Used in collapsible section headers where the status must stay visible even
 * when the full panel is collapsed.
 */
export function ConnectionStatusPill({ className }: { className?: string }) {
  const dbStatus = useDataSourceStore((s) => s.dbStatus)
  const dbChecking = useDataSourceStore((s) => s.dbChecking)

  const meta = STATUS[dbStatus]
  const Icon = meta.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        meta.className,
        className
      )}
    >
      {dbChecking ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {meta.label}
    </span>
  )
}

/**
 * Real-time live-POS connection telemetry. Green = connected, red = error
 * (with the raw driver/error string for context), yellow = unavailable.
 */
export function ConnectionStatusBadge() {
  const dbStatus = useDataSourceStore((s) => s.dbStatus)
  const dbError = useDataSourceStore((s) => s.dbError)
  const dbTarget = useDataSourceStore((s) => s.dbTarget)
  const dbChecking = useDataSourceStore((s) => s.dbChecking)
  const checkDbStatus = useDataSourceStore((s) => s.checkDbStatus)

  const meta = STATUS[dbStatus]
  const Icon = meta.icon

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            meta.className
          )}
        >
          {dbChecking ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Icon className="size-3.5" />
          )}
          {meta.label}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {dbTarget ?? "Live POS database"}
        </span>
        <button
          type="button"
          aria-label="Re-check connection"
          onClick={() => void checkDbStatus()}
          className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className={cn("size-3.5", dbChecking && "animate-spin")} />
        </button>
      </div>

      {dbStatus === "error" && dbError && (
        // Raw error string surfaced verbatim so operators can diagnose.
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-destructive/5 px-2.5 py-2 text-[11px] leading-snug text-destructive">
          {dbError}
        </pre>
      )}
      {dbStatus === "unavailable" && dbError && (
        <p className="text-xs text-muted-foreground">{dbError}</p>
      )}
    </div>
  )
}
