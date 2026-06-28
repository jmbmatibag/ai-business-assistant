// Shared domain types for the AI Business Assistant.
// Kept decoupled from any backend shape so the data layer can be swapped later.

export type ChatRole = "user" | "assistant"

/** A single line in an editable delivery plan. */
export interface DeliveryPlanItem {
  id: string
  store: string
  product: string
  quantity: number
}

/** Per-item derivation kept alongside the plan so "Why?" can trace the math. */
export interface PlanItemReasoning {
  itemId: string
  product: string
  store: string
  avgDailyVelocity: number
  requestedDays: number
  safetyStockPct: number
  currentStock: number
  recommendedQty: number
}

/**
 * Generative-UI payload for a delivery plan. The chat feed catches a structured
 * payload like this on a message and renders a custom React widget instead of text.
 */
export interface DeliveryPlanPayload {
  kind: "delivery_plan"
  title: string
  items: DeliveryPlanItem[]
  /** Math trace kept so the assistant can answer "Why?" without re-fetching. */
  reasoning?: PlanItemReasoning[]
  targetDays?: number
  safetyStockPct?: number
}

/** Inline "Why?" explanation widget rendered when the user asks for derivation. */
export interface PlanReasoningPayload {
  kind: "plan_reasoning"
  derivations: PlanItemReasoning[]
}

/**
 * Discriminated union of all widgets the chat can render inline.
 * Add new `kind`s here as more generative components are introduced.
 */
export type WidgetPayload = DeliveryPlanPayload | PlanReasoningPayload

/** A message in the conversation. May carry text, a widget, or both. */
export interface ChatMessage {
  id: string
  role: ChatRole
  text?: string
  widget?: WidgetPayload
  createdAt: number
}

/** A persisted conversation thread shown in the chat history sidebar. */
export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// --- Real-time notifications ---

export type NotificationType =
  | "STOCKOUT_RISK"        // Projected store inventory stockout
  | "LOW_INVENTORY"        // Unusually depressed inventory tier
  | "OVERSTOCK"            // Excessively high overstock condition
  | "SALES_SPIKE"          // Sudden upward spike in transaction velocity
  | "SALES_DROP"           // Drastic unexpected drop in sales volume
  | "FORECAST_RECALC"      // Substantial re-calculation in forecasted demand
  | "DELIVERY_REMINDER"    // Calendar-driven delivery schedule recommendation
  | "COMMISSARY_SHORTAGE"  // Central commissary insufficient stock for transfers
  | "ANOMALY"              // Generic operational anomaly (cancellation spikes etc.)

export type NotificationStatus = "Unread" | "Read"

export interface AppNotification {
  id: number
  store_id: number | null
  type: NotificationType | string
  message: string
  suggested_prompt: string | null
  status: NotificationStatus
  created_at: string
}

/** Icon + colour semantics per alert category. */
export const NOTIFICATION_META: Record<
  NotificationType,
  { label: string; tone: "warning" | "danger" | "info" | "neutral" }
> = {
  STOCKOUT_RISK:       { label: "Stockout Risk",          tone: "danger"  },
  LOW_INVENTORY:       { label: "Low Inventory",           tone: "warning" },
  OVERSTOCK:           { label: "Overstock",               tone: "info"    },
  SALES_SPIKE:         { label: "Sales Spike",             tone: "info"    },
  SALES_DROP:          { label: "Sales Drop",              tone: "warning" },
  FORECAST_RECALC:     { label: "Forecast Update",         tone: "neutral" },
  DELIVERY_REMINDER:   { label: "Delivery Reminder",       tone: "neutral" },
  COMMISSARY_SHORTAGE: { label: "Commissary Shortage",     tone: "danger"  },
  ANOMALY:             { label: "Anomaly Detected",        tone: "warning" },
}

export interface NotificationList {
  unread_count: number
  notifications: AppNotification[]
}

// --- Inventory ---

