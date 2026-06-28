import { Database, FileSpreadsheet, Layers } from "lucide-react"

import { cn } from "@/lib/utils"
import { useDataSourceStore } from "@/store/useDataSourceStore"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ConnectionStatusBadge } from "@/components/settings/ConnectionStatusBadge"

/**
 * Two independent data-source switches. Either, both, or neither may be on:
 * when both are active the dashboard blends the datasets and tags every value
 * with a [DB] / [CSV] origin badge.
 */
export function SourceToggles() {
  const useDatabase = useDataSourceStore((s) => s.useDatabase)
  const useCsv = useDataSourceStore((s) => s.useCsv)
  const csvLoaded = useDataSourceStore((s) => s.csvLoaded)
  const csvStats = useDataSourceStore((s) => s.csvStats)
  const setUseDatabase = useDataSourceStore((s) => s.setUseDatabase)
  const setUseCsv = useDataSourceStore((s) => s.setUseCsv)

  const bothOn = useDatabase && useCsv && csvLoaded

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Active Data Sources</CardTitle>
        <CardDescription>
          Toggle each source independently. Enable both to blend live database
          and uploaded CSV data side by side.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Use Database */}
        <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Use Database</p>
              <p className="text-xs text-muted-foreground">
                Live POS database (real-time figures)
              </p>
            </div>
            <Switch
              checked={useDatabase}
              onCheckedChange={setUseDatabase}
              aria-label="Use database source"
            />
          </div>
          <ConnectionStatusBadge />
        </div>

        {/* Use CSV */}
        <div className="flex items-center gap-3 rounded-xl border border-border p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <FileSpreadsheet className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Use CSV</p>
            <p className="text-xs text-muted-foreground">
              {csvLoaded
                ? `Uploaded data — ${csvStats?.stores ?? 0} stores, ${
                    csvStats?.items ?? 0
                  } items`
                : "Upload CSV files below to enable this source"}
            </p>
          </div>
          <Switch
            checked={useCsv}
            onCheckedChange={setUseCsv}
            aria-label="Use CSV source"
          />
        </div>

        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
            bothOn
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Layers className="size-3.5" />
          {bothOn
            ? "Blended mode active — values are tagged [DB] / [CSV] by origin."
            : "Enable both switches to blend and tag data by origin."}
        </div>
      </CardContent>
    </Card>
  )
}
