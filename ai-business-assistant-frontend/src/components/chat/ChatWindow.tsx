import { useEffect, useRef } from "react"
import { Bot } from "lucide-react"

import { useChatStore } from "@/store/useChatStore"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ChatMessage } from "@/components/chat/ChatMessage"

export function ChatWindow() {
  const messages = useChatStore((s) => s.messages)
  const isResponding = useChatStore((s) => s.isResponding)
  const scrollRootRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the feed to the latest message / typing indicator.
  useEffect(() => {
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
    }
  }, [messages, isResponding])

  return (
    <ScrollArea ref={scrollRootRef} className="h-full">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isResponding && (
          <div className="flex w-full gap-3">
            <Avatar size="sm" className="mt-0.5">
              <AvatarFallback className="bg-primary/10 text-primary">
                <Bot className="size-3.5" />
              </AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
