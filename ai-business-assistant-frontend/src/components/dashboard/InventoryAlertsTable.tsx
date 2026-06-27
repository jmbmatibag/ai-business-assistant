import { inventoryAlerts, type InventoryAlert } from "@/lib/mockData"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
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

function urgency(days: number): { label: string; className: string } {
  if (days < 1) {
    return {
      label: "Critical",
      className: "bg-destructive/10 text-destructive",
    }
  }
  if (days < 2) {
    return {
      label: "Urgent",
      className: "bg-warning/10 text-warning",
    }
  }
  return {
    label: "Soon",
    className: "bg-info/10 text-info",
  }
}

function formatDays(days: number): string {
  if (days < 1) return "< 1 day"
  return `${days.toFixed(1)} days`
}

export function InventoryAlertsTable() {
  const sorted: InventoryAlert[] = [...inventoryAlerts].sort(
    (a, b) => a.daysUntilStockout - b.daysUntilStockout
  )

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Inventory Alerts</CardTitle>
        <CardDescription>
          Products projected to run out of stock, by urgency
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-(--card-spacing)">Store</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Runs out in</TableHead>
              <TableHead className="pr-(--card-spacing) text-right">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((alert) => {
              const status = urgency(alert.daysUntilStockout)
              return (
                <TableRow key={alert.id}>
                  <TableCell className="pl-(--card-spacing) font-medium">
                    {alert.store}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {alert.product}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {alert.currentStock}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDays(alert.daysUntilStockout)}
                  </TableCell>
                  <TableCell className="pr-(--card-spacing) text-right">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        status.className
                      )}
                    >
                      {status.label}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
