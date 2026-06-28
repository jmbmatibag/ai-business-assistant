import { MessageSquare, Plus, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { useChatStore } from "@/store/useChatStore"
import { Button } from "@/components/ui/button"

function timeAgo(ms: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (secs < 60) return "just now"
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/** ChatGPT/Claude-style conversation history rail. */
export function ChatHistorySidebar() {
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const newChat = useChatStore((s) => s.newChat)
  const selectSession = useChatStore((s) => s.selectSession)
  const deleteSession = useChatStore((s) => s.deleteSession)

  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="p-3">
        <Button className="w-full justify-start" onClick={newChat}>
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">
          Recent
        </p>
        {ordered.map((s) => {
          const isActive = s.id === activeSessionId
          return (
            <div
              key={s.id}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
              onClick={() => selectSession(s.id)}
            >
              <MessageSquare className="size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium leading-tight">{s.title}</p>
                <p className="text-xs text-muted-foreground/80">
                  {timeAgo(s.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Delete conversation"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteSession(s.id)
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
