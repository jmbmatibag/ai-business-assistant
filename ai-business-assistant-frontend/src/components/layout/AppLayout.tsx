import { Suspense, useEffect } from "react"
import { Outlet } from "react-router-dom"

import { cn } from "@/lib/utils"
import { Sidebar } from "@/components/layout/Sidebar"
import { NotificationToaster } from "@/components/notifications/NotificationToaster"
import { useNotificationStore } from "@/store/useNotificationStore"
import { useDataSourceStore } from "@/store/useDataSourceStore"

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <span
        role="status"
        aria-label="Loading"
        className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary"
      />
    </div>
  )
}

export function AppLayout() {
  const startPolling = useNotificationStore((s) => s.startPolling)
  const seedDemo = useNotificationStore((s) => s.seedDemo)
  const checkDbStatus = useDataSourceStore((s) => s.checkDbStatus)
  const refreshStatus = useDataSourceStore((s) => s.refreshStatus)
  const csvActive = useDataSourceStore((s) => s.useCsv && s.csvLoaded)

  // Poll for real-time notifications while the authenticated shell is mounted,
  // and seed the hardcoded demo alert so it pops as a toast on entry.
  useEffect(() => {
    const stop = startPolling()
    seedDemo()
    return stop
  }, [startPolling, seedDemo])

  // Establish data-source telemetry on mount: verify the live DB and re-sync
  // whatever ephemeral CSV the backend is still holding for this session.
  useEffect(() => {
    void checkDbStatus()
    void refreshStatus()
    const handle = setInterval(() => void checkDbStatus(), 20000)
    return () => clearInterval(handle)
  }, [checkDbStatus, refreshStatus])

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main
        className={cn(
          "flex-1 overflow-y-auto transition-shadow",
          // Subtle persistent cue that uploaded CSV data is in the blend.
          csvActive && "shadow-[inset_0_0_0_2px_var(--warning)]"
        )}
      >
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <NotificationToaster />
    </div>
  )
}
