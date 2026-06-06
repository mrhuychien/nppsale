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
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react"
import {
  parseSupplierSheet,
  TEMPLATE_SUPPLIER_HEADERS,
  TEMPLATE_SUPPLIER_SAMPLE_ROWS,
  type ParsedSupplierRow,
} from "@/lib/suppliers/import-parse"

interface SupplierImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => void
}

export function SupplierImportDialog({ open, onOpenChange, onImported }: SupplierImportDialogProps) {
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [rows, setRows] = useState<ParsedSupplierRow[]>([])
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
    const headers = [...TEMPLATE_SUPPLIER_HEADERS] as string[]
    const aoa: (string | number)[][] = [headers, ...TEMPLATE_SUPPLIER_SAMPLE_ROWS]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Nha cung cap")
    XLSX.writeFile(wb, "mau-import-ncc.xlsx")
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
      const result = parseSupplierSheet(aoa)
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
      // 1. Lookup tên NCC + mã NCC đã tồn tại trong org để dedupe.
      const { data: existing } = await supabase
        .from("suppliers")
        .select("name, code")
        .eq("org_id", user.org_id)
      const existingNames = new Set(
        ((existing as { name: string; code: string }[]) || []).map((s) => s.name.toLowerCase())
      )
      const existingCodes = new Set(
        ((existing as { name: string; code: string }[]) || []).map((s) => s.code)
      )

      // 2. Số sequence để gen mã tự động cho NCC không có code.
      let nextSeq = existingCodes.size + 1
      const usedCodes = new Set(existingCodes)
      const genCode = (): string => {
        while (true) {
          const code = `NCC-${String(nextSeq).padStart(4, "0")}`
          nextSeq++
          if (!usedCodes.has(code)) {
            usedCodes.add(code)
            return code
          }
        }
      }

      type Payload = {
        org_id: string
        name: string
        code: string
        category: string | null
        contact_name: string | null
        phone: string | null
        email: string | null
        address: string | null
        tax_code: string | null
        bank_account: string | null
        bank_name: string | null
        payment_terms: string
        notes: string | null
        is_verified: boolean
        is_active: boolean
        rating: number
      }
      const payloads: Payload[] = []
      let skipped = 0

      for (const r of validRows) {
        if (existingNames.has(r.name.toLowerCase())) {
          skipped++
          continue
        }
        existingNames.add(r.name.toLowerCase())
        const code = r.code && !usedCodes.has(r.code) ? (usedCodes.add(r.code), r.code) : genCode()
        payloads.push({
          org_id: user.org_id,
          name: r.name,
          code,
          category: r.category,
          contact_name: r.contact_name,
          phone: r.phone,
          email: r.email,
          address: r.address,
          tax_code: r.tax_code,
          bank_account: r.bank_account,
          bank_name: r.bank_name,
          payment_terms: r.payment_terms,
          notes: r.notes,
          is_verified: r.is_verified,
          is_active: r.is_active,
          rating: 0,
        })
      }

      if (payloads.length === 0) {
        toast({
          title: "Không có NCC mới",
          description: `Tất cả ${skipped} dòng đã tồn tại trong hệ thống.`,
          variant: "destructive",
        })
        setImporting(false)
        return
      }

      const BATCH = 200
      let inserted = 0
      for (let i = 0; i < payloads.length; i += BATCH) {
        const slice = payloads.slice(i, i + BATCH)
        const { error, count } = await supabase
          .from("suppliers")
          .insert(slice, { count: "exact" })
        if (error) throw error
        inserted += count ?? slice.length
      }

      toast({
        title: `Đã nhập ${inserted} nhà cung cấp`,
        description: skipped > 0 ? `Bỏ qua ${skipped} NCC đã tồn tại (trùng tên).` : undefined,
      })
      onImported?.()
      handleClose(false)
    } catch (e) {
      toast({ title: "Lỗi nhập NCC", description: (e as Error).message, variant: "destructive" })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nhập nhà cung cấp từ Excel</DialogTitle>
          <DialogDescription>
            Tải file mẫu, điền dữ liệu rồi tải lên. Cột bắt buộc: <b>Tên NCC</b>. NCC trùng tên sẽ bị bỏ qua.
          </DialogDescription>
        </DialogHeader>

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

        {headerError && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{headerError}</span>
          </div>
        )}

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
                NCC trùng tên với hệ thống sẽ tự động bỏ qua.
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border bg-card max-h-[40vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium w-8">#</th>
                    <th className="px-2 py-2 text-left font-medium">Tên</th>
                    <th className="px-2 py-2 text-left font-medium">SĐT</th>
                    <th className="px-2 py-2 text-left font-medium">Địa chỉ</th>
                    <th className="px-2 py-2 text-left font-medium">Công nợ</th>
                    <th className="px-2 py-2 text-left font-medium">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, idx) => {
                    const ok = r.errors.length === 0
                    return (
                      <tr key={idx} className={!ok ? "bg-destructive/5" : ""}>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-2 py-1.5 font-medium truncate max-w-[220px]">
                          {r.name || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.phone || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[200px]">
                          {r.address || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.payment_terms}</td>
                        <td className="px-2 py-1.5">
                          {!ok ? (
                            <span className="text-xs text-destructive">{r.errors.join("; ")}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-tertiary">
                              <CheckCircle2 className="h-3 w-3" /> OK
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 100 && (
              <p className="text-xs text-muted-foreground">Hiển thị 100/{rows.length} dòng đầu.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={importing}>
            Huỷ
          </Button>
          <Button onClick={handleImport} disabled={importing || validRows.length === 0}>
            {importing ? "Đang nhập..." : `Nhập ${validRows.length} NCC`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
