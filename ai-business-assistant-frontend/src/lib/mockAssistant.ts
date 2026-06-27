import type { WidgetPayload } from "@/lib/types"
import { deliveryPlanItems } from "@/lib/mockData"

/**
 * Shape returned by the assistant "backend". This mirrors the structured JSON a
 * real AI endpoint would return: prose text plus an optional generative-UI widget.
 * Swapping in a live backend means replacing `getAssistantResponse` with a fetch
 * that resolves to this same shape — nothing else in the app changes.
 */
export interface AssistantResponse {
  text?: string
  widget?: WidgetPayload
}

function buildDeliveryPlan(): WidgetPayload {
  return {
    kind: "delivery_plan",
    title: "Suggested Delivery Plan — Next 3 Days",
    // Clone so widget edits never mutate the shared seed data.
    items: deliveryPlanItems.map((item) => ({ ...item })),
  }
}

/**
 * Mock assistant. Keyword-routes the reply so the delivery-plan generative widget
 * is easy to trigger during development (e.g. "make a delivery plan").
 */
export function getAssistantResponse(userText: string): AssistantResponse {
  const normalized = userText.toLowerCase()

  const wantsPlan =
    normalized.includes("deliver") ||
    normalized.includes("restock") ||
    normalized.includes("distribut") ||
    normalized.includes("plan")

  if (wantsPlan) {
    return {
      text: "Based on current stock levels and the last 7 days of sales velocity, here's a suggested delivery plan. Adjust any quantities below before confirming.",
      widget: buildDeliveryPlan(),
    }
  }

  if (normalized.includes("low stock") || normalized.includes("out of stock")) {
    return {
      text: "3 products are projected to run out within 48 hours: Bottled Water 500ml (Makati), Canned Tuna 155g (Quezon City), and Instant Noodles (Pasig). Ask me to draft a delivery plan and I'll propose quantities.",
    }
  }

  return {
    text: "I'm your inventory assistant. I can summarize sales trends, flag low-stock items, and draft delivery plans. Try asking me to \"make a delivery plan\".",
  }
}
