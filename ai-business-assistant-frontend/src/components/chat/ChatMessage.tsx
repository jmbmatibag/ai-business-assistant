import { Bot, User } from "lucide-react"

import type { ChatMessage as ChatMessageType } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DeliveryPlanWidget } from "@/components/chat/DeliveryPlanWidget"

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user"

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback
          className={cn(
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary"
          )}
        >
          {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          "flex min-w-0 flex-col gap-1",
          isUser ? "items-end" : "items-start"
        )}
      >
        {message.text && (
          <div
            className={cn(
              "max-w-prose rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm bg-muted text-foreground"
            )}
          >
            {message.text}
          </div>
        )}

        {/* Generative UI: render a custom component for structured payloads. */}
        {message.widget?.kind === "delivery_plan" && (
          <DeliveryPlanWidget messageId={message.id} plan={message.widget} />
        )}
      </div>
    </div>
  )
}
