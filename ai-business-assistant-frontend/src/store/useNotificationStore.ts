import { create } from "zustand"

import type {
  AppNotification,
  DashboardMetricsResponse,
  LowStockItem,
  NotificationList,
  NotificationType,
  TrendPoint,
} from "@/lib/types"
import { apiFetch } from "@/lib/api"

// Hardcoded demo alert — negative id avoids collision with backend rows.
const DEMO_NOTIFICATION: Omit<AppNotification, "created_at"> = {
  id: -1,
  store_id: null,
  type: "STOCKOUT_RISK",
  message: "Low Stock Alert: Rice at Makati 1 — projected to run out within 2 days.",
  suggested_prompt:
    "Draft a 7-day replenishment plan for Makati 1 focused on the items at risk of running out, starting with Rice.",
  status: "Unread",
}

// ---------------------------------------------------------------------------
// Alert engine thresholds
// ---------------------------------------------------------------------------
const STOCKOUT_DAYS_THRESHOLD = 3        // ≤ this many days → STOCKOUT_RISK
const LOW_INVENTORY_DAYS_THRESHOLD = 5   // ≤ this but > stockout → LOW_INVENTORY
const OVERSTOCK_DAYS_THRESHOLD = 30      // ≥ this → OVERSTOCK
const SALES_SPIKE_PCT = 30               // today > avg by this % → SALES_SPIKE
const SALES_DROP_PCT = -25               // today < avg by this % → SALES_DROP
const DELIVERY_REMINDER_HOUR = 9         // Hour of day to fire delivery reminders

let clientAlertCounter = -100            // Client-side alerts use deeply negative ids

interface NotificationState {
  notifications: AppNotification[]
  unreadCount: number
  /** Transient notifications surfaced as toasts (newly arrived since last poll). */
  toasts: AppNotification[]
  loading: boolean
  /** Highest notification id seen; -1 until the first successful fetch. */
  lastSeenMaxId: number
  /** Keys of client-side alerts already generated this session (de-dupe). */
  firedAlertKeys: Set<string>

  fetchNotifications: () => Promise<void>
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
  scan: () => Promise<number>
  dismissToast: (id: number) => void
  /** Inject the hardcoded demo alert (idempotent) and pop it as a toast. */
  seedDemo: () => void
  /** Begin polling the backend; returns a stop function. */
  startPolling: (intervalMs?: number) => () => void

  /**
   * Client-side telemetry engine — call this after loading metrics + low-stock
   * data on the dashboard. Generates alerts for all 8 categories without a
   * backend round-trip.  Idempotent per key: won't re-fire the same alert
   * within the same session.
   */
  runClientAlertEngine: (params: {
    metrics: DashboardMetricsResponse
    lowStockItems: LowStockItem[]
    trendPoints: TrendPoint[]
    avgMonthlySales: number
  }) => void
}

