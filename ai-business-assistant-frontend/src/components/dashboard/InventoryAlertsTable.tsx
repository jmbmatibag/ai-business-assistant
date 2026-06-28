import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Sparkles,
  X,
} from "lucide-react"

import type { LowStockItem, LowStockResponse } from "@/lib/types"
import { cn } from "@/lib/utils"
import { fetchBlendedRows, type Tagged } from "@/lib/blend"
import { useDataSourceStore } from "@/store/useDataSourceStore"
import { useChatStore } from "@/store/useChatStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OriginBadge } from "@/components/OriginBadge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 10

type Row = Tagged<LowStockItem>
type SortKey = "store_name" | "item_name" | "current_stock" | "days_until_stockout"

interface AttrMenu {
  attr: "store" | "status"
  value: string
  x: number
  y: number
}

function urgency(days: number): { label: string; className: string } {
  if (days < 1) return { label: "Critical", className: "bg-destructive/10 text-destructive" }
  if (days < 2) return { label: "Urgent", className: "bg-warning/10 text-warning" }
  return { label: "Soon", className: "bg-info/10 text-info" }
}

function formatDays(days: number): string {
  return days < 1 ? "< 1 day" : `${days.toFixed(1)} days`
}

/** Stable identity for a blended row — mirrors the <TableRow> key. */
function rowKey(alert: Row): string {
  return `${alert.origin}-${alert.store_id}-${alert.sku}`
}

/** Join phrases as a readable English list: "A", "A and B", "A, B, and C". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("")
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
}

/** Construct the combined replenishment prompt from the selected rows. */
function buildReplenishPrompt(rows: Row[]): string {
  const items = joinList(
    rows.map((r) => `${r.item_name ?? r.sku} at ${r.store_name}`)
  )
  return `Please generate a combined replenishment plan for the following low-stock items: ${items}.`
}

/** Checkbox supporting the indeterminate (partial-selection) state. */
function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  "aria-label": string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={onChange}
      className="size-4 cursor-pointer accent-primary align-middle"
    />
  )
}

