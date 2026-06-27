import { create } from "zustand"

import type { ChatMessage } from "@/lib/types"
import { getAssistantResponse } from "@/lib/mockAssistant"

const SEED_MESSAGE: ChatMessage = {
  id: "seed-welcome",
  role: "assistant",
  text: "Hi! I'm your AI business assistant. I can summarize sales, flag low-stock items, and draft delivery plans. What would you like to do?",
  createdAt: 0,
}

interface ChatState {
  messages: ChatMessage[]
  isResponding: boolean
  /** Append a user message and trigger a mock assistant reply. */
  sendMessage: (text: string) => void
  /** Adjust a quantity inside a rendered delivery-plan widget. */
  updateDeliveryPlanQuantity: (
    messageId: string,
    itemId: string,
    delta: number
  ) => void
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`

export const useChatStore = create<ChatState>((set) => ({
  messages: [SEED_MESSAGE],
  isResponding: false,

  sendMessage: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
    }

    set((state) => ({
      messages: [...state.messages, userMessage],
      isResponding: true,
    }))

    // Simulate backend latency. A real integration would await a fetch here.
    setTimeout(() => {
      const response = getAssistantResponse(trimmed)
      const assistantMessage: ChatMessage = {
        id: newId(),
        role: "assistant",
        text: response.text,
        widget: response.widget,
        createdAt: Date.now(),
      }
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isResponding: false,
      }))
    }, 650)
  },

  updateDeliveryPlanQuantity: (messageId, itemId, delta) => {
    set((state) => ({
      messages: state.messages.map((message) => {
        if (message.id !== messageId || message.widget?.kind !== "delivery_plan") {
          return message
        }
        return {
          ...message,
          widget: {
            ...message.widget,
            items: message.widget.items.map((item) =>
              item.id === itemId
                ? { ...item, quantity: Math.max(0, item.quantity + delta) }
                : item
            ),
          },
        }
      }),
    }))
  },
}))
