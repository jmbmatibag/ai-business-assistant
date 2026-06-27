import { Minus, Plus, Truck } from "lucide-react"

import type { DeliveryPlanPayload } from "@/lib/types"
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

interface DeliveryPlanWidgetProps {
  messageId: string
  plan: DeliveryPlanPayload
}

/**
 * Generative-UI component rendered inline in the chat feed when an assistant
 * message carries a `delivery_plan` payload. The quantity steppers write back
 * through the chat store so edits persist on the message.
 */
export function DeliveryPlanWidget({ messageId, plan }: DeliveryPlanWidgetProps) {
  const updateQuantity = useChatStore((s) => s.updateDeliveryPlanQuantity)

  const totalUnits = plan.items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <Card className="mt-3 w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Truck className="size-4" />
          </span>
          {plan.title}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-(--card-spacing)">Store</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="pr-(--card-spacing) text-right">
                Quantity
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="pl-(--card-spacing) font-medium">
                  {item.store}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.product}
                </TableCell>
                <TableCell className="pr-(--card-spacing)">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      aria-label={`Decrease ${item.product} for ${item.store}`}
                      disabled={item.quantity <= 0}
                      onClick={() => updateQuantity(messageId, item.id, -10)}
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
                      onClick={() => updateQuantity(messageId, item.id, 10)}
                    >
                      <Plus />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <CardFooter className="justify-between">
        <span className="text-sm text-muted-foreground">
          Total:{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {totalUnits.toLocaleString()}
          </span>{" "}
          units
        </span>
        <Button type="button" size="sm">
          Confirm Plan
        </Button>
      </CardFooter>
    </Card>
  )
}
