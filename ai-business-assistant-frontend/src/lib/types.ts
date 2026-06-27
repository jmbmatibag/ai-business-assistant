// Shared domain types for the AI Business Assistant.
// Kept decoupled from any backend shape so the data layer can be swapped later.

export type ChatRole = "user" | "assistant"

/** A single line in an editable delivery plan. */
export interface DeliveryPlanItem {
  id: string
  store: string
  product: string
  quantity: number
}

/**
 * Generative-UI payload for a delivery plan. The chat feed catches a structured
 * payload like this on a message and renders a custom React widget instead of text.
 */
export interface DeliveryPlanPayload {
  kind: "delivery_plan"
  title: string
  items: DeliveryPlanItem[]
}

/**
 * Discriminated union of all widgets the chat can render inline.
 * Add new `kind`s here as more generative components are introduced.
 */
export type WidgetPayload = DeliveryPlanPayload

/** A message in the conversation. May carry text, a widget, or both. */
export interface ChatMessage {
  id: string
  role: ChatRole
  text?: string
  widget?: WidgetPayload
  createdAt: number
}
