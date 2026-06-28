import { cn } from "@/lib/utils"
import type { DataOrigin } from "@/lib/types"

const STYLES: Record<DataOrigin, string> = {
  DB: "bg-primary/10 text-primary",
  CSV: "bg-warning/10 text-warning",
}

/** Small [DB] / [CSV] chip marking the origin of a blended value or row. */
export function OriginBadge({
  origin,
  className,
}: {
  origin: DataOrigin
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide",
        STYLES[origin],
        className
      )}
    >
      {origin}
    </span>
  )
}

/** Render a row of origin chips; nothing when the list is empty. */
export function OriginBadges({
  origins,
  className,
}: {
  origins: DataOrigin[]
  className?: string
}) {
  if (origins.length === 0) return null
  return (
    <span className={cn("inline-flex gap-1", className)}>
      {origins.map((o) => (
        <OriginBadge key={o} origin={o} />
      ))}
    </span>
  )
}
