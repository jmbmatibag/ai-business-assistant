import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Maximize2 } from "lucide-react"

import type { DataOrigin, TrendPeriod, TrendPoint, TrendResponse } from "@/lib/types"
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
import { OriginBadges } from "@/components/OriginBadge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
})

const compactPeso = (value: number) => `₱${Math.round(value / 1000)}k`

const PERIODS: { value: TrendPeriod; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi-annual", label: "Semi-Annual" },
  { value: "annual", label: "Annual" },
]

function ChartTooltip({
  active,
  payload,
  valueKey,
}: {
  active?: boolean
  payload?: Array<{ payload: TrendPoint }>
  valueKey: "net_sales" | "gross_profit"
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium text-popover-foreground">{point.label}</p>
      <p className="tabular-nums text-muted-foreground">
        {peso.format(point[valueKey])}
      </p>
    </div>
  )
}

function EmptyOrLoading({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
      {loading ? (
        <span
          role="status"
          aria-label="Loading"
          className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary"
        />
      ) : (
        "No summarized data yet. Run the EOD worker to populate trends."
      )}
    </div>
  )
}

/** Merge per-source trend points into one series, summing aligned labels. */
function mergePoints(
  perOrigin: Partial<Record<DataOrigin, TrendResponse>>,
  origins: DataOrigin[]
): TrendPoint[] {
  const map = new Map<string, TrendPoint>()
  const order: string[] = []
  for (const origin of origins) {
    const resp = perOrigin[origin]
    if (!resp) continue
    for (const p of resp.points) {
      const existing = map.get(p.label)
      if (existing) {
        existing.net_sales += p.net_sales
        existing.gross_profit += p.gross_profit
        existing.quantity += p.quantity
        existing.cancelled_receipts += p.cancelled_receipts
      } else {
        map.set(p.label, { ...p })
        order.push(p.label)
      }
    }
  }
  return order.map((label) => map.get(label)!)
}

/** Shared chart margin used in both the card and the expanded modal. */
const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 }

/** Net sales line chart — rendered in both the card and the modal. */
function NetSalesChart({
  data,
  height,
}: {
  data: TrendPoint[]
  height: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke="var(--muted-foreground)"
          fontSize={12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={44}
          stroke="var(--muted-foreground)"
          fontSize={12}
          tickFormatter={compactPeso}
        />
        <Tooltip
          content={<ChartTooltip valueKey="net_sales" />}
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="net_sales"
          stroke="var(--primary)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Gross profit bar chart — rendered in both the card and the modal. */
function GrossProfitChart({
  data,
  height,
}: {
  data: TrendPoint[]
  height: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke="var(--muted-foreground)"
          fontSize={12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={44}
          stroke="var(--muted-foreground)"
          fontSize={12}
          tickFormatter={compactPeso}
        />
        <Tooltip
          content={<ChartTooltip valueKey="gross_profit" />}
          cursor={{ fill: "var(--accent)" }}
        />
        <Bar dataKey="gross_profit" fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TrendCharts() {
  const [period, setPeriod] = useState<TrendPeriod>("monthly")
  const [points, setPoints] = useState<TrendPoint[]>([])
  const [origins, setOrigins] = useState<DataOrigin[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const useDatabase = useDataSourceStore((s) => s.useDatabase)
  const useCsv = useDataSourceStore((s) => s.useCsv)
  const csvLoaded = useDataSourceStore((s) => s.csvLoaded)
  const csvVersion = useDataSourceStore((s) => s.csvVersion)
  const getActiveSources = useDataSourceStore((s) => s.getActiveSources)

  useEffect(() => {
    const sources = getActiveSources()
    if (sources.length === 0) {
      setPoints([])
      setOrigins([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchPerSource<TrendResponse>(
      (source) => `/analytics/trends?period=${period}&source=${source}`,
      sources
    )
      .then(({ perOrigin, origins }) => {
        if (cancelled) return
        setPoints(mergePoints(perOrigin, origins))
        setOrigins(origins)
      })
      .catch(() => {
        if (!cancelled) {
          setPoints([])
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
  }, [period, useDatabase, useCsv, csvLoaded, csvVersion])

  const hasData = points.length > 0

  /** Period tab strip — reused in both the card header and the modal. */
  const PeriodTabs = (
    <Tabs value={period} onValueChange={(v) => setPeriod(v as TrendPeriod)}>
      <TabsList>
        {PERIODS.map((p) => (
          <TabsTrigger key={p.value} value={p.value}>
            {p.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )

  return (
    <>
      <Card className="flex h-full flex-col">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Operational Performance
              {origins.length > 1 && <OriginBadges origins={origins} />}
            </CardTitle>
            <CardDescription>
              Long-term sales and gross profit trends
            </CardDescription>
          </div>

          {/* Period tabs + expand trigger */}
          <div className="flex items-center gap-2">
            {PeriodTabs}
            <button
              type="button"
              aria-label="Expand chart"
              onClick={() => setExpanded(true)}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="size-4" />
            </button>
          </div>
        </CardHeader>

        <CardContent className="flex-1">
          <div className="grid grid-cols-1 gap-4">
            {/* Net sales — line */}
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">
                Net Sales
              </p>
              {!hasData ? (
                <EmptyOrLoading loading={loading} />
              ) : (
                <div className="h-44 w-full">
                  <NetSalesChart data={points} height={176} />
                </div>
              )}
            </div>

            {/* Gross profit — bar */}
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">
                Gross Profit
              </p>
              {!hasData ? (
                <EmptyOrLoading loading={loading} />
              ) : (
                <div className="h-44 w-full">
                  <GrossProfitChart data={points} height={176} />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Expanded chart modal ── */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex max-h-[92vh] w-full flex-col overflow-y-auto sm:max-w-5xl"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Operational Performance
              {origins.length > 1 && <OriginBadges origins={origins} />}
            </DialogTitle>
            <DialogDescription>
              Long-term sales and gross profit trends — expanded view
            </DialogDescription>
          </DialogHeader>

          {/* Period selector inside the modal */}
          <div className="flex justify-end">{PeriodTabs}</div>

          <div className="grid grid-cols-1 gap-6 pb-2">
            {/* Net sales — expanded */}
            <div>
              <p className="mb-3 text-sm font-semibold text-muted-foreground">
                Net Sales
              </p>
              {!hasData ? (
                <EmptyOrLoading loading={loading} />
              ) : (
                // Use explicit numeric height so Recharts can measure without
                // relying on a percentage-based parent inside the dialog.
                <NetSalesChart data={points} height={260} />
              )}
            </div>

            {/* Gross profit — expanded */}
            <div>
              <p className="mb-3 text-sm font-semibold text-muted-foreground">
                Gross Profit
              </p>
              {!hasData ? (
                <EmptyOrLoading loading={loading} />
              ) : (
                <GrossProfitChart data={points} height={260} />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
