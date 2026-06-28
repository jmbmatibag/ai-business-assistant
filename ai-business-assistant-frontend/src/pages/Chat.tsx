import { useState } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { cn } from "@/lib/utils"
import { ChatWindow } from "@/components/chat/ChatWindow"
import { ChatInput } from "@/components/chat/ChatInput"
import { ChatHistorySidebar } from "@/components/chat/ChatHistorySidebar"

export function Chat() {
  const [historyOpen, setHistoryOpen] = useState(true)

  return (
    <div className="flex h-full">
      {/* Collapsible conversation history */}
      <div
        className={cn(
          "h-full overflow-hidden transition-[width] duration-200",
          historyOpen ? "w-64" : "w-0"
        )}
      >
        <ChatHistorySidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-4">
          <button
            type="button"
            aria-label={historyOpen ? "Hide history" : "Show history"}
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {historyOpen ? (
              <PanelLeftClose className="size-4.5" />
            ) : (
              <PanelLeftOpen className="size-4.5" />
            )}
          </button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">AI Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Ask questions or request actions across your inventory.
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <ChatWindow />
        </div>

        <ChatInput />
      </div>
    </div>
  )
}
