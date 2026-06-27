// Centralized mock data for the AI Business Assistant.
// Everything the UI renders before a real backend exists is sourced from here,
// so the dashboards, charts, and chat widgets can be populated immediately and
// the data layer can be swapped for the POS integration later in one place.

import type { DeliveryPlanItem } from "@/lib/types"

export interface SalesTrendPoint {
  /** Short weekday label used on the X axis. */
  day: string
  /** Human-readable date for tooltips. */
  date: string
  /** Total sales for the day, in PHP. */
  sales: number
}

export interface InventoryAlert {
  id: string
  store: string
  product: string
  currentStock: number
  /** Average units sold per day. */
  dailyVelocity: number
  /** Projected days until the product runs out at current velocity. */
  daysUntilStockout: number
}

export interface DashboardMetrics {
  /** Today's sales in PHP. */
  todaysSales: number
  /** Percentage change vs. yesterday. */
  todaysSalesDeltaPct: number
  lowStockAlerts: number
  pendingDeliveries: number
}

export const dashboardMetrics: DashboardMetrics = {
  todaysSales: 184_520,
  todaysSalesDeltaPct: 12.4,
  lowStockAlerts: 7,
  pendingDeliveries: 3,
}

/** Last 7 days of sales, ending today (2026-06-27). */
export const salesTrend: SalesTrendPoint[] = [
  { day: "Sat", date: "Jun 21", sales: 142_300 },
  { day: "Sun", date: "Jun 22", sales: 168_900 },
  { day: "Mon", date: "Jun 23", sales: 121_450 },
  { day: "Tue", date: "Jun 24", sales: 138_700 },
  { day: "Wed", date: "Jun 25", sales: 156_200 },
  { day: "Thu", date: "Jun 26", sales: 164_180 },
  { day: "Fri", date: "Jun 27", sales: 184_520 },
]

/** Products projected to run out of stock, sorted by urgency. */
export const inventoryAlerts: InventoryAlert[] = [
  { id: "ia-1", store: "Makati Branch", product: "Bottled Water 500ml", currentStock: 24, dailyVelocity: 48, daysUntilStockout: 0.5 },
  { id: "ia-2", store: "Quezon City Branch", product: "Canned Tuna 155g", currentStock: 36, dailyVelocity: 30, daysUntilStockout: 1.2 },
  { id: "ia-3", store: "Pasig Branch", product: "Instant Noodles", currentStock: 90, dailyVelocity: 65, daysUntilStockout: 1.4 },
  { id: "ia-4", store: "Makati Branch", product: "Instant Coffee 3-in-1", currentStock: 52, dailyVelocity: 28, daysUntilStockout: 1.9 },
  { id: "ia-5", store: "Quezon City Branch", product: "Bottled Water 500ml", currentStock: 80, dailyVelocity: 35, daysUntilStockout: 2.3 },
  { id: "ia-6", store: "Pasig Branch", product: "Soft Drinks 1.5L", currentStock: 110, dailyVelocity: 40, daysUntilStockout: 2.8 },
  { id: "ia-7", store: "Makati Branch", product: "Bread Loaf", currentStock: 18, dailyVelocity: 22, daysUntilStockout: 0.8 },
]

/** Seed items for the assistant's suggested delivery plan widget. */
export const deliveryPlanItems: DeliveryPlanItem[] = [
  { id: "dp-1", store: "Makati Branch", product: "Bottled Water 500ml", quantity: 120 },
  { id: "dp-2", store: "Makati Branch", product: "Instant Coffee 3-in-1", quantity: 60 },
  { id: "dp-3", store: "Quezon City Branch", product: "Canned Tuna 155g", quantity: 90 },
  { id: "dp-4", store: "Quezon City Branch", product: "Bottled Water 500ml", quantity: 75 },
  { id: "dp-5", store: "Pasig Branch", product: "Instant Noodles", quantity: 200 },
]
