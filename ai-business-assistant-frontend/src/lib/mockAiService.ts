// Offline mock AI router — conversational delivery planning engine.
//
// Handles:
//   • Dynamic timescale parsing ("today", "3 days", "until Friday", "15% safety stock")
//   • Store-scoped filtering ("Stores 1, 3, and 5 only")
//   • Mathematical forecasting loop (velocity × days + safety buffer − on-hand)
//   • Mutable plan editing ("Reduce Chicken by 10 for Store 2", "Remove Sisig from Store 3")
//   • Explainable reasoning ("Why?")
//   • Dot-leader text output + editable widget
//
// Swap `runMockAssistant` back to `/chat/message` once the Anthropic key lands.

import type {
  DashboardMetricsResponse,
  DeliveryPlanItem,
  DeliveryPlanPayload,
  LowStockItem,
  LowStockResponse,
  PlanItemReasoning,
  TrendResponse,
  WidgetPayload,
} from "@/lib/types"
import { fetchBlendedRows, fetchPerSource, sumMetrics, type Tagged } from "@/lib/blend"
import { useDataSourceStore } from "@/store/useDataSourceStore"

const THINK_MS = 1400
const DEFAULT_TARGET_DAYS = 7
const DEFAULT_SAFETY_PCT = 10

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
})

export interface MockReply {
  text: string
  widget?: WidgetPayload
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`

function originSuffix(origins: string[]): string {
  if (origins.length === 0) return ""
  if (origins.length > 1) return ` _(blended: ${origins.join(" + ")})_`
  return ` _(source: ${origins[0]})_`
}

// ---------------------------------------------------------------------------
// Timescale parser
// ---------------------------------------------------------------------------

interface DeliveryContext {
  targetDays: number
  safetyStockPct: number
  /** Lower-cased store name fragments to filter on, or null = all stores. */
  storeFilter: string[] | null
}

const DAY_WORDS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 0,
}

function daysUntilWeekday(target: number): number {
  const today = new Date().getDay()
  const diff = (target - today + 7) % 7
  return diff === 0 ? 7 : diff
}

export function parseDeliveryContext(prompt: string): DeliveryContext {
  const lower = prompt.toLowerCase()
  let targetDays = DEFAULT_TARGET_DAYS
  let safetyStockPct = DEFAULT_SAFETY_PCT

  // "today" or "tonight"
  if (/\btoday\b|\btonight\b/.test(lower)) targetDays = 1

  // "X days" / "X-day" / number words
  const dayMatch = lower.match(
    /(\d+)\s*[-\s]?day[s]?|\bsustain\s+for\s+(\d+)|\bcover\s+(\d+)/
  )
  if (dayMatch) {
    targetDays = parseInt(dayMatch[1] ?? dayMatch[2] ?? dayMatch[3], 10)
  }

  // "until <weekday>"
  for (const [day, num] of Object.entries(DAY_WORDS)) {
    if (lower.includes(`until ${day}`)) {
      targetDays = Math.max(1, daysUntilWeekday(num))
      break
    }
  }

  // "this week" → 7, "next week" → 14
  if (/this week/.test(lower)) targetDays = 7
  if (/next week/.test(lower)) targetDays = 14

  // Safety stock: "safety stock to 15%" / "15% buffer" / "safety stock of 20"
  const ssMatch = lower.match(/safety\s+stock\s+(?:to|of|at)?\s*(\d+)\s*%?|(\d+)\s*%\s+(?:safety|buffer)/)
  if (ssMatch) {
    safetyStockPct = parseInt(ssMatch[1] ?? ssMatch[2], 10)
  }

  // Store filter: "Stores 1, 3, and 5" / "Store 2 only" / "for Makati"
  let storeFilter: string[] | null = null
  const storeListMatch = lower.match(/stores?\s+([\w\s,and]+?)(?:\s+only|\s*$|\.)/i)
  if (storeListMatch) {
    const parts = storeListMatch[1]
      .split(/[\s,]+(?:and)?[\s,]*/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (parts.length > 0) storeFilter = parts
  }

  return { targetDays, safetyStockPct, storeFilter }
}

// ---------------------------------------------------------------------------
// Dot-leader formatter (Epic 1 canonical format)
// ---------------------------------------------------------------------------

function dotLeader(label: string, qty: number, width = 46): string {
  const qtyStr = String(qty)
  const dotsNeeded = Math.max(3, width - label.length - qtyStr.length)
  return `${label} ${".".repeat(dotsNeeded)} ${qtyStr}`
}

function formatPlanAsText(items: DeliveryPlanItem[], title: string): string {
  const byStore = new Map<string, DeliveryPlanItem[]>()
  for (const item of items) {
    const list = byStore.get(item.store) ?? []
    list.push(item)
    byStore.set(item.store, list)
  }
  const lines: string[] = [`**${title}**`, ""]
  for (const [store, storeItems] of byStore) {
    lines.push(`**${store}**`)
    for (const item of storeItems) {
      lines.push(`\`${dotLeader(item.product, item.quantity)}\``)
    }
    lines.push("")
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Plan edit command detector
// ---------------------------------------------------------------------------

