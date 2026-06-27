import { Bot, Database } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LoyverseUploadZone } from "@/components/settings/LoyverseUploadZone"
import { GoogleDriveSyncStatus } from "@/components/settings/GoogleDriveSyncStatus"
import { AIConfigPanel } from "@/components/settings/AIConfigPanel"

export function Settings() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage how data flows into your assistant and how it behaves.
        </p>
      </header>

      <div className="p-6">
        <Tabs defaultValue="data-sync">
          <TabsList>
            <TabsTrigger value="data-sync">
              <Database />
              Data Sync
            </TabsTrigger>
            <TabsTrigger value="ai-config">
              <Bot />
              AI Configuration
            </TabsTrigger>
          </TabsList>

          {/* Data Sync */}
          <TabsContent value="data-sync" className="mt-2">
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
          </TabsContent>

          {/* AI Configuration */}
          <TabsContent value="ai-config" className="mt-2">
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  AI Configuration
                </h2>
                <p className="text-sm text-muted-foreground">
                  Fine-tune the assistant's model and operational parameters.
                </p>
              </div>

              <div className="max-w-5xl">
                <AIConfigPanel />
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
