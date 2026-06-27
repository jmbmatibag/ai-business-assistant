import { useState } from "react"
import { HardDrive } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Visual status indicator for the Google Drive sync that feeds historical sales
 * data. The toggle is local/mock state for now — it will bind to the real
 * connection status once the backend is wired up.
 */
export function GoogleDriveSyncStatus() {
  const [isActive, setIsActive] = useState(true)

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Google Drive Sync</CardTitle>
        <CardDescription>
          Historical sales data is pulled from your connected Google Drive folder.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              isActive
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground"
            )}
          >
            <HardDrive className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  isActive ? "bg-success" : "bg-muted-foreground/50"
                )}
              />
              <p className="text-sm font-medium">
                {isActive ? "Active" : "Inactive"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {isActive
                ? "Last synced today at 8:42 AM"
                : "Sync is paused — historical data may be stale"}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant={isActive ? "outline" : "default"}
          size="sm"
          className="self-start"
          onClick={() => setIsActive((v) => !v)}
        >
          {isActive ? "Pause Sync" : "Resume Sync"}
        </Button>
      </CardContent>
    </Card>
  )
}
