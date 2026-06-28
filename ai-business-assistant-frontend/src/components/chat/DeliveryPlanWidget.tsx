import { Minus, Plus, Trash2, Truck, TrendingUp } from "lucide-react"

import type { DeliveryPlanPayload, PlanReasoningPayload } from "@/lib/types"
import { useChatStore } from "@/store/useChatStore"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ---------------------------------------------------------------------------
// Delivery Plan Widget — grouped by store, with inline quantity editing
// ---------------------------------------------------------------------------

interface DeliveryPlanWidgetProps {
  messageId: string
  plan: DeliveryPlanPayload
}

export function DeliveryPlanWidget({ messageId, plan }: DeliveryPlanWidgetProps) {
  const updateQuantity = useChatStore((s) => s.updateDeliveryPlanQuantity)
  const removePlanItem = useChatStore((s) => s.removePlanItem)
  const mutatePlanItem = useChatStore((s) => s.mutatePlanItem)

  // Group items by store for the canonical dot-table layout
  const byStore = new Map<string, typeof plan.items>()
  for (const item of plan.items) {
    const list = byStore.get(item.store) ?? []
    list.push(item)
    byStore.set(item.store, list)
  }

  const totalUnits = plan.items.reduce((sum, item) => sum + item.quantity, 0)
  const storeCount = byStore.size

  return (
    <Card className="mt-3 w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Truck className="size-4" />
          </span>
          {plan.title}
          {plan.targetDays && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {plan.targetDays}-day cover · {plan.safetyStockPct ?? 10}% buffer
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 px-0">
        {[...byStore.entries()].map(([store, items]) => (
          <div key={store}>
            {/* Store header separator */}
            <div className="flex items-center gap-2 border-t border-border/60 px-6 pt-3 pb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {store}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-none">
                  <TableHead className="pl-6 text-xs">Product</TableHead>
                  <TableHead className="pr-6 text-right text-xs">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} className="border-border/40">
                    <TableCell className="pl-6 font-medium">
                      {item.product}
                    </TableCell>
                    <TableCell className="pr-6">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label={`Decrease ${item.product} for ${item.store}`}
                          disabled={item.quantity <= 0}
                          onClick={() => {
                            updateQuantity(messageId, item.id, -1)
                            mutatePlanItem(item.store, item.product, -1)
                          }}
                        >
                          <Minus />
                        </Button>
                        <span className="w-12 text-center text-sm font-semibold tabular-nums">
                          {item.quantity}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label={`Increase ${item.product} for ${item.store}`}
                          onClick={() => {
                            updateQuantity(messageId, item.id, 1)
                            mutatePlanItem(item.store, item.product, 1)
                          }}
                        >
                          <Plus />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove ${item.product} from ${item.store}`}
                          className="ml-1 text-muted-foreground hover:text-destructive"
                          onClick={() => removePlanItem(item.store, item.product)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </CardContent>

      <CardFooter className="justify-between border-t border-border/60 pt-3">
        <span className="text-sm text-muted-foreground">
          {storeCount} store{storeCount !== 1 ? "s" : ""} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {totalUnits.toLocaleString()}
          </span>{" "}
          total units
        </span>
        <Button type="button" size="sm">
          Confirm Plan
        </Button>
      </CardFooter>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Plan Reasoning Widget — traces the "Why?" derivation per item
// ---------------------------------------------------------------------------

interface PlanReasoningWidgetProps {
  payload: PlanReasoningPayload
}

export function PlanReasoningWidget({ payload }: PlanReasoningWidgetProps) {
  return (
    <Card className="mt-3 w-full max-w-2xl border-info/40 bg-info/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-7 items-center justify-center rounded-lg bg-info/15 text-info">
            <TrendingUp className="size-4" />
          </span>
          Forecast Derivation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-6">
        {payload.derivations.map((d) => (
          <div key={d.itemId} className="rounded-lg border border-border/50 p-3 text-sm">
            <p className="font-semibold">
              {d.product}{" "}
              <span className="font-normal text-muted-foreground">@ {d.store}</span>
            </p>
            <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
              <li>
                Avg daily velocity:{" "}
                <span className="font-medium text-foreground">{d.avgDailyVelocity.toFixed(1)} units/day</span>
              </li>
              <li>
                Demand for {d.requestedDays} days:{" "}
                <span className="font-medium text-foreground">
                  {(d.avgDailyVelocity * d.requestedDays).toFixed(1)} units
                </span>
              </li>
              <li>
                + {d.safetyStockPct}% safety buffer:{" "}
                <span className="font-medium text-foreground">
                  {(d.avgDailyVelocity * d.requestedDays * (1 + d.safetyStockPct / 100)).toFixed(1)} gross required
                </span>
              </li>
              <li>
                On-hand deducted:{" "}
                <span className="font-medium text-foreground">{d.currentStock}</span>
              </li>
              <li className="pt-1 font-medium text-foreground">
                → Recommend: <span className="text-primary">{d.recommendedQty} units to deliver</span>
              </li>
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
