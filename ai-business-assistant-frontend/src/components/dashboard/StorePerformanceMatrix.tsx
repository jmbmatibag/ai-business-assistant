import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"

import type { StoreMetricRow } from "@/lib/types"
import { fetchPerSource } from "@/lib/blend"
import { useDataSourceStore } from "@/store/useDataSourceStore"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
})

const MOCK_STORES: StoreMetricRow[] = [
  { store_id: 1, store_name: "Coterie 1 — Makati",    net_sales: 184500, gross_profit: 55350, quantity: 1240, low_stock_count: 4, days_cover_avg: 2.8 },
  { store_id: 2, store_name: "Coterie 2 — BGC",       net_sales: 162000, gross_profit: 48600, quantity: 980,  low_stock_count: 1, days_cover_avg: 5.2 },
  { store_id: 3, store_name: "Coterie 3 — Ortigas",   net_sales: 141200, gross_profit: 42360, quantity: 870,  low_stock_count: 6, days_cover_avg: 1.9 },
  { store_id: 4, store_name: "Coterie 4 — QC",        net_sales: 119800, gross_profit: 35940, quantity: 760,  low_stock_count: 2, days_cover_avg: 4.1 },
  { store_id: 5, store_name: "Coterie 5 — Pasig",     net_sales:  98400, gross_profit: 29520, quantity: 620,  low_stock_count: 0, days_cover_avg: 7.3 },
]

async function fetchStoreMatrix(): Promise<StoreMetricRow[]> {
  try {
    const sources = useDataSourceStore.getState().getActiveSources()
    const { perOrigin } = await fetchPerSource<{ stores: StoreMetricRow[] }>(
      (source) => `/analytics/store-performance?source=${source}`,
      sources
    )
    const first = Object.values(perOrigin)[0]
    if (first?.stores?.length) return first.stores
  } catch {
    // Fall through to mock
  }
  return MOCK_STORES
}

function CoverBadge({ days }: { days: number }) {
  if (days < 2) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
        <ArrowDown className="size-3" /> {days.toFixed(1)}d
      </span>
    )
  }
  if (days < 4) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
        <Minus className="size-3" /> {days.toFixed(1)}d
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <ArrowUp className="size-3" /> {days.toFixed(1)}d
    </span>
  )
}

export function StorePerformanceMatrix() {
  const [stores, setStores] = useState<StoreMetricRow[]>(MOCK_STORES)
  const [loading, setLoading] = useState(false)

  const useDatabase = useDataSourceStore((s) => s.useDatabase)
  const useCsv = useDataSourceStore((s) => s.useCsv)
  const csvLoaded = useDataSourceStore((s) => s.csvLoaded)

  useEffect(() => {
    setLoading(true)
    fetchStoreMatrix()
      .then(setStores)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDatabase, useCsv, csvLoaded])

  const maxSales = Math.max(...stores.map((s) => s.net_sales), 1)

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Store Performance Matrix</CardTitle>
        <CardDescription>Net sales, profit, and inventory cover per branch</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto px-0">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-6 pb-2 font-medium">Store</th>
                <th className="px-3 pb-2 text-right font-medium">Net Sales</th>
                <th className="px-3 pb-2 text-right font-medium">Profit</th>
                <th className="px-3 pb-2 text-center font-medium">Alerts</th>
                <th className="px-6 pb-2 text-center font-medium">Cover</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store, idx) => {
                const barWidth = `${Math.round((store.net_sales / maxSales) * 100)}%`
                return (
                  <tr
                    key={store.store_id}
                    className={cn(
                      "border-b border-border/50 last:border-0",
                      idx % 2 === 0 ? "bg-transparent" : "bg-muted/20"
                    )}
                  >
                    <td className="px-6 py-2.5">
                      <div className="font-medium leading-tight">{store.store_name}</div>
                      {/* Mini progress bar showing relative sales */}
                      <div className="mt-1 h-1 w-full rounded-full bg-muted">
                        <div
                          className="h-1 rounded-full bg-primary/60 transition-all"
                          style={{ width: barWidth }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {peso.format(store.net_sales)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {peso.format(store.gross_profit)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {store.low_stock_count > 0 ? (
                        <span className="inline-flex items-center justify-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                          {store.low_stock_count}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-2.5 text-center">
                      <CoverBadge days={store.days_cover_avg} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
