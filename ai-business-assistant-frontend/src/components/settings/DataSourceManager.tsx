import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Database, Plus, Trash2, Wifi } from "lucide-react"

import { apiFetch, type ApiError } from "@/lib/api"
import type { DataSource } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ConnectionStatusBadge,
  ConnectionStatusPill,
} from "@/components/settings/ConnectionStatusBadge"

interface FormState {
  connection_name: string
  db_dialect: string
  db_host: string
  db_port: string
  db_username: string
  db_password: string
  db_name: string
}

const EMPTY_FORM: FormState = {
  connection_name: "",
  db_dialect: "postgresql",
  db_host: "",
  db_port: "5432",
  db_username: "",
  db_password: "",
  db_name: "",
}

/**
 * Manage external POS database connections. Replaces the deprecated Google Drive
 * / CSV sync: the app now reads live POS data directly, and operators can point
 * it at a different branch / franchise / migrated database here.
 */
export function DataSourceManager() {
  const [connections, setConnections] = useState<DataSource[]>([])
  // Default open, but the operator can collapse the panel to reclaim space.
  const [open, setOpen] = useState(true)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<number, string>>({})

  async function refresh() {
    try {
      setConnections(await apiFetch<DataSource[]>("/data-sources"))
    } catch {
      // Leave the current list in place on a transient failure.
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAdding(true)
    try {
      await apiFetch("/data-sources", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          db_port: Number(form.db_port) || 5432,
          is_active: true,
        }),
      })
      setForm(EMPTY_FORM)
      await refresh()
    } catch (err) {
      setError((err as ApiError)?.detail || "Failed to save connection.")
    } finally {
      setAdding(false)
    }
  }

  async function activate(id: number) {
    await apiFetch(`/data-sources/${id}/activate`, { method: "POST" })
    await refresh()
  }

  async function remove(id: number) {
    await apiFetch(`/data-sources/${id}`, { method: "DELETE" })
    await refresh()
  }

  async function test(id: number) {
    setTestResult((r) => ({ ...r, [id]: "Testing…" }))
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(
        `/data-sources/${id}/test`,
        { method: "POST" }
      )
      setTestResult((r) => ({
        ...r,
        [id]: res.ok ? "Connected" : `Failed: ${res.message}`,
      }))
    } catch {
      setTestResult((r) => ({ ...r, [id]: "Test request failed" }))
    }
  }

  return (
    <Card className="h-full">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          {/* Clickable header: title + description toggle the panel. The live
              status pill stays visible even when the form is collapsed. */}
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-start gap-3 text-left outline-none">
            <div className="min-w-0 flex-1">
              <CardTitle>POS Data Connections</CardTitle>
              <CardDescription className="mt-1">
                Connect directly to a live POS database. Activate one to make it
                the source for dashboards, alerts, and the assistant.
              </CardDescription>
            </div>
            <ConnectionStatusPill className="mt-0.5 shrink-0" />
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground group-focus-visible:ring-3 group-focus-visible:ring-ring/50">
              {open ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </span>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
          <CardContent className="flex flex-col gap-5">
            {/* Live connection telemetry for the active POS database. */}
            <ConnectionStatusBadge />

        {/* Existing connections */}
        <div className="flex flex-col gap-2">
          {connections.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No external connections. Add one below, or leave empty to use the
              built-in database.
            </p>
          ) : (
            connections.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 p-3"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    c.is_active
                      ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Database className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {c.connection_name}
                    </p>
                    {c.is_active && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.db_dialect}://{c.db_username}@{c.db_host}:{c.db_port}/
                    {c.db_name}
                  </p>
                  {testResult[c.id] && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {testResult[c.id]}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void test(c.id)}
                  >
                    <Wifi className="size-3.5" />
                    Test
                  </Button>
                  {!c.is_active && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void activate(c.id)}
                    >
                      Activate
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Delete connection"
                    onClick={() => void remove(c.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add a connection */}
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm font-medium">Add a connection</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              placeholder="Connection name (e.g. Cavite Branch Live POS)"
              value={form.connection_name}
              onChange={(e) => update("connection_name", e.target.value)}
              required
            />
            <select
              value={form.db_dialect}
              onChange={(e) => update("db_dialect", e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="postgresql">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
            <Input
              placeholder="Host"
              value={form.db_host}
              onChange={(e) => update("db_host", e.target.value)}
              required
            />
            <Input
              placeholder="Port"
              inputMode="numeric"
              value={form.db_port}
              onChange={(e) => update("db_port", e.target.value)}
            />
            <Input
              placeholder="Username"
              value={form.db_username}
              onChange={(e) => update("db_username", e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={form.db_password}
              onChange={(e) => update("db_password", e.target.value)}
              required
            />
            <Input
              placeholder="Database name"
              value={form.db_name}
              onChange={(e) => update("db_name", e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="self-start" disabled={adding}>
            <Plus className="size-4" />
            {adding ? "Saving…" : "Add & Activate"}
          </Button>
        </form>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
