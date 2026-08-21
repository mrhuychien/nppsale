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
import { readSheetAsRows } from "@/lib/xlsx-safe"
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react"
import {
  parseCustomerSheet,
  TEMPLATE_CUSTOMER_HEADERS,
  TEMPLATE_CUSTOMER_SAMPLE_ROWS,
  type ParsedCustomerRow,
} from "@/lib/customers/import-parse"

interface CustomerImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Sales = true: tự gán primary assignment cho user hiện tại sau khi insert. */
  autoAssignToSelf?: boolean
  onImported?: () => void
}

export function CustomerImportDialog({
  open,
  onOpenChange,
  autoAssignToSelf,
  onImported,
}: CustomerImportDialogProps) {
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [rows, setRows] = useState<ParsedCustomerRow[]>([])
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
    const headers = [...TEMPLATE_CUSTOMER_HEADERS] as string[]
    const aoa: (string | number)[][] = [headers, ...TEMPLATE_CUSTOMER_SAMPLE_ROWS]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Khach hang")
    XLSX.writeFile(wb, "mau-import-khach-hang.xlsx")
  }

  const handleFile = async (file: File) => {
    setParsing(true)
    setHeaderError(null)
    setRows([])
    setFileName(file.name)
    try {
      // readSheetAsRows: cô lập Object.prototype khi phân tích file
      // người dùng tải lên (xlsx trên npm còn lỗ hổng — xem lib).
      const aoa = await readSheetAsRows(file)
      const result = parseCustomerSheet(aoa)
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
      // Dedupe theo SĐT trong DB hiện có (case stripped khoảng trắng).
      const { data: existing, error: existingErr } = await supabase
        .from("customers")
        .select("phone")
        .eq("org_id", user.org_id)
      if (existingErr) console.error("[customers/customer-import-dialog] truy vấn lỗi:", existingErr.message)
      const existingPhones = new Set(
        ((existing as { phone: string | null }[]) || [])
          .map((r) => (r.phone || "").replace(/\s+/g, ""))
          .filter(Boolean)
      )

      type Payload = {
        org_id: string
        store_name: string
        owner_name: string
        phone: string
        address: string
        ward: string | null
        channel: string | null
        credit_limit: number
        payment_terms: string
        status: string
        tax_code: string | null
        billing_name: string | null
        billing_address: string | null
        billing_email: string | null
        payment_method_label: string
        province: string | null
        district: string | null
      }
      const payloads: Payload[] = []
      let skipped = 0

      for (const r of validRows) {
        const pk = r.phone.replace(/\s+/g, "")
        if (pk && existingPhones.has(pk)) {
          skipped++
          continue
        }
        if (pk) existingPhones.add(pk)
        payloads.push({
          org_id: user.org_id,
          store_name: r.store_name,
          owner_name: r.owner_name,
          phone: r.phone,
          address: r.address,
          ward: r.ward,
          channel: r.channel,
          credit_limit: r.credit_limit,
          payment_terms: r.payment_terms,
          status: r.status,
          tax_code: r.tax_code,
          billing_name: r.billing_name,
          billing_address: r.billing_address,
          billing_email: r.billing_email,
          payment_method_label: r.payment_method_label,
          province: null,
          district: null,
        })
      }

      if (payloads.length === 0) {
        toast({
          title: "Không có khách hàng mới",
          description: `Tất cả ${skipped} dòng đã tồn tại (trùng SĐT).`,
          variant: "destructive",
        })
        setImporting(false)
        return
      }

      const BATCH = 200
      const insertedIds: string[] = []
      for (let i = 0; i < payloads.length; i += BATCH) {
        const slice = payloads.slice(i, i + BATCH)
        const { data, error } = await supabase
          .from("customers")
          .insert(slice)
          .select("id")
        if (error) throw error
        for (const row of (data as { id: string }[]) || []) {
          insertedIds.push(row.id)
        }
      }

      // Sales: tự gán primary assignment qua RPC SECURITY DEFINER cho từng
      // KH (RLS chặn insert trực tiếp vào customer_assignments với role
      // sales). Batch song song 8 RPC để tránh kẹt 1 dòng tonal stop chuỗi.
      if (autoAssignToSelf && insertedIds.length > 0 && user.id) {
        const CONCURRENCY = 8
        for (let i = 0; i < insertedIds.length; i += CONCURRENCY) {
          const slice = insertedIds.slice(i, i + CONCURRENCY)
          await Promise.all(
            slice.map((cid) =>
              supabase.rpc("claim_customer_for_me", { p_customer_id: cid }).then((r) => {
                if (r.error) {
                  console.warn("[customer-import] claim failed:", cid, r.error.message)
                }
              })
            )
          )
        }
      }

      toast({
        title: `Đã nhập ${insertedIds.length} khách hàng`,
        description: skipped > 0 ? `Bỏ qua ${skipped} KH đã tồn tại (trùng SĐT).` : undefined,
      })
      onImported?.()
      handleClose(false)
    } catch (e) {
      toast({ title: "Lỗi nhập KH", description: (e as Error).message, variant: "destructive" })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nhập khách hàng từ Excel</DialogTitle>
          <DialogDescription>
            Tải file mẫu, điền dữ liệu rồi tải lên. Cột bắt buộc: <b>Tên cửa hàng</b>.
            KH trùng SĐT với hệ thống sẽ bị bỏ qua.
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
                KH trùng SĐT với hệ thống sẽ tự động bỏ qua.
                {autoAssignToSelf && " KH mới sẽ tự gán vào danh sách của bạn."}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border bg-card max-h-[40vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium w-8">#</th>
                    <th className="px-2 py-2 text-left font-medium">Cửa hàng</th>
                    <th className="px-2 py-2 text-left font-medium">SĐT</th>
                    <th className="px-2 py-2 text-left font-medium">Địa chỉ</th>
                    <th className="px-2 py-2 text-left font-medium">Kênh</th>
                    <th className="px-2 py-2 text-right font-medium">Hạn mức</th>
                    <th className="px-2 py-2 text-left font-medium">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, idx) => {
                    const ok = r.errors.length === 0
                    return (
                      <tr key={idx} className={!ok ? "bg-destructive/5" : ""}>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-2 py-1.5 font-medium truncate max-w-[200px]">
                          {r.store_name || "—"}
                          {r.owner_name && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              · {r.owner_name}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.phone || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[180px]">
                          {[r.address, r.ward].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.channel || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {r.credit_limit ? formatCurrency(r.credit_limit) : "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          {!ok ? (
                            <span className="text-xs text-destructive">{r.errors.join("; ")}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-tertiary">
                              <CheckCircle2 className="h-3 w-3" /> {r.payment_terms}
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
            {importing ? "Đang nhập..." : `Nhập ${validRows.length} khách hàng`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