export function InventoryAlertsTable() {
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [query, setQuery] = useState("")
  const [filterStore, setFilterStore] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "days_until_stockout",
    dir: "asc",
  })
  const [page, setPage] = useState(0)
  // Bulk selection — keyed by stable row identity so it survives pagination.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  // Attribute context menu — opened by clicking a store name or status badge.
  const [attrMenu, setAttrMenu] = useState<AttrMenu | null>(null)

  const navigate = useNavigate()
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt)

  const useDatabase = useDataSourceStore((s) => s.useDatabase)
  const useCsv = useDataSourceStore((s) => s.useCsv)
  const csvLoaded = useDataSourceStore((s) => s.csvLoaded)
  const csvVersion = useDataSourceStore((s) => s.csvVersion)
  const getActiveSources = useDataSourceStore((s) => s.getActiveSources)

  // Close attribute context menu on outside mousedown.
  useEffect(() => {
    if (!attrMenu) return
    function onDown(e: MouseEvent) {
      const menu = document.getElementById("inv-attr-ctx-menu")
      if (!menu || !menu.contains(e.target as Node)) setAttrMenu(null)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [attrMenu])

  useEffect(() => {
    const sources = getActiveSources()
    if (sources.length === 0) {
      setItems([])
      setLoading(false)
      setError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    fetchBlendedRows<LowStockItem>(
      (source) => `/inventory/low-stock?source=${source}`,
      sources,
      (res) => (res as LowStockResponse).items
    )
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDatabase, useCsv, csvLoaded, csvVersion])

  // Show the origin column only when more than one source contributed.
  const showOrigin = useMemo(
    () => new Set(items.map((i) => i.origin)).size > 1,
    [items]
  )

  // All unique store names for the filter dropdown.
  const uniqueStores = useMemo(
    () => [...new Set(items.map((i) => i.store_name))].sort(),
    [items]
  )

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items.filter((i) => {
      if (
        q &&
        ![i.store_name, i.item_name ?? "", i.sku]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
        return false
      if (filterStore && i.store_name !== filterStore) return false
      if (filterStatus && urgency(i.days_until_stockout).label !== filterStatus)
        return false
      return true
    })

    const factor = sort.dir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * factor
    })
  }, [items, query, sort, filterStore, filterStatus])

  // All selected rows across the full dataset (survives filter changes).
  const selectedRows = useMemo(
    () => items.filter((r) => selectedKeys.has(rowKey(r))),
    [items, selectedKeys]
  )

  // Count of selected rows within the current filtered view — drives header checkbox.
  const filteredSelectedCount = useMemo(
    () => filteredSorted.filter((r) => selectedKeys.has(rowKey(r))).length,
    [filteredSorted, selectedKeys]
  )
  const allFilteredSelected =
    filteredSorted.length > 0 && filteredSelectedCount === filteredSorted.length
  const someFilteredSelected =
    filteredSelectedCount > 0 && !allFilteredSelected

  // Drop selections for rows that disappear on refetch / source switch.
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev
      const valid = new Set(items.map(rowKey))
      const next = new Set([...prev].filter((k) => valid.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  function toggleRow(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      // Toggle only the currently-filtered rows; selections elsewhere persist.
      if (allFilteredSelected) {
        filteredSorted.forEach((r) => next.delete(rowKey(r)))
      } else {
        filteredSorted.forEach((r) => next.add(rowKey(r)))
      }
      return next
    })
  }

  /**
   * Select ALL items in the full dataset that match the given attribute value,
   * regardless of current page or active column filters.
   */
  function selectAllByAttr(attr: "store" | "status", value: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      items.forEach((r) => {
        const match =
          attr === "store"
            ? r.store_name === value
            : urgency(r.days_until_stockout).label === value
        if (match) next.add(rowKey(r))
      })
      return next
    })
  }

  /** Select all rows currently passing the active filters (all pages). */
  function selectAllFiltered() {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      filteredSorted.forEach((r) => next.add(rowKey(r)))
      return next
    })
  }

  function openAttrMenu(
    e: React.MouseEvent,
    attr: "store" | "status",
    value: string
  ) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Clamp so the menu never overflows the right edge of the viewport.
    const x = Math.min(rect.left, window.innerWidth - 224)
    setAttrMenu({ attr, value, x, y: rect.bottom + 4 })
  }

  function createReplenishPlan() {
    if (selectedRows.length === 0) return
    setPendingPrompt(buildReplenishPrompt(selectedRows))
    navigate("/assistant")
  }

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filteredSorted.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  )

  // Keep the page in range when the result set shrinks (search / refetch / filter).
  useEffect(() => {
    if (page > pageCount - 1) setPage(0)
  }, [page, pageCount])

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "days_until_stockout" ? "asc" : "asc" }
    )
  }

  const SortableHead = ({
    label,
    sortKey,
    align = "left",
  }: {
    label: string
    sortKey: SortKey
    align?: "left" | "right"
  }) => {
    const active = sort.key === sortKey
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        {active &&
          (sort.dir === "asc" ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          ))}
      </button>
    )
  }

  const hasActiveFilters = filterStore !== "" || filterStatus !== ""

  return (
    <Card className="relative flex h-full flex-col">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Inventory Alerts</CardTitle>
          <CardDescription>
            Products projected to run out of stock, by urgency
          </CardDescription>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search store, product, SKU…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-0">
        {/* ── Column filter bar ── */}
        {!loading && !error && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-(--card-spacing) pb-3">
            <Filter className="size-3.5 shrink-0 text-muted-foreground" />
            {/* Store filter */}
            <select
              value={filterStore}
              onChange={(e) => {
                setFilterStore(e.target.value)
                setPage(0)
              }}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Stores</option>
              {uniqueStores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {/* Status filter */}
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value)
                setPage(0)
              }}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Statuses</option>
              <option value="Critical">Critical</option>
              <option value="Urgent">Urgent</option>
              <option value="Soon">Soon</option>
            </select>
            {/* Select-all-matching + clear — only visible when a filter is active */}
            {hasActiveFilters && (
              <>
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  <CheckSquare className="size-3.5" />
                  Select all {filteredSorted.length} matching
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStore("")
                    setFilterStatus("")
                    setPage(0)
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  <X className="size-3.5" />
                  Clear
                </button>
              </>
            )}
          </div>
        )}

        {loading ? (
          <p className="px-(--card-spacing) py-6 text-sm text-muted-foreground">
            Loading stock levels…
          </p>
        ) : error ? (
          <p className="px-(--card-spacing) py-6 text-sm text-muted-foreground">
            Couldn't load inventory. Check the backend connection.
          </p>
        ) : filteredSorted.length === 0 ? (
          <p className="px-(--card-spacing) py-6 text-sm text-muted-foreground">
            {query || hasActiveFilters
              ? "No alerts match your current filters."
              : "No products are below the reorder threshold right now."}
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-(--card-spacing)">
                    <SelectCheckbox
                      checked={allFilteredSelected}
                      indeterminate={someFilteredSelected}
                      onChange={toggleAll}
                      aria-label="Select all alerts"
                    />
                  </TableHead>
                  <TableHead>
                    <SortableHead label="Store" sortKey="store_name" />
                  </TableHead>
                  <TableHead>
                    <SortableHead label="Product" sortKey="item_name" />
                  </TableHead>
                  {showOrigin && <TableHead>Source</TableHead>}
                  <TableHead className="text-right">
                    <SortableHead label="Stock" sortKey="current_stock" align="right" />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHead
                      label="Runs out in"
                      sortKey="days_until_stockout"
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="pr-(--card-spacing) text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((alert) => {
                  const status = urgency(alert.days_until_stockout)
                  const key = rowKey(alert)
                  const isSelected = selectedKeys.has(key)
                  return (
                    <TableRow key={key} data-state={isSelected ? "selected" : undefined}>
                      <TableCell className="w-10 pl-(--card-spacing)">
                        <SelectCheckbox
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          aria-label={`Select ${alert.item_name ?? alert.sku} at ${alert.store_name}`}
                        />
                      </TableCell>

                      {/* Store cell — clickable to open batch-select context menu */}
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          onClick={(e) => openAttrMenu(e, "store", alert.store_name)}
                          className="group -ml-0.5 flex items-center gap-0.5 rounded px-0.5 text-left transition-colors hover:text-primary"
                        >
                          {alert.store_name}
                          <ChevronDown className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
                        </button>
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        {alert.item_name ?? alert.sku}
                      </TableCell>
                      {showOrigin && (
                        <TableCell>
                          <OriginBadge origin={alert.origin} />
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">
                        {alert.current_stock}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDays(alert.days_until_stockout)}
                      </TableCell>

                      {/* Status badge — clickable to open batch-select context menu */}
                      <TableCell className="pr-(--card-spacing) text-right">
                        <button
                          type="button"
                          onClick={(e) => openAttrMenu(e, "status", status.label)}
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-75",
                            status.className
                          )}
                        >
                          {status.label}
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Pagination — capped at 10 rows per page. */}
            <div className="mt-auto flex items-center justify-between gap-2 px-(--card-spacing) pt-3 text-sm text-muted-foreground">
              <span>
                {filteredSorted.length} alert
                {filteredSorted.length === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums">
                  Page {safePage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* Floating bulk-action bar — only present when rows are selected. */}
      {selectedRows.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1.5 shadow-lg">
            <span className="pl-2 text-sm font-medium tabular-nums">
              {selectedRows.length} selected
            </span>
            <Button type="button" size="sm" className="rounded-full" onClick={createReplenishPlan}>
              <Sparkles className="size-4" />
              Create Replenish Plan
            </Button>
            <button
              type="button"
              aria-label="Clear selection"
              onClick={() => setSelectedKeys(new Set())}
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Attribute context menu — fixed to viewport so it escapes overflow:hidden ── */}
      {attrMenu && (
        <div
          id="inv-attr-ctx-menu"
          role="menu"
          aria-label={`Actions for ${attrMenu.value}`}
          className="fixed z-50 min-w-[210px] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ top: attrMenu.y, left: attrMenu.x }}
        >
          <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {attrMenu.attr === "store" ? "Store" : "Status"}: {attrMenu.value}
          </p>
          <div className="h-px bg-border" />
          {/* Select all matching — scans the full dataset */}
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent"
            onClick={() => {
              selectAllByAttr(attrMenu.attr, attrMenu.value)
              setAttrMenu(null)
            }}
          >
            <CheckSquare className="size-3.5 shrink-0 text-primary" />
            Select all &ldquo;{attrMenu.value}&rdquo;
          </button>
          {/* Filter to — narrows the visible rows */}
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {
              if (attrMenu.attr === "store") {
                setFilterStore(attrMenu.value)
              } else {
                setFilterStatus(attrMenu.value)
              }
              setPage(0)
              setAttrMenu(null)
            }}
          >
            <Filter className="size-3.5 shrink-0" />
            Filter to &ldquo;{attrMenu.value}&rdquo;
          </button>
        </div>
      )}
    </Card>
  )
}
