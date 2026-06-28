import { useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useDataSourceStore } from "@/store/useDataSourceStore"

/**
 * Drag-and-drop zone for ephemeral Local CSV mode. Accepts multiple Loyverse
 * sales exports, uploads them to the in-memory backend engine (never persisted
 * to PostgreSQL), and lets the operator flush the data again.
 */
export function LoyverseUploadZone() {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isUploading = useDataSourceStore((s) => s.isUploading)
  const uploadError = useDataSourceStore((s) => s.uploadError)
  const csvLoaded = useDataSourceStore((s) => s.csvLoaded)
  const csvStats = useDataSourceStore((s) => s.csvStats)
  const uploadCsvFiles = useDataSourceStore((s) => s.uploadCsvFiles)
  const clearCsv = useDataSourceStore((s) => s.clearCsv)

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    void uploadCsvFiles(Array.from(fileList))
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Local CSV Upload (Ephemeral)</CardTitle>
        <CardDescription>
          Upload one or more POS sales export CSVs to analyze them instantly.
          Files are held in memory for this session only — never saved to the
          database, and cleared on refresh.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {csvLoaded && csvStats ? (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
              <CheckCircle2 className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">CSV data loaded</p>
              <p className="text-xs text-muted-foreground">
                {csvStats.files.filter((f) => !f.skipped).length} file(s) ·{" "}
                {csvStats.receipts} receipts · {csvStats.items} line items ·{" "}
                {csvStats.stores} store(s)
              </p>
              <ul className="mt-2 space-y-0.5">
                {csvStats.files.map((f) => (
                  <li
                    key={f.filename}
                    className={cn(
                      "flex items-center gap-1.5 text-xs",
                      f.skipped ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    <FileSpreadsheet className="size-3" />
                    <span className="truncate">{f.filename}</span>
                    <span className="shrink-0">
                      {f.skipped ? `— skipped: ${f.reason ?? ""}` : `(${f.rows} rows)`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-destructive hover:text-destructive"
              onClick={() => void clearCsv()}
            >
              <Trash2 className="size-4" />
              Clear CSV Data
            </Button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-busy={isUploading}
            onClick={() => !isUploading && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !isUploading) {
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
              isUploading && "pointer-events-none opacity-70",
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
              {isUploading ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <UploadCloud className="size-6" />
              )}
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {isUploading
                  ? "Uploading & parsing…"
                  : isDragging
                    ? "Drop the CSV files to upload"
                    : "Drag & drop your CSV files here"}
              </p>
              <p className="text-xs text-muted-foreground">
                or <span className="font-medium text-primary">browse files</span> ·
                multiple POS exports supported (.csv)
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <FileSpreadsheet className="size-3.5" />
              CSV · up to 50 MB total
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}

        {uploadError && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
