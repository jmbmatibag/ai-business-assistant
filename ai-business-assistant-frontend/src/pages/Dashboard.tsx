import { useEffect, useState } from "react"
import { AlertTriangle, Banknote, CalendarDays, TrendingUp, Truck, Package, Target } from "lucide-react"

import type { DashboardMetricsResponse, DataOrigin, TrendPoint, TrendResponse } from "@/lib/types"
import { fetchPerSource, sumMetrics, fetchBlendedRows } from "@/lib/blend"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { TrendCharts } from "@/components/dashboard/TrendCharts"
import { InventoryAlertsTable } from "@/components/dashboard/InventoryAlertsTable"
import { ProductPerformancePanel } from "@/components/dashboard/ProductPerformancePanel"
import { StorePerformanceMatrix } from "@/components/dashboard/StorePerformanceMatrix"
import { RiskGauges } from "@/components/dashboard/RiskGauges"
import { DeliveryHistoryLog } from "@/components/dashboard/DeliveryHistoryLog"
import { EmptyState } from "@/components/dashboard/EmptyState"
import { useDataSourceStore } from "@/store/useDataSourceStore"

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
})

const EMPTY_METRICS: DashboardMetricsResponse = {
  todays_sales: 0,
  todays_sales_delta_pct: 0,
  low_stock_alerts: 0,
  pending_deliveries: 0,
}

function sourceLabel(db: boolean, csv: boolean): string {
  if (db && csv) return "Blended — live database + uploaded CSV"
  if (csv) return "Uploaded CSV data"
  if (db) return "Live POS database"
  return "No active data source"
}

/** Derive weekly and monthly sales totals from the trend series. */
function extractPeriodSales(points: TrendPoint[]): {
  weeklySales: number
  monthlySales: number
} {
  if (points.length === 0) return { weeklySales: 0, monthlySales: 0 }
  // Last point is the current month; sum last 4 as monthly; last 1 divided by ~4.3 as weekly proxy
  const last4 = points.slice(-4)
  const monthlySales = last4.reduce((sum, p) => sum + p.net_sales, 0) / last4.length
  const weeklySales = monthlySales / 4.33
  return { weeklySales, monthlySales }
}

export function Dashboard() {
  const useDatabase = useDataSourceStore((s) => s.useDatabase)
  const useCsv = useDataSourceStore((s) => s.useCsv)
  const csvLoaded = useDataSourceStore((s) => s.csvLoaded)
  const csvVersion = useDataSourceStore((s) => s.csvVersion)
  const getActiveSources = useDataSourceStore((s) => s.getActiveSources)

  const [metrics, setMetrics] = useState<DashboardMetricsResponse>(EMPTY_METRICS)
  const [origins, setOrigins] = useState<DataOrigin[]>([])
  const [loading, setLoading] = useState(true)
  const [weeklySales, setWeeklySales] = useState(0)
  const [monthlySales, setMonthlySales] = useState(0)
  const [forecastAccuracy] = useState(87) // Mock until ML pipeline is wired

  const hasSources = useDatabase || (useCsv && csvLoaded)

  useEffect(() => {
    const sources = getActiveSources()
    if (sources.length === 0) {
      setMetrics(EMPTY_METRICS)
      setOrigins([])
      setLoading(false)
      setWeeklySales(0)
      setMonthlySales(0)
      return
    }
    let cancelled = false
    setLoading(true)

    Promise.all([
      fetchPerSource<DashboardMetricsResponse>(
        (source) => `/analytics/dashboard?source=${source}`,
        sources
      ),
      fetchPerSource<TrendResponse>(
        (source) => `/analytics/trends?period=monthly&source=${source}`,
        sources
      ),
    ])
      .then(([dashRes, trendRes]) => {
        if (cancelled) return

        const summed = sumMetrics(dashRes.perOrigin, [
          "todays_sales",
          "low_stock_alerts",
          "pending_deliveries",
        ])
        const solo = dashRes.origins.length === 1 ? dashRes.perOrigin[dashRes.origins[0]] : null
        setMetrics({
          todays_sales: summed.todays_sales,
          low_stock_alerts: summed.low_stock_alerts,
          pending_deliveries: summed.pending_deliveries,
          todays_sales_delta_pct: solo?.todays_sales_delta_pct ?? 0,
        })
        setOrigins(dashRes.origins)

        // Derive weekly/monthly from trend series
        const allPoints = Object.values(trendRes.perOrigin)
          .flatMap((r) => r?.points ?? [])
        const { weeklySales: w, monthlySales: m } = extractPeriodSales(allPoints)
        setWeeklySales(w)
        setMonthlySales(m)
      })
      .catch(() => {
        if (!cancelled) {
          setMetrics(EMPTY_METRICS)
          setOrigins([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDatabase, useCsv, csvLoaded, csvVersion])

  const blended = origins.length > 1
  const badgeOrigins = blended ? origins : undefined

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Executive Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {sourceLabel(useDatabase, useCsv && csvLoaded)} — comprehensive operational intelligence.
        </p>
      </header>

      {!hasSources ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-5 overflow-y-auto p-5">

          {/* ── Row 1: 6 headline metric cards ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Today's Sales"
              value={loading ? "…" : peso.format(metrics.todays_sales)}
              icon={Banknote}
              deltaPct={blended ? undefined : metrics.todays_sales_delta_pct}
              caption={blended ? "Combined across sources" : undefined}
              tone="default"
              origins={badgeOrigins}
            />
            <MetricCard
              label="Weekly Sales"
              value={loading ? "…" : peso.format(weeklySales)}
              icon={CalendarDays}
              caption="Avg weekly run-rate"
              tone="default"
              origins={badgeOrigins}
            />
            <MetricCard
              label="Monthly Sales"
              value={loading ? "…" : peso.format(monthlySales)}
              icon={TrendingUp}
              caption="Current month avg"
              tone="default"
              origins={badgeOrigins}
            />
            <MetricCard
              label="Low Stock Alerts"
              value={loading ? "…" : String(metrics.low_stock_alerts)}
              icon={AlertTriangle}
              caption="Products below threshold"
              tone="warning"
              origins={badgeOrigins}
            />
            <MetricCard
              label="Pending Deliveries"
              value={loading ? "…" : String(metrics.pending_deliveries)}
              icon={Truck}
              caption="Stores needing restock"
              tone="info"
              origins={badgeOrigins}
            />
            <MetricCard
              label="Forecast Accuracy"
              value={`${forecastAccuracy}%`}
              icon={Target}
              caption="ML prediction accuracy"
              tone={forecastAccuracy >= 85 ? "default" : "warning"}
            />
          </div>

          {/* ── Row 2: Risk Gauges (full width) ── */}
          <RiskGauges />

          {/* ── Row 3: Historical trends + Inventory alerts ── */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TrendCharts />
            <InventoryAlertsTable />
          </div>

          {/* ── Row 4: Product performance + Store matrix + Delivery history ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <ProductPerformancePanel />
            <StorePerformanceMatrix />
            <DeliveryHistoryLog />
          </div>

        </div>
      )}
    </div>
  )
}
