import { Link } from "react-router-dom"
import { DatabaseZap, Settings2, UploadCloud } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * Elegant fallback shown when no data source is active (or active sources
 * returned nothing) — prompts the operator to connect a database or drop a CSV.
 */
export function EmptyState({
  title = "No Data Available",
  description = "No active data source is returning data. Connect your live POS database or upload a CSV export to populate this view.",
  className,
}: {
  title?: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center",
        className
      )}
    >
      <span className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <DatabaseZap className="size-8" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link to="/settings">
            <Settings2 className="size-4" />
            Configure sources
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/settings">
            <UploadCloud className="size-4" />
            Upload CSV
          </Link>
        </Button>
      </div>
    </div>
  )
}
