import { AlertTriangle, Banknote, Truck } from "lucide-react"

import { dashboardMetrics } from "@/lib/mockData"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { SalesTrendChart } from "@/components/dashboard/SalesTrendChart"
import { InventoryAlertsTable } from "@/components/dashboard/InventoryAlertsTable"

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
})

export function Dashboard() {
  const { todaysSales, todaysSalesDeltaPct, lowStockAlerts, pendingDeliveries } =
    dashboardMetrics

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Operational overview across all branches.
        </p>
      </header>

      <div className="flex flex-col gap-4 p-6">
        {/* Top-level metrics */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard
            label="Today's Sales"
            value={peso.format(todaysSales)}
            icon={Banknote}
            deltaPct={todaysSalesDeltaPct}
            tone="default"
          />
          <MetricCard
            label="Low Stock Alerts"
            value={String(lowStockAlerts)}
            icon={AlertTriangle}
            caption="Products below safe threshold"
            tone="warning"
          />
          <MetricCard
            label="Pending Deliveries"
            value={String(pendingDeliveries)}
            icon={Truck}
            caption="Awaiting dispatch confirmation"
            tone="info"
          />
        </div>

        {/* Chart + alerts */}
        <SalesTrendChart />
        <InventoryAlertsTable />
      </div>
    </div>
  )
}
