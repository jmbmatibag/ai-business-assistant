import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellRing,
  Bot,
  CalendarClock,
  Check,
  PackageCheck,
  PackageX,
  RefreshCw,
  Sparkles,
  Warehouse,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { AppNotification, NotificationType } from "@/lib/types"
import { NOTIFICATION_META } from "@/lib/types"
import { useNotificationStore } from "@/store/useNotificationStore"
import { useChatStore } from "@/store/useChatStore"

// ---------------------------------------------------------------------------
// Icon + tone map
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<NotificationType, typeof AlertTriangle> = {
  STOCKOUT_RISK:       PackageX,
  LOW_INVENTORY:       AlertTriangle,
  OVERSTOCK:           PackageCheck,
  SALES_SPIKE:         ArrowUpRight,
  SALES_DROP:          ArrowDownRight,
  FORECAST_RECALC:     RefreshCw,
  DELIVERY_REMINDER:   CalendarClock,
  COMMISSARY_SHORTAGE: Warehouse,
  ANOMALY:             Bot,
}

const TONE_CLASSES: Record<"warning" | "danger" | "info" | "neutral", string> = {
  danger:  "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  info:    "bg-info/10 text-info",
  neutral: "bg-muted text-muted-foreground",
}

function alertMeta(type: string) {
  const known = NOTIFICATION_META[type as NotificationType]
  return known ?? { label: type, tone: "neutral" as const }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return "just now"
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const notifications = useNotificationStore((s) => s.notifications)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt)

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function suggestPlan(n: AppNotification) {
    if (n.suggested_prompt) setPendingPrompt(n.suggested_prompt)
    void markRead(n.id)
    setOpen(false)
    navigate("/assistant")
  }

  const hasUrgent = notifications.some(
    (n) =>
      n.status === "Unread" &&
      (n.type === "STOCKOUT_RISK" || n.type === "COMMISSARY_SHORTAGE")
  )

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        {hasUrgent ? (
          <BellRing className="size-4.5 text-destructive" />
        ) : (
          <Bell className="size-4.5" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-50 w-84 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Notifications</p>
              {unreadCount > 0 && (
                <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[28rem] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              notifications.map((n) => {
                const meta = alertMeta(n.type)
                const Icon = TYPE_ICONS[n.type as NotificationType] ?? AlertTriangle
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "border-b border-border/60 px-3 py-3 last:border-0",
                      n.status === "Unread" && "bg-accent/40"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                          TONE_CLASSES[meta.tone]
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {meta.label}
                        </p>
                        <p className="mt-0.5 text-sm leading-snug">{n.message}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {timeAgo(n.created_at)}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          {n.suggested_prompt && (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7"
                              onClick={() => suggestPlan(n)}
                            >
                              <Sparkles className="size-3.5" />
                              Suggest a Plan
                            </Button>
                          )}
                          {n.status === "Unread" && (
                            <button
                              type="button"
                              onClick={() => void markRead(n.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                            >
                              <Check className="size-3.5" />
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
