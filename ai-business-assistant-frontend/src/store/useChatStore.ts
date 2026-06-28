import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { ChatMessage, ChatSession, DeliveryPlanPayload, DeliveryPlanItem } from "@/lib/types"
import { runMockAssistant } from "@/lib/mockAiService"

const WELCOME_TEXT =
  "Hi! I'm your AI business assistant (demo mode). I can summarize sales, flag low-stock items, report sales velocity, and draft replenishment plans from your active data source. What would you like to do?"

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`

function makeSession(): ChatSession {
  const now = Date.now()
  return {
    id: newId(),
    title: "New chat",
    messages: [
      { id: newId(), role: "assistant", text: WELCOME_TEXT, createdAt: now },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

const INITIAL_SESSION = makeSession()

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string | null
  isResponding: boolean
  /** Prompt staged from an external action (e.g. a notification deep link or
   *  the inventory bulk-action bar), read once by the chat input on mount. */
  pendingPrompt: string

  /**
   * The live, mutable delivery plan for the active session.
   * Persists across conversational edits ("Reduce Chicken by 10 for Store 2").
   * Cleared when a new chat session starts.
   */
  activePlan: DeliveryPlanPayload | null

  setPendingPrompt: (prompt: string) => void

  /** Replace the entire active plan (called after a fresh replenishment calc). */
  setActivePlan: (plan: DeliveryPlanPayload | null) => void

  /**
   * Mutate a single item in the active plan by product+store key.
   * delta may be negative (subtract). Quantity floors at 0.
   */
  mutatePlanItem: (store: string, product: string, delta: number) => void

  /** Remove an item from the active plan by product+store key. */
  removePlanItem: (store: string, product: string) => void

  /** Start a fresh conversation (reuses the current one if it's untouched). */
  newChat: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void

  /** Append a user message and request a mock assistant reply. */
  sendMessage: (text: string) => Promise<void>
  updateDeliveryPlanQuantity: (
    messageId: string,
    itemId: string,
    delta: number
  ) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      /** Apply a mutation to the active session, bumping updatedAt. */
      const mutateActive = (
        fn: (s: ChatSession) => ChatSession
      ) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === state.activeSessionId ? { ...fn(s), updatedAt: Date.now() } : s
          ),
        }))

      return {
        sessions: [INITIAL_SESSION],
        activeSessionId: INITIAL_SESSION.id,
        isResponding: false,
        pendingPrompt: "",
        activePlan: null,

        setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),

        setActivePlan: (plan) => set({ activePlan: plan }),

        mutatePlanItem: (store, product, delta) =>
          set((state) => {
            if (!state.activePlan) return state
            const items = state.activePlan.items.map((item): DeliveryPlanItem =>
              item.store === store && item.product === product
                ? { ...item, quantity: Math.max(0, item.quantity + delta) }
                : item
            )
            return { activePlan: { ...state.activePlan, items } }
          }),

        removePlanItem: (store, product) =>
          set((state) => {
            if (!state.activePlan) return state
            const items = state.activePlan.items.filter(
              (item) => !(item.store === store && item.product === product)
            )
            return { activePlan: { ...state.activePlan, items } }
          }),

        newChat: () => {
          const { sessions, activeSessionId } = get()
          const active = sessions.find((s) => s.id === activeSessionId)
          // Don't pile up empty threads — if the current one has no user turn,
          // it already *is* a new chat.
          if (active && !active.messages.some((m) => m.role === "user")) return
          const session = makeSession()
          set((state) => ({
            sessions: [session, ...state.sessions],
            activeSessionId: session.id,
            activePlan: null,
          }))
        },

        selectSession: (id) => set({ activeSessionId: id }),

        deleteSession: (id) =>
          set((state) => {
            const remaining = state.sessions.filter((s) => s.id !== id)
            if (remaining.length === 0) {
              const fresh = makeSession()
              return { sessions: [fresh], activeSessionId: fresh.id }
            }
            const activeSessionId =
              state.activeSessionId === id ? remaining[0].id : state.activeSessionId
            return { sessions: remaining, activeSessionId }
          }),

        sendMessage: async (text) => {
          const trimmed = text.trim()
          if (!trimmed || get().isResponding) return

          // Guarantee there's an active session to write into.
          if (!get().sessions.some((s) => s.id === get().activeSessionId)) {
            const session = makeSession()
            set((state) => ({
              sessions: [session, ...state.sessions],
              activeSessionId: session.id,
            }))
          }

          const userMessage: ChatMessage = {
            id: newId(),
            role: "user",
            text: trimmed,
            createdAt: Date.now(),
          }

          mutateActive((s) => {
            const isFirstUser = !s.messages.some((m) => m.role === "user")
            return {
              ...s,
              title: isFirstUser
                ? trimmed.slice(0, 48) + (trimmed.length > 48 ? "…" : "")
                : s.title,
              messages: [...s.messages, userMessage],
            }
          })
          set({ isResponding: true })

          try {
            const reply = await runMockAssistant(trimmed, get().activePlan)
            // If the reply produced a new/updated plan, promote it to session state.
            if (reply.widget?.kind === "delivery_plan") {
              set({ activePlan: reply.widget })
            }
            const assistantMessage: ChatMessage = {
              id: newId(),
              role: "assistant",
              text: reply.text || undefined,
              widget: reply.widget,
              createdAt: Date.now(),
            }
            mutateActive((s) => ({
              ...s,
              messages: [...s.messages, assistantMessage],
            }))
          } catch {
            const errorMessage: ChatMessage = {
              id: newId(),
              role: "assistant",
              text: "Sorry — something went wrong generating that response. Please try again.",
              createdAt: Date.now(),
            }
            mutateActive((s) => ({
              ...s,
              messages: [...s.messages, errorMessage],
            }))
          } finally {
            set({ isResponding: false })
          }
        },

        updateDeliveryPlanQuantity: (messageId, itemId, delta) => {
          mutateActive((s) => ({
            ...s,
            messages: s.messages.map((message) => {
              if (
                message.id !== messageId ||
                message.widget?.kind !== "delivery_plan"
              ) {
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
      }
    },
    {
      name: "aiba-chat-history",
      partialize: (s) => ({
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
      }),
    }
  )
)

/** Selector: messages of the currently active session (empty if none). */
export function selectActiveMessages(state: ChatState): ChatMessage[] {
  return (
    state.sessions.find((s) => s.id === state.activeSessionId)?.messages ?? []
  )
}