function makeClientAlert(
  type: NotificationType,
  message: string,
  suggestedPrompt?: string,
  storeId?: number
): AppNotification {
  return {
    id: clientAlertCounter--,
    store_id: storeId ?? null,
    type,
    message,
    suggested_prompt: suggestedPrompt ?? null,
    status: "Unread",
    created_at: new Date().toISOString(),
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  toasts: [],
  loading: false,
  lastSeenMaxId: -1,
  firedAlertKeys: new Set(),

  fetchNotifications: async () => {
    try {
      const data = await apiFetch<NotificationList>("/notifications")
      const prevMax = get().lastSeenMaxId
      const maxId = data.notifications.reduce((m, n) => Math.max(m, n.id), prevMax)

      const fresh =
        prevMax === -1
          ? []
          : data.notifications.filter((n) => n.id > prevMax && n.status === "Unread")

      set((state) => {
        const clientside = state.notifications.filter((n) => n.id < 0)
        const clientUnread = clientside.filter((n) => n.status === "Unread").length
        return {
          notifications: [...clientside, ...data.notifications],
          unreadCount: data.unread_count + clientUnread,
          lastSeenMaxId: maxId,
          toasts: fresh.length ? [...fresh, ...state.toasts].slice(0, 4) : state.toasts,
        }
      })
    } catch {
      // Polling failures are non-fatal — keep the last good state.
    }
  },

  markRead: async (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, status: "Read" } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }))
    if (id > 0) {
      try {
        await apiFetch(`/notifications/${id}/read`, { method: "POST" })
      } catch {
        // Re-sync on the next poll.
      }
    }
  },

  markAllRead: async () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, status: "Read" })),
      unreadCount: 0,
    }))
    try {
      await apiFetch("/notifications/read-all", { method: "POST" })
    } catch {
      // Ignore; next poll reconciles.
    }
  },

  scan: async () => {
    try {
      const res = await apiFetch<{ created: number }>("/notifications/scan", {
        method: "POST",
      })
      await get().fetchNotifications()
      return res.created
    } catch {
      return 0
    }
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  seedDemo: () =>
    set((state) => {
      if (state.notifications.some((n) => n.id === DEMO_NOTIFICATION.id)) return state
      const demo: AppNotification = {
        ...DEMO_NOTIFICATION,
        created_at: new Date().toISOString(),
      }
      return {
        notifications: [demo, ...state.notifications],
        unreadCount: state.unreadCount + 1,
        toasts: [demo, ...state.toasts].slice(0, 4),
      }
    }),

  startPolling: (intervalMs = 15000) => {
    void get().fetchNotifications()
    const handle = setInterval(() => void get().fetchNotifications(), intervalMs)
    return () => clearInterval(handle)
  },

  // ---------------------------------------------------------------------------
  // Client-side alert engine
  // ---------------------------------------------------------------------------
  runClientAlertEngine: ({ metrics, lowStockItems, trendPoints, avgMonthlySales }) => {
    const { firedAlertKeys } = get()
    const newAlerts: AppNotification[] = []

    const fire = (key: string, alert: AppNotification) => {
      if (firedAlertKeys.has(key)) return
      newAlerts.push(alert)
      firedAlertKeys.add(key)
    }

    // 1. STOCKOUT_RISK — items ≤ STOCKOUT_DAYS_THRESHOLD days of cover
    const criticalItems = lowStockItems.filter(
      (r) => r.days_until_stockout <= STOCKOUT_DAYS_THRESHOLD
    )
    if (criticalItems.length > 0) {
      const worst = criticalItems[0]
      fire(
        `STOCKOUT-${worst.store_id}-${worst.sku}`,
        makeClientAlert(
          "STOCKOUT_RISK",
          `Projected stockout: ${worst.item_name ?? worst.sku} at ${worst.store_name} — ${worst.days_until_stockout.toFixed(1)} day(s) remaining.`,
          `Draft an urgent replenishment plan for ${worst.store_name} covering ${worst.item_name ?? worst.sku} first.`,
          worst.store_id
        )
      )
    }

    // 2. LOW_INVENTORY — items between stockout threshold and low-inventory threshold
    const lowItems = lowStockItems.filter(
      (r) =>
        r.days_until_stockout > STOCKOUT_DAYS_THRESHOLD &&
        r.days_until_stockout <= LOW_INVENTORY_DAYS_THRESHOLD
    )
    if (lowItems.length >= 3) {
      fire(
        `LOW_INV-count-${lowItems.length}`,
        makeClientAlert(
          "LOW_INVENTORY",
          `${lowItems.length} SKUs are running low across branches (${LOW_INVENTORY_DAYS_THRESHOLD} days or less of cover). Consider scheduling a mid-week top-up.`,
          `Show me which items have fewer than ${LOW_INVENTORY_DAYS_THRESHOLD} days of cover and draft a topping plan.`
        )
      )
    }

    // 3. OVERSTOCK — items with very high days-of-cover (proxy: stock/velocity > threshold)
    const overstockItems = lowStockItems.filter(
      (r) =>
        r.daily_velocity > 0 &&
        r.current_stock / r.daily_velocity > OVERSTOCK_DAYS_THRESHOLD
    )
    if (overstockItems.length > 0) {
      fire(
        `OVERSTOCK-${overstockItems.length}`,
        makeClientAlert(
          "OVERSTOCK",
          `${overstockItems.length} product(s) are carrying excess stock beyond ${OVERSTOCK_DAYS_THRESHOLD} days of cover. Capital may be tied up unnecessarily.`,
          "Which products have excessive overstock right now?"
        )
      )
    }

    // 4 & 5. SALES_SPIKE / SALES_DROP — today vs recent avg
    if (avgMonthlySales > 0 && metrics.todays_sales > 0) {
      const avgDaily = avgMonthlySales / 30
      if (avgDaily > 0) {
        const changePct = ((metrics.todays_sales - avgDaily) / avgDaily) * 100
        if (changePct >= SALES_SPIKE_PCT) {
          fire(
            `SPIKE-${new Date().toDateString()}`,
            makeClientAlert(
              "SALES_SPIKE",
              `Sales spike detected: today's revenue is ${changePct.toFixed(0)}% above the daily average. Check for promotional activity or unusual demand.`,
              "Summarise today's sales spike and identify which products and stores are driving it."
            )
          )
        } else if (changePct <= SALES_DROP_PCT) {
          fire(
            `DROP-${new Date().toDateString()}`,
            makeClientAlert(
              "SALES_DROP",
              `Sales drop alert: today's revenue is ${Math.abs(changePct).toFixed(0)}% below the daily average. Investigate potential operational issues.`,
              "Why might sales be significantly lower than average today? Check recent cancellations and store activity."
            )
          )
        }
      }
    }

    // 6. FORECAST_RECALC — if low-stock count changes significantly (proxy: many alerts)
    if (metrics.low_stock_alerts > 10) {
      fire(
        `FORECAST-RECALC-${metrics.low_stock_alerts}`,
        makeClientAlert(
          "FORECAST_RECALC",
          `${metrics.low_stock_alerts} SKUs are now below threshold. Demand forecasts have been recalculated — review updated replenishment recommendations.`,
          "Draft a comprehensive replenishment plan for all stores, covering the next 7 days."
        )
      )
    }

    // 7. DELIVERY_REMINDER — suggest morning delivery scheduling
    const hour = new Date().getHours()
    if (hour === DELIVERY_REMINDER_HOUR && metrics.pending_deliveries > 0) {
      fire(
        `DELIVERY-REMIND-${new Date().toDateString()}`,
        makeClientAlert(
          "DELIVERY_REMINDER",
          `Good morning. ${metrics.pending_deliveries} store(s) are due for replenishment today. Now is a good time to confirm the delivery schedule.`,
          `Schedule today's delivery runs for the ${metrics.pending_deliveries} stores that need replenishment.`
        )
      )
    }

    // 8. COMMISSARY_SHORTAGE — if aggregate demand across stores exceeds commissary capacity (proxy)
    const totalUnitsNeeded = lowStockItems.reduce((sum, r) => {
      const cover7 = Math.max(0, r.daily_velocity * 7 - r.current_stock)
      return sum + cover7
    }, 0)
    if (totalUnitsNeeded > 5000) {
      fire(
        `COMMISSARY-${Math.floor(totalUnitsNeeded / 500)}`,
        makeClientAlert(
          "COMMISSARY_SHORTAGE",
          `Projected demand across all stores requires ~${Math.round(totalUnitsNeeded).toLocaleString()} units over the next 7 days. Verify commissary stock levels before confirming delivery plans.`,
          "Check if the commissary has sufficient stock to fulfill all upcoming store replenishments."
        )
      )
    }

    if (newAlerts.length === 0) return

    set((state) => {
      const updatedCount = state.unreadCount + newAlerts.length
      return {
        firedAlertKeys: new Set([...state.firedAlertKeys, ...Array.from(firedAlertKeys)]),
        notifications: [...newAlerts, ...state.notifications],
        unreadCount: updatedCount,
        toasts: [...newAlerts.slice(0, 2), ...state.toasts].slice(0, 4),
      }
    })
  },
}))
