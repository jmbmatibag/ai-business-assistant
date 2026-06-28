import { useEffect, useState } from "react"
import { Bot, Check, CheckCircle2, KeyRound, Loader2, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch, type ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

interface AISettings {
  id: number
  current_model: string
  base_system_prompt: string
  default_safety_stock: number
  anomaly_threshold: number
  /** Whether an operator-supplied Anthropic API key is stored on the server. */
  anthropic_api_key_set: boolean
}

interface ModelOption {
  id: string
  label: string
}

interface AnthropicTestResult {
  success: boolean
  model: string | null
  error: string | null
}

type SaveState = "idle" | "saving" | "saved" | "error"
type TestState = "idle" | "testing"

export function AIConfigPanel() {
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  // Write-only: the stored key is never sent back, so this stays local until saved.
  const [apiKeyInput, setApiKeyInput] = useState("")
  const [testState, setTestState] = useState<TestState>("idle")
  const [testResult, setTestResult] = useState<AnthropicTestResult | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [s, m] = await Promise.all([
          apiFetch<AISettings>("/ai-settings"),
          apiFetch<ModelOption[]>("/ai-settings/models"),
        ])
        if (!cancelled) {
          setSettings(s)
          setModels(m)
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as ApiError).detail || "Failed to load settings")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Editing a field resets the "saved" badge back to idle.
  function patch<K extends keyof AISettings>(key: K, value: AISettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaveState("idle")
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setSaveState("saving")
    setSaveError(null)
    try {
      const body: Record<string, unknown> = {
        current_model: settings.current_model,
        base_system_prompt: settings.base_system_prompt,
        default_safety_stock: settings.default_safety_stock,
        anomaly_threshold: settings.anomaly_threshold,
      }
      // Only send the key when the operator actually typed one (it's write-only).
      if (apiKeyInput.trim()) body.anthropic_api_key = apiKeyInput.trim()

      const updated = await apiFetch<AISettings>("/ai-settings", {
        method: "PUT",
        body: JSON.stringify(body),
      })
      setSettings(updated)
      setApiKeyInput("")
      setSaveState("saved")
    } catch (err) {
      setSaveState("error")
      setSaveError((err as ApiError).detail || "Failed to save settings")
    }
  }

  async function handleClearKey() {
    setSaveState("saving")
    setSaveError(null)
    try {
      const updated = await apiFetch<AISettings>("/ai-settings", {
        method: "PUT",
        body: JSON.stringify({ anthropic_api_key: "" }),
      })
      setSettings(updated)
      setApiKeyInput("")
      setSaveState("saved")
    } catch (err) {
      setSaveState("error")
      setSaveError((err as ApiError).detail || "Failed to clear key")
    }
  }

  async function handleTest() {
    setTestState("testing")
    setTestResult(null)
    try {
      // Test the typed key if present; otherwise validate the saved/env key.
      const typed = apiKeyInput.trim()
      const result = await apiFetch<AnthropicTestResult>(
        "/ai-settings/test-anthropic",
        {
          method: "POST",
          body: JSON.stringify(typed ? { anthropic_api_key: typed } : {}),
        }
      )
      setTestResult(result)
    } catch (err) {
      setTestResult({
        success: false,
        model: null,
        error: (err as ApiError).detail || "Couldn't reach the server to test the key.",
      })
    } finally {
      setTestState("idle")
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading AI configuration…
        </CardContent>
      </Card>
    )
  }

  if (loadError || !settings) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-destructive">
          {loadError ?? "Settings unavailable."}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="size-4" />
          </div>
          <div>
            <CardTitle>AI Configuration</CardTitle>
            <CardDescription>
              Tune how the assistant reasons over your operational data.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={handleSave}
          className="grid grid-cols-1 gap-5 sm:grid-cols-2"
        >
          {/* Model */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="model" className="text-sm font-medium">
              Model
            </label>
            <select
              id="model"
              value={settings.current_model}
              onChange={(e) => patch("current_model", e.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {/* Preserve a stored value that's no longer in the option list. */}
              {!models.some((m) => m.id === settings.current_model) && (
                <option value={settings.current_model}>{settings.current_model}</option>
              )}
            </select>
            <p className="text-xs text-muted-foreground">
              Which Claude model powers the assistant's responses.
            </p>
          </div>

          {/* Anthropic API key */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="apiKey" className="flex items-center gap-1.5 text-sm font-medium">
              <KeyRound className="size-3.5" />
              Anthropic API key
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value)
                  setSaveState("idle")
                  setTestResult(null)
                }}
                placeholder={
                  settings.anthropic_api_key_set
                    ? "•••••••••••• (a key is saved — type to replace)"
                    : "sk-ant-…"
                }
                className="flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                // Need something to test: either a typed key or a saved/env one.
                disabled={
                  testState === "testing" ||
                  (!apiKeyInput.trim() && !settings.anthropic_api_key_set)
                }
              >
                {testState === "testing" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Testing…
                  </>
                ) : (
                  "Test connection"
                )}
              </Button>
              {settings.anthropic_api_key_set && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleClearKey}
                  disabled={saveState === "saving"}
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Validation result badge */}
            {testResult && (
              <span
                role="status"
                className={cn(
                  "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  testResult.success
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive"
                )}
              >
                {testResult.success ? (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    API Key Valid &amp; Active
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5" />
                    {testResult.error || "Validation failed"}
                  </>
                )}
              </span>
            )}
            <p className="text-xs text-muted-foreground">
              {settings.anthropic_api_key_set ? (
                <span className="text-success">A key is saved.</span>
              ) : (
                "No key saved — the assistant falls back to the server's ANTHROPIC_API_KEY."
              )}{" "}
              Stored encrypted; never displayed after saving. Get one at{" "}
              <span className="font-mono">console.anthropic.com</span>.
            </p>
          </div>

          {/* Base system prompt */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="systemPrompt" className="text-sm font-medium">
              Base system prompt
            </label>
            <Textarea
              id="systemPrompt"
              rows={6}
              value={settings.base_system_prompt}
              onChange={(e) => patch("base_system_prompt", e.target.value)}
              className="resize-y font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              The standing instructions prepended to every conversation.
            </p>
          </div>

          {/* Default safety stock */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="safetyStock" className="text-sm font-medium">
              Default safety stock — {settings.default_safety_stock}%
            </label>
            <div className="flex items-center gap-3">
              <input
                id="safetyStock"
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.default_safety_stock}
                onChange={(e) => patch("default_safety_stock", Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-primary"
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={settings.default_safety_stock}
                onChange={(e) =>
                  patch(
                    "default_safety_stock",
                    Math.max(0, Math.min(100, Number(e.target.value)))
                  )
                }
                className="w-20"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Buffer stock kept above forecasted demand when planning deliveries.
            </p>
          </div>

          {/* Anomaly threshold */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="anomalyThreshold" className="text-sm font-medium">
              Anomaly threshold
            </label>
            <Input
              id="anomalyThreshold"
              type="number"
              min={0}
              value={settings.anomaly_threshold}
              onChange={(e) =>
                patch("anomaly_threshold", Math.max(0, Number(e.target.value)))
              }
              className="w-28"
            />
            <p className="text-xs text-muted-foreground">
              Cancelled transactions (per store, per day) above which the assistant
              flags an operational anomaly.
            </p>
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {saveError}
            </p>
          )}

          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={saveState === "saving"}>
              {saveState === "saving" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            {saveState === "saved" && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Check className="size-4 text-primary" />
                Saved
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
