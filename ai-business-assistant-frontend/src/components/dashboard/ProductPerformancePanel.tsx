import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts"

import type { ProductPerformancePoint } from "@/lib/types"
import { fetchPerSource } from "@/lib/blend"
import { useDataSourceStore } from "@/store/useDataSourceStore"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type View = "top" | "slow"

const MOCK_TOP: ProductPerformancePoint[] = [
  { item_name: "Chicken Meal", sku: "CKN-01", total_quantity: 1240, net_sales: 186000, store_count: 3 },
  { item_name: "Rice", sku: "RCE-01", total_quantity: 980, net_sales: 49000, store_count: 3 },
  { item_name: "Wings Meal", sku: "WNG-01", total_quantity: 870, net_sales: 130500, store_count: 3 },
  { item_name: "Sisig", sku: "SSG-01", total_quantity: 640, net_sales: 96000, store_count: 2 },
  { item_name: "Liempo", sku: "LMP-01", total_quantity: 520, net_sales: 78000, store_count: 2 },
]

const MOCK_SLOW: ProductPerformancePoint[] = [
  { item_name: "Bangus Belly", sku: "BNG-02", total_quantity: 34, net_sales: 8160, store_count: 1 },
  { item_name: "Sinigang Mix", sku: "SNG-03", total_quantity: 41, net_sales: 4100, store_count: 2 },
  { item_name: "Buko Juice", sku: "BKJ-01", total_quantity: 55, net_sales: 6600, store_count: 1 },
  { item_name: "Pandan Rice", sku: "PND-01", total_quantity: 62, net_sales: 12400, store_count: 2 },
  { item_name: "Ube Leche", sku: "UBL-01", total_quantity: 74, net_sales: 16280, store_count: 1 },
]

const TOP_COLOR = "var(--primary)"
const SLOW_COLOR = "hsl(var(--warning) / 0.8)"

function ProductTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ProductPerformancePoint }>
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{p.item_name}</p>
      <p className="text-muted-foreground">{p.total_quantity.toLocaleString()} units</p>
      <p className="text-muted-foreground">{p.store_count} store{p.store_count !== 1 ? "s" : ""}</p>
    </div>
  )
}

async function fetchProductPerformance(): Promise<{
  top: ProductPerformancePoint[]
  slow: ProductPerformancePoint[]
}> {
  try {
    const sources = useDataSourceStore.getState().getActiveSources()
    const { perOrigin } = await fetchPerSource<{
      top_sellers: ProductPerformancePoint[]
      slow_movers: ProductPerformancePoint[]
    }>(
      (source) => `/analytics/product-performance?source=${source}`,
      sources
    )
    const first = Object.values(perOrigin)[0]
    if (first) return { top: first.top_sellers, slow: first.slow_movers }
  } catch {
    // Fall through to mock
  }
  return { top: MOCK_TOP, slow: MOCK_SLOW }
}

export function ProductPerformancePanel() {
  const [view, setView] = useState<View>("top")
  const [top, setTop] = useState<ProductPerformancePoint[]>(MOCK_TOP)
  const [slow, setSlow] = useState<ProductPerformancePoint[]>(MOCK_SLOW)
  const [loading, setLoading] = useState(false)

  const useDatabase = useDataSourceStore((s) => s.useDatabase)
  const useCsv = useDataSourceStore((s) => s.useCsv)
  const csvLoaded = useDataSourceStore((s) => s.csvLoaded)

  useEffect(() => {
    setLoading(true)
    fetchProductPerformance()
      .then(({ top: t, slow: s }) => {
        setTop(t)
        setSlow(s)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDatabase, useCsv, csvLoaded])

  const data = view === "top" ? top : slow
  const barColor = view === "top" ? TOP_COLOR : SLOW_COLOR

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Product Performance</CardTitle>
          <CardDescription>
            {view === "top" ? "Top-selling products by volume" : "Slow-moving products at risk of overstock"}
          </CardDescription>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="top">Top Sellers</TabsTrigger>
            <TabsTrigger value="slow">Slow Movers</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="flex h-52 items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          </div>
        ) : (
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                  tickFormatter={(v) => v.toLocaleString()}
                />
                <YAxis
                  type="category"
                  dataKey="item_name"
                  tickLine={false}
                  axisLine={false}
                  width={96}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip content={<ProductTooltip />} cursor={{ fill: "var(--accent)" }} />
                <Bar dataKey="total_quantity" radius={[0, 4, 4, 0]} fill={barColor} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
