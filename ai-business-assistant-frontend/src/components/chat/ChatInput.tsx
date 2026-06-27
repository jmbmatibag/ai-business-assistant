import { useRef, useState } from "react"
import { ArrowUp } from "lucide-react"

import { useChatStore } from "@/store/useChatStore"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const MAX_TEXTAREA_HEIGHT = 200

export function ChatInput() {
  const [value, setValue] = useState("")
  const sendMessage = useChatStore((s) => s.sendMessage)
  const isResponding = useChatStore((s) => s.isResponding)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }

  const submit = () => {
    if (!value.trim() || isResponding) return
    sendMessage(value)
    setValue("")
    // Reset the textarea height after clearing.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.style.height = "auto"
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="sticky bottom-0 border-t border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <Textarea
            ref={textareaRef}
            value={value}
            rows={1}
            placeholder="Ask about sales, low stock, or request a delivery plan…"
            onChange={(e) => {
              setValue(e.target.value)
              resize()
            }}
            onKeyDown={handleKeyDown}
            className="max-h-[200px] flex-1 resize-none self-center border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <Button
            type="button"
            size="icon"
            aria-label="Send message"
            disabled={!value.trim() || isResponding}
            onClick={submit}
          >
            <ArrowUp />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-center text-xs text-muted-foreground">
          Mock assistant · responses are simulated for development.
        </p>
      </div>
    </div>
  )
}
