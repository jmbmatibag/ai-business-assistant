import { Suspense } from "react"
import { Outlet } from "react-router-dom"

import { Sidebar } from "@/components/layout/Sidebar"

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
  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
