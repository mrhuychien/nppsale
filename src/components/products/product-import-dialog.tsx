"use client"

import { useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react"
import {
  parseProductSheet,
  TEMPLATE_HEADERS,
  TEMPLATE_SAMPLE_ROWS,
  type ParsedProductRow,
} from "@/lib/products/import-parse"

interface ProductImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Gọi sau khi import xong (≥1 dòng thành công) để refresh danh sách. */
  onImported?: () => void
}

function genSku(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 36 * 36).toString(36).toUpperCase().padStart(2, "0")
  return `SP${ts.slice(-5)}${rand}`
}

export function ProductImportDialog({ open, onOpenChange, onImported }: ProductImportDialogProps) {
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [rows, setRows] = useState<ParsedProductRow[]>([])
  const [headerError, setHeaderError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const validRows = rows.filter((r) => r.errors.length === 0)
  const errorRows = rows.filter((r) => r.errors.length > 0)

  const reset = () => {
    setFileName(null)
    setRows([])
    setHeaderError(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleClose = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleDownloadTemplate = async () => {
    const XLSX = await import("xlsx")
    const headers = [...TEMPLATE_HEADERS] as string[]
    const aoa: (string | number)[][] = [headers, ...TEMPLATE_SAMPLE_ROWS]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "San pham")
    XLSX.writeFile(wb, "mau-import-san-pham.xlsx")
  }

  const handleFile = async (file: File) => {
    setParsing(true)
    setHeaderError(null)
    setRows([])
    setFileName(file.name)
    try {
      const XLSX = await import("xlsx")
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" })
      const result = parseProductSheet(aoa)
      setHeaderError(result.headerError)
      setRows(result.rows)
      if (result.headerError) {
        toast({ title: "File chưa đúng định dạng", description: result.headerError, variant: "destructive" })
      }
    } catch {
      setHeaderError("Không đọc được file. Chỉ hỗ trợ .xlsx, .xls, .csv.")
    } finally {
      setParsing(false)
    }
  }

  const handleImport = async () => {
    if (!user?.org_id || validRows.length === 0) return
    setImporting(true)
    try {
      // 1. Lấy SKU đã tồn tại trong org để tránh đụng unique (org_id, sku).
      const { data: existing } = await supabase
        .from("products")
        .select("sku")
        .eq("org_id", user.org_id)
      const usedSku = new Set((existing as { sku: string }[] | null)?.map((r) => r.sku) ?? [])

      // 2. Dựng payload — auto-gen SKU trống, bỏ qua dòng SKU trùng (trong file
      //    + với DB). Dòng trùng được đẩy sang nhóm "bỏ qua" để báo người dùng.
      type Payload = {
        org_id: string; sku: string; name: string; category: string | null
        brand: string | null; barcode: string | null; base_unit: string
        vat_rate: number; cost_price: number; sell_price: number
        min_stock: number; shelf_life_days: number | null; status: string
        max_stock: number | null
      }
      const payloads: Payload[] = []
      const unitsBySku: Record<string, { unit_name: string; conversion: number }> = {}
      let skipped = 0

      for (const r of validRows) {
        let sku = r.sku.trim()
        if (sku) {
          if (usedSku.has(sku)) { skipped++; continue } // trùng → bỏ qua
        } else {
          do { sku = genSku() } while (usedSku.has(sku))
        }
        usedSku.add(sku)
        payloads.push({
          org_id: user.org_id,
          sku,
          name: r.name,
          category: r.category,
          brand: r.brand,
          barcode: r.barcode,
          base_unit: r.base_unit,
          vat_rate: r.vat_rate,
          cost_price: r.cost_price,
          sell_price: r.sell_price,
          min_stock: r.min_stock,
          shelf_life_days: r.shelf_life_days,
          status: r.status,
          max_stock: null,
        })
        if (r.secondary_unit && r.conversion) {
          unitsBySku[sku] = { unit_name: r.secondary_unit, conversion: Math.round(r.conversion) }
        }
      }

      if (payloads.length === 0) {
        toast({
          title: "Không có sản phẩm mới",
          description: `Tất cả ${skipped} dòng có SKU đã tồn tại.`,
          variant: "destructive",
        })
        setImporting(false)
        return
      }

      // 3. Bulk insert products.
      const { data: inserted, error } = await supabase
        .from("products")
        .insert(payloads)
        .select("id, sku")
      if (error) throw error

      // 4. Insert đơn vị quy đổi (product_units) cho dòng có khai báo.
      const insertedRows = (inserted as { id: string; sku: string }[]) || []
      const unitInserts = insertedRows
        .filter((p) => unitsBySku[p.sku])
        .map((p) => ({
          product_id: p.id,
          unit_name: unitsBySku[p.sku].unit_name,
          conversion: unitsBySku[p.sku].conversion,
        }))
      if (unitInserts.length > 0) {
        await supabase.from("product_units").insert(unitInserts)
      }

      toast({
        title: `Đã nhập ${insertedRows.length} sản phẩm`,
        description: skipped > 0 ? `Bỏ qua ${skipped} dòng SKU trùng.` : undefined,
      })
      onImported?.()
      handleClose(false)
    } catch (e) {
      toast({ title: "Lỗi nhập sản phẩm", description: (e as Error).message, variant: "destructive" })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nhập sản phẩm từ Excel</DialogTitle>
          <DialogDescription>
            Tải file mẫu, điền dữ liệu rồi tải lên. Cột bắt buộc: Tên sản phẩm, Đơn vị tính.
          </DialogDescription>
        </DialogHeader>

        {/* Bước 1: tải mẫu + chọn file */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4 mr-1.5" /> Tải file mẫu
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={parsing}>
            <Upload className="h-4 w-4 mr-1.5" /> {parsing ? "Đang đọc..." : "Chọn file Excel"}
          </Button>
          {fileName && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5" /> {fileName}
              <button type="button" onClick={reset} className="hover:text-foreground" aria-label="Bỏ file">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>

        {/* Lỗi cấu trúc file */}
        {headerError && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{headerError}</span>
          </div>
        )}

        {/* Bước 2: preview */}
        {rows.length > 0 && !headerError && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length} hợp lệ
              </Badge>
              {errorRows.length > 0 && (
                <Badge variant="danger" className="gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> {errorRows.length} lỗi
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                Chỉ {validRows.length} dòng hợp lệ được nhập. SKU trùng sẽ bị bỏ qua.
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border bg-card max-h-[40vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium w-8">#</th>
                    <th className="px-2 py-2 text-left font-medium">Tên</th>
                    <th className="px-2 py-2 text-left font-medium">ĐVT</th>
                    <th className="px-2 py-2 text-left font-medium">Nhãn hàng</th>
                    <th className="px-2 py-2 text-right font-medium">Giá bán</th>
                    <th className="px-2 py-2 text-left font-medium">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, idx) => {
                    const ok = r.errors.length === 0
                    return (
                      <tr key={idx} className={ok ? "" : "bg-destructive/5"}>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-2 py-1.5 font-medium truncate max-w-[180px]">{r.name || "—"}</td>
                        <td className="px-2 py-1.5">{r.base_unit || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.brand || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.sell_price ? formatCurrency(r.sell_price) : "—"}</td>
                        <td className="px-2 py-1.5">
                          {ok ? (
                            <span className="inline-flex items-center gap-1 text-xs text-tertiary">
                              <CheckCircle2 className="h-3 w-3" />
                              {r.secondary_unit ? `1 ${r.secondary_unit} = ${r.conversion} ${r.base_unit}` : "OK"}
                            </span>
                          ) : (
                            <span className="text-xs text-destructive">{r.errors.join("; ")}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 100 && (
              <p className="text-xs text-muted-foreground">Hiển thị 100/{rows.length} dòng đầu. Tất cả dòng hợp lệ vẫn được nhập.</p>
            )}
          </div>
        )}

        {/* Action */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={importing}>
            Huỷ
          </Button>
          <Button onClick={handleImport} disabled={importing || validRows.length === 0}>
            {importing ? "Đang nhập..." : `Nhập ${validRows.length} sản phẩm`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
