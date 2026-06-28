import { useEffect, useState } from "react"
import { Bot, ClipboardX, User } from "lucide-react"

import type { DeliveryLogEntry } from "@/lib/types"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return "just now"
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

async function fetchDeliveryLog(): Promise<DeliveryLogEntry[]> {
  try {
    const res = await apiFetch<{ entries: DeliveryLogEntry[] }>("/deliveries/history?limit=8")
    return res.entries ?? []
  } catch {
    return []
  }
}

export function DeliveryHistoryLog() {
  const [entries, setEntries] = useState<DeliveryLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchDeliveryLog()
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery History</CardTitle>
        <CardDescription>Recent confirmed delivery runs across all branches</CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          </div>
        ) : entries.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
              <ClipboardX className="size-5 text-muted-foreground" />
            </span>
            <p className="text-sm font-medium text-foreground">No delivery history yet</p>
            <p className="max-w-[200px] text-xs text-muted-foreground">
              Confirmed delivery runs will appear here once plans are executed.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-6 py-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    entry.initiated_by === "ai"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                  title={entry.initiated_by === "ai" ? "AI-generated plan" : "Manual plan"}
                >
                  {entry.initiated_by === "ai" ? (
                    <Bot className="size-4" />
                  ) : (
                    <User className="size-4" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.store_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.items_count} items · {entry.total_units.toLocaleString()} units
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      entry.initiated_by === "ai"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {entry.initiated_by === "ai" ? "AI" : "Manual"}
                  </span>
                  <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(entry.delivered_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