interface EditCommand {
  type: "adjust" | "remove" | "set"
  store: string
  product: string
  delta?: number
  newQty?: number
}

function detectPlanEdit(prompt: string, plan: DeliveryPlanPayload | null): EditCommand | null {
  if (!plan) return null
  const lower = prompt.toLowerCase()

  // Match: "reduce/decrease/cut X for/at/in Store Y by N" or "increase X ... by N"
  const adjustMatch = lower.match(
    /(reduce|decrease|cut|lower|increase|add|raise|bump)\s+(.+?)\s+(?:for|at|in)\s+(.+?)\s+by\s+(\d+)/
  )
  if (adjustMatch) {
    const direction = /increase|add|raise|bump/.test(adjustMatch[1]) ? 1 : -1
    const product = adjustMatch[2].trim()
    const store = adjustMatch[3].trim()
    const qty = parseInt(adjustMatch[4], 10)

    // Find the closest matching item in the plan
    const matched = plan.items.find(
      (item) =>
        item.product.toLowerCase().includes(product) ||
        item.store.toLowerCase().includes(store)
    )
    if (matched) {
      return {
        type: "adjust",
        store: matched.store,
        product: matched.product,
        delta: direction * qty,
      }
    }
  }

  // Match: "set X for Store Y to N"
  const setMatch = lower.match(/set\s+(.+?)\s+(?:for|at|in)\s+(.+?)\s+to\s+(\d+)/)
  if (setMatch) {
    const product = setMatch[1].trim()
    const store = setMatch[2].trim()
    const newQty = parseInt(setMatch[3], 10)
    const matched = plan.items.find(
      (item) =>
        item.product.toLowerCase().includes(product) ||
        item.store.toLowerCase().includes(store)
    )
    if (matched) {
      return { type: "set", store: matched.store, product: matched.product, newQty }
    }
  }

  // Match: "remove/drop/delete X from/at Store Y"
  const removeMatch = lower.match(/(remove|drop|delete|exclude)\s+(.+?)\s+(?:from|at|in)\s+(.+?)(?:\s|$)/)
  if (removeMatch) {
    const product = removeMatch[2].trim()
    const store = removeMatch[3].trim()
    const matched = plan.items.find(
      (item) =>
        item.product.toLowerCase().includes(product) ||
        item.store.toLowerCase().includes(store)
    )
    if (matched) {
      return { type: "remove", store: matched.store, product: matched.product }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

async function loadLowStock() {
  const sources = useDataSourceStore.getState().getActiveSources()
  const rows = await fetchBlendedRows<LowStockItem>(
    (source) => `/inventory/low-stock?source=${source}`,
    sources,
    (res) => (res as LowStockResponse).items
  )
  return { rows, origins: [...new Set(rows.map((r) => r.origin))] }
}

async function loadMetrics() {
  const sources = useDataSourceStore.getState().getActiveSources()
  const { perOrigin, origins } = await fetchPerSource<DashboardMetricsResponse>(
    (source) => `/analytics/dashboard?source=${source}`,
    sources
  )
  const summed = sumMetrics(perOrigin, ["todays_sales", "low_stock_alerts", "pending_deliveries"])
  return { summed, perOrigin, origins }
}

// ---------------------------------------------------------------------------
// Keyword branches
// ---------------------------------------------------------------------------

async function handleReplenishment(
  prompt: string,
  context: DeliveryContext
): Promise<MockReply> {
  const { rows, origins } = await loadLowStock()

  // Apply store filter if specified
  const filtered =
    context.storeFilter
      ? rows.filter((r) =>
          context.storeFilter!.some((f) =>
            r.store_name.toLowerCase().includes(f)
          )
        )
      : rows

  if (filtered.length === 0) {
    return {
      text: context.storeFilter
        ? `No at-risk SKUs found for the specified stores (${context.storeFilter.join(", ")}). Stock levels look healthy there.`
        : "Good news — no SKUs are below the reorder threshold right now.",
    }
  }

  const safetyMult = 1 + context.safetyStockPct / 100

  const reasoningLog: PlanItemReasoning[] = []
  const items: DeliveryPlanItem[] = filtered.map((r) => {
    const grossRequired = r.daily_velocity * context.targetDays * safetyMult
    const required = Math.max(1, Math.ceil(grossRequired - r.current_stock))
    const id = `${r.origin}-${r.store_id}-${r.sku}`
    reasoningLog.push({
      itemId: id,
      product: r.item_name ?? r.sku,
      store: r.store_name,
      avgDailyVelocity: r.daily_velocity,
      requestedDays: context.targetDays,
      safetyStockPct: context.safetyStockPct,
      currentStock: r.current_stock,
      recommendedQty: required,
    })
    return { id, store: r.store_name, product: r.item_name ?? r.sku, quantity: required }
  })

  const planPayload: DeliveryPlanPayload = {
    kind: "delivery_plan",
    title: `${context.targetDays}-Day Replenishment Plan`,
    items,
    reasoning: reasoningLog,
    targetDays: context.targetDays,
    safetyStockPct: context.safetyStockPct,
  }

  const dotText = formatPlanAsText(items, planPayload.title)
  const intro = [
    `Here is the suggested delivery plan covering **${context.targetDays} day(s)** with a **${context.safetyStockPct}% safety buffer**${originSuffix(origins)}.`,
    `Flagged **${filtered.length}** at-risk SKU(s) across ${new Set(filtered.map((r) => r.store_name)).size} store(s).\n`,
    dotText,
    '\nUse the editable table below to adjust quantities, or say _"Why?"_ to see the math.',
  ]

  return {
    text: intro.join("\n"),
    widget: planPayload,
  }
}

function handlePlanEdit(
  prompt: string,
  activePlan: DeliveryPlanPayload,
  cmd: EditCommand
): MockReply {
  const lower = prompt.toLowerCase()
  let updatedItems: DeliveryPlanItem[]

  if (cmd.type === "remove") {
    updatedItems = activePlan.items.filter(
      (item) => !(item.store === cmd.store && item.product === cmd.product)
    )
  } else if (cmd.type === "set" && cmd.newQty !== undefined) {
    updatedItems = activePlan.items.map((item) =>
      item.store === cmd.store && item.product === cmd.product
        ? { ...item, quantity: Math.max(0, cmd.newQty!) }
        : item
    )
  } else {
    updatedItems = activePlan.items.map((item) =>
      item.store === cmd.store && item.product === cmd.product
        ? { ...item, quantity: Math.max(0, item.quantity + (cmd.delta ?? 0)) }
        : item
    )
  }

  const updatedPlan: DeliveryPlanPayload = { ...activePlan, items: updatedItems }
  const dotText = formatPlanAsText(updatedItems, updatedPlan.title)

  let confirmLine: string
  if (cmd.type === "remove") {
    confirmLine = `Removed **${cmd.product}** from **${cmd.store}**.`
  } else if (cmd.type === "set") {
    confirmLine = `Set **${cmd.product}** for **${cmd.store}** to **${cmd.newQty}** units.`
  } else {
    const direction = (cmd.delta ?? 0) > 0 ? "Increased" : "Reduced"
    const item = updatedItems.find((i) => i.store === cmd.store && i.product === cmd.product)
    confirmLine = `${direction} **${cmd.product}** for **${cmd.store}** by ${Math.abs(cmd.delta ?? 0)} → now **${item?.quantity ?? 0}** units.`
  }

  return {
    text: `${confirmLine}\n\n${dotText}`,
    widget: updatedPlan,
  }
}

function handleWhyReasoning(activePlan: DeliveryPlanPayload | null): MockReply {
  if (!activePlan?.reasoning?.length) {
    return {
      text: "There is no active delivery plan with a reasoning trace yet. Ask me to draft a replenishment plan first, then I can explain the math.",
    }
  }

  const lines = [
    `**Reasoning trace** — ${activePlan.title}`,
    `_(${activePlan.targetDays}-day cover, ${activePlan.safetyStockPct}% safety stock)_`,
    "",
  ]

  for (const r of activePlan.reasoning) {
    const gross = (r.avgDailyVelocity * r.requestedDays * (1 + r.safetyStockPct / 100)).toFixed(1)
    lines.push(
      `**${r.product}** @ ${r.store}`,
      `  Avg daily sales: **${r.avgDailyVelocity.toFixed(1)}** units/day`,
      `  Demand for ${r.requestedDays} days: ${(r.avgDailyVelocity * r.requestedDays).toFixed(1)} + ${r.safetyStockPct}% buffer = **${gross} units**`,
      `  On hand: ${r.currentStock} → **recommend ${r.recommendedQty} units to deliver**`,
      ""
    )
  }

  return { text: lines.join("\n") }
}

async function handleSales(): Promise<MockReply> {
  const [{ summed, origins }, trendRes] = await Promise.all([
    loadMetrics(),
    (async () => {
      const sources = useDataSourceStore.getState().getActiveSources()
      const { perOrigin } = await fetchPerSource<TrendResponse>(
        (source) => `/analytics/trends?period=monthly&source=${source}`,
        sources
      )
      return perOrigin
    })(),
  ])

  const series = Object.values(trendRes).sort(
    (a, b) => (b?.points.length ?? 0) - (a?.points.length ?? 0)
  )[0]
  const recent = series?.points.slice(-3) ?? []

  const lines = [
    `**Sales summary**${originSuffix(origins)}`,
    "",
    `• Today's net sales: **${peso.format(summed.todays_sales)}**`,
    `• Low-stock alerts: **${summed.low_stock_alerts}**`,
    `• Stores needing replenishment: **${summed.pending_deliveries}**`,
  ]
  if (recent.length) {
    lines.push("", "**Recent monthly net sales:**")
    for (const p of recent) lines.push(`• ${p.label}: ${peso.format(p.net_sales)}`)
    if (recent.length >= 2) {
      const first = recent[0].net_sales
      const last = recent[recent.length - 1].net_sales
      const pct = first ? ((last - first) / first) * 100 : 0
      lines.push(
        "",
        `Trend: net sales ${pct >= 0 ? "up" : "down"} **${Math.abs(pct).toFixed(1)}%** across the window.`
      )
    }
  }
  return { text: lines.join("\n") }
}

async function handleVelocity(): Promise<MockReply> {
  const { rows, origins } = await loadLowStock()
  if (rows.length === 0) {
    return {
      text: "No SKUs are currently moving fast enough to fall below the reorder threshold — velocity is healthy across the board.",
    }
  }
  const top = [...rows].sort((a, b) => b.daily_velocity - a.daily_velocity).slice(0, 6)
  const lines = [
    `**Sales velocity — fastest movers at risk**${originSuffix(origins)}`,
    "",
    ...top.map(
      (r, i) =>
        `${i + 1}. **${r.item_name ?? r.sku}** @ ${r.store_name} — ` +
        `${r.daily_velocity.toFixed(1)} units/day, ${r.current_stock} on hand ` +
        `(${r.days_until_stockout.toFixed(1)} day(s) of cover)`
    ),
    "",
    "Ask me to _draft a replenishment plan_ to convert these into an order.",
  ]
  return { text: lines.join("\n") }
}

async function handleInventory(): Promise<MockReply> {
  const { rows, origins } = await loadLowStock()
  if (rows.length === 0) {
    return { text: "All stock levels are healthy — nothing is below the reorder threshold." }
  }
  const critical = rows.filter((r) => r.days_until_stockout < 1)
  const byStore = new Map<string, Tagged<LowStockItem>[]>()
  for (const r of rows) {
    const list = byStore.get(r.store_name) ?? []
    list.push(r)
    byStore.set(r.store_name, list)
  }

  const lines = [
    `**Inventory health**${originSuffix(origins)}`,
    "",
    `• **${rows.length}** SKU(s) below threshold, **${critical.length}** critical (< 1 day).`,
    "",
    "**By store:**",
    ...[...byStore.entries()].map(
      ([store, list]) => `• ${store}: ${list.length} item(s) at risk`
    ),
  ]
  return { text: lines.join("\n") }
}

function handleDefault(): MockReply {
  return {
    text: [
      "I'm your operations assistant (demo mode). I read your **active data source** and can help with:",
      "",
      '• **Sales** — _"summarise today\'s sales"_ / sales trend',
      '• **Velocity** — _"which items are selling fastest?"_',
      '• **Inventory** — _"show low-stock / inventory health"_',
      '• **Replenishment** — _"draft a replenishment plan for 3 days"_ / _"sustain Store 2 until Friday"_',
      '• **Edit a plan** — _"Reduce Chicken Meals for Store 1 by 10"_ / _"Remove Sisig from Store 3"_',
      '• **Explain** — _"Why?"_ traces the math behind any recommendation',
    ].join("\n"),
  }
}

function noDataReply(): MockReply {
  return {
    text: [
      "**No active data source.**",
      "",
      "I can't run the analysis because both data switches are off (or no CSV is loaded).",
      "",
      "→ Open **Settings → Data Sync** and enable **Use Database** and/or **Use CSV**, then ask again.",
    ].join("\n"),
  }
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

/**
 * Route a chat submission to the correct handler.
 * `activePlan` is the current mutable delivery plan held in the chat store;
 * it's null until the user requests a plan for the first time this session.
 */
export async function runMockAssistant(
  prompt: string,
  activePlan: DeliveryPlanPayload | null = null
): Promise<MockReply> {
  const lower = prompt.toLowerCase()
  await delay(THINK_MS)

  const sources = useDataSourceStore.getState().getActiveSources()
  if (sources.length === 0) return noDataReply()

  try {
    // 1. "Why?" — explain active plan reasoning (no data fetch needed)
    if (/\bwhy\b|\bexplain\b|\breason\b|\bderivation\b/.test(lower)) {
      return handleWhyReasoning(activePlan)
    }

    // 2. Conversational plan edit — mutates existing plan without re-fetching
    const editCmd = detectPlanEdit(prompt, activePlan)
    if (editCmd && activePlan) {
      return handlePlanEdit(prompt, activePlan, editCmd)
    }

    // 3. Replenishment / delivery plan request
    if (/replenish|reorder|\bplan\b|deliver|sustain|cover|restock/.test(lower)) {
      const context = parseDeliveryContext(prompt)
      return await handleReplenishment(prompt, context)
    }

    // 4. Sales velocity
    if (/velocity|fastest|moving|movers|sell/.test(lower)) return await handleVelocity()

    // 5. Sales / revenue summary
    if (/\bsales\b|revenue|profit|trend|perform/.test(lower)) return await handleSales()

    // 6. Inventory health
    if (/stock|inventory|low|out of/.test(lower)) return await handleInventory()

    return handleDefault()
  } catch {
    return {
      text: "I hit a snag reading the data source. Make sure the backend is running and a source is enabled in Settings, then try again.",
    }
  }
}
