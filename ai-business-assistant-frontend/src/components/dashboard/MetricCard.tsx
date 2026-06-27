import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

interface MetricCardProps {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  /** Optional percentage change vs. the prior period. */
  deltaPct?: number
  /** Optional caption shown beneath the value when no delta is given. */
  caption?: string
  /** Tint accent for the icon chip. */
  tone?: "default" | "warning" | "info"
}

const toneStyles: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "bg-primary/10 text-primary",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  deltaPct,
  caption,
  tone = "default",
}: MetricCardProps) {
  const hasDelta = typeof deltaPct === "number"
  const isPositive = hasDelta && deltaPct! >= 0

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          {hasDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium",
                isPositive ? "text-success" : "text-destructive"
              )}
            >
              {isPositive ? (
                <ArrowUpRight className="size-3.5" />
              ) : (
                <ArrowDownRight className="size-3.5" />
              )}
              {Math.abs(deltaPct!)}%
              <span className="font-normal text-muted-foreground">
                vs. yesterday
              </span>
            </span>
          ) : caption ? (
            <span className="text-xs text-muted-foreground">{caption}</span>
          ) : null}
        </div>

        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            toneStyles[tone]
          )}
        >
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  )
}
