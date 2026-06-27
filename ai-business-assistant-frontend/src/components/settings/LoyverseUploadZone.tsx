import { useRef, useState } from "react"
import { CheckCircle2, FileSpreadsheet, UploadCloud, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Drag-and-drop upload zone for the Loyverse Inventory Export CSV.
 * Visual only for now — it captures the file name to preview the interaction
 * but performs no parsing or network upload. Wiring to the POS adapter happens later.
 */
export function LoyverseUploadZone() {
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = (file: File | undefined) => {
    if (file) setFileName(file.name)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    accept(e.dataTransfer.files?.[0])
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Loyverse Inventory Export</CardTitle>
        <CardDescription>
          Upload the inventory export CSV from Loyverse to refresh current stock levels.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {fileName ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
              <CheckCircle2 className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{fileName}</p>
              <p className="text-xs text-muted-foreground">
                Ready to sync · not yet processed
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove file"
              onClick={() => setFileName(null)}
            >
              <X />
            </Button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/40"
            )}
          >
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-2xl transition-colors",
                isDragging
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary"
              )}
            >
              <UploadCloud className="size-6" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {isDragging ? "Drop the CSV to upload" : "Drag & drop your CSV here"}
              </p>
              <p className="text-xs text-muted-foreground">
                or <span className="font-medium text-primary">browse files</span> ·
                Loyverse Inventory Export (.csv)
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <FileSpreadsheet className="size-3.5" />
              CSV up to 10 MB
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => accept(e.target.files?.[0] ?? undefined)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