export interface LowStockItem {
  store_id: number
  store_name: string
  sku: string
  item_name: string | null
  category: string | null
  current_stock: number
  daily_velocity: number
  days_until_stockout: number
}

export interface LowStockResponse {
  reorder_days: number
  count: number
  items: LowStockItem[]
}

// --- Analytics ---

export type TrendPeriod = "monthly" | "quarterly" | "semi-annual" | "annual"

export interface TrendPoint {
  label: string
  net_sales: number
  gross_profit: number
  quantity: number
  cancelled_receipts: number
}

export interface TrendResponse {
  period: TrendPeriod
  points: TrendPoint[]
}

// --- Data source toggle (live POS vs ephemeral CSV) ---

export type DataSourceMode = "database" | "csv"

/** Short origin tag stamped on blended rows / metrics for the [DB]/[CSV] badges. */
export type DataOrigin = "DB" | "CSV"

/** Map an internal source key to its display origin tag. */
export function originOf(source: DataSourceMode): DataOrigin {
  return source === "csv" ? "CSV" : "DB"
}

/** Real-time health of the live POS database connection. */
export type DbConnectionStatus = "connected" | "error" | "unavailable"

/** Response of GET /api/data-sources/status. */
export interface DbStatusResponse {
  status: DbConnectionStatus
  /** Human-readable context; raw driver error string when status is "error". */
  detail: string | null
  /** Name of the active connection ("Built-in database" when none configured). */
  target: string
}

// --- Extended BI Dashboard metrics ---

export interface WeeklySalesResponse {
  week_label: string
  net_sales: number
  gross_profit: number
  quantity: number
}

export interface MonthlySalesResponse {
  month_label: string
  net_sales: number
  gross_profit: number
  quantity: number
}

export interface ProductPerformancePoint {
  item_name: string
  sku: string
  total_quantity: number
  net_sales: number
  store_count: number
}

export interface ProductPerformanceResponse {
  top_sellers: ProductPerformancePoint[]
  slow_movers: ProductPerformancePoint[]
}

export interface StoreMetricRow {
  store_id: number
  store_name: string
  net_sales: number
  gross_profit: number
  quantity: number
  low_stock_count: number
  days_cover_avg: number
}

export interface StorePerformanceResponse {
  stores: StoreMetricRow[]
}

export interface ForecastAccuracyResponse {
  accuracy_pct: number
  total_forecasts: number
  within_10pct: number
}

export interface DeliveryLogEntry {
  id: string
  delivered_at: string
  store_name: string
  items_count: number
  total_units: number
  initiated_by: "ai" | "manual"
}

export interface DeliveryLogResponse {
  entries: DeliveryLogEntry[]
}

export interface RiskGaugeResponse {
  stockout_risk_pct: number
  overstock_risk_pct: number
  at_risk_skus: number
  overstock_skus: number
  healthy_skus: number
}

/** A value carrying the origin(s) it was sourced/merged from. */
export interface Origins {
  origins: DataOrigin[]
}

export interface CsvFileStat {
  filename: string
  rows: number
  skipped: boolean
  reason?: string
}

export interface CsvStats {
  stores: number
  receipts: number
  items: number
  files: CsvFileStat[]
}

/** Response of /data/ephemeral-status and /data/upload-ephemeral. Stat fields
 *  are present only when `loaded` is true. */
export interface EphemeralStatus {
  loaded: boolean
  stores: number
  receipts: number
  items: number
  files: CsvFileStat[]
}

/** Headline dashboard metrics from /analytics/dashboard. */
export interface DashboardMetricsResponse {
  todays_sales: number
  todays_sales_delta_pct: number
  low_stock_alerts: number
  pending_deliveries: number
}

// --- External data-source connections ---

export interface DataSource {
  id: number
  connection_name: string
  db_dialect: string
  db_host: string
  db_port: number
  db_username: string
  db_name: string
  is_active: boolean
  created_at: string
}
