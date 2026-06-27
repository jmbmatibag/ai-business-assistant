import { ChatWindow } from "@/components/chat/ChatWindow"
import { ChatInput } from "@/components/chat/ChatInput"

export function Chat() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
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
  )
}
