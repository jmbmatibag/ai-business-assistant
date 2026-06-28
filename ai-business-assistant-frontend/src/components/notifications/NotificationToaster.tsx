import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CalendarClock,
  PackageCheck,
  PackageX,
  RefreshCw,
  Sparkles,
  Warehouse,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { AppNotification, NotificationType } from "@/lib/types"
import { NOTIFICATION_META } from "@/lib/types"
import { useNotificationStore } from "@/store/useNotificationStore"
import { useChatStore } from "@/store/useChatStore"

const TOAST_TTL_MS = 8000

// ---------------------------------------------------------------------------
// Icon + tone map (mirrors NotificationBell)
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

const ICON_TONE: Record<"warning" | "danger" | "info" | "neutral", string> = {
  danger:  "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  info:    "bg-info/10 text-info",
  neutral: "bg-muted text-muted-foreground",
}

const BORDER_TONE: Record<"warning" | "danger" | "info" | "neutral", string> = {
  danger:  "border-destructive/30",
  warning: "border-warning/30",
  info:    "border-info/30",
  neutral: "border-border",
}

function alertMeta(type: string) {
  const known = NOTIFICATION_META[type as NotificationType]
  return known ?? { label: type, tone: "neutral" as const }
}

// ---------------------------------------------------------------------------
// Individual toast
// ---------------------------------------------------------------------------

function Toast({ notification }: { notification: AppNotification }) {
  const dismissToast = useNotificationStore((s) => s.dismissToast)
  const markRead = useNotificationStore((s) => s.markRead)
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt)
  const navigate = useNavigate()

  const meta = alertMeta(notification.type)
  const Icon = TYPE_ICONS[notification.type as NotificationType] ?? AlertTriangle

  useEffect(() => {
    const handle = setTimeout(() => dismissToast(notification.id), TOAST_TTL_MS)
    return () => clearTimeout(handle)
  }, [notification.id, dismissToast])

  function suggestPlan() {
    if (notification.suggested_prompt) setPendingPrompt(notification.suggested_prompt)
    void markRead(notification.id)
    dismissToast(notification.id)
    navigate("/assistant")
  }

  return (
    <div
      className={cn(
        "pointer-events-auto w-80 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg",
        BORDER_TONE[meta.tone]
      )}
    >
      <div className="flex items-start gap-2.5 p-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
            ICON_TONE[meta.tone]
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {meta.label}
          </p>
          <p className="mt-0.5 text-sm leading-snug text-foreground">
            {notification.message}
          </p>
          {notification.suggested_prompt && (
            <Button type="button" size="sm" className="mt-2 h-7" onClick={suggestPlan}>
              <Sparkles className="size-3.5" />
              Suggest a Plan
            </Button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismissToast(notification.id)}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toast stack
// ---------------------------------------------------------------------------

export function NotificationToaster() {
  const toasts = useNotificationStore((s) => s.toasts)
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} notification={t} />
      ))}
    </div>
  )
}
