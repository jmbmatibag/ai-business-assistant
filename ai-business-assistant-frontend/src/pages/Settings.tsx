import { LoyverseUploadZone } from "@/components/settings/LoyverseUploadZone"
import { GoogleDriveSyncStatus } from "@/components/settings/GoogleDriveSyncStatus"

export function Settings() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage how data flows into your assistant.
        </p>
      </header>

      <div className="flex flex-col gap-6 p-6">
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Data Sync</h2>
            <p className="text-sm text-muted-foreground">
              Connect your inventory and historical sales sources.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <LoyverseUploadZone />
            <GoogleDriveSyncStatus />
          </div>
        </section>
      </div>
    </div>
  )
}
