"use client"

import { useMemo, useRef, useState } from "react"
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
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, Copy } from "lucide-react"
import {
  parseCustomerSheet,
  TEMPLATE_CUSTOMER_HEADERS,
  TEMPLATE_CUSTOMER_SAMPLE_ROWS,
  type ParsedCustomerRow,
} from "@/lib/customers/import-parse"
import { errorMessage } from "@/lib/errors"
import { kiemTrungSdtHangLoat, sdtDeLuu, trungCuaDong } from "@/lib/customers/kiem-trung-hang-loat"
import type { KhachTrung } from "@/lib/customers/tao-khach"

/** Lỗi trùng khoá UNIQUE(org_id, phone) — số vừa được người khác tạo giữa lúc xem trước và lúc nhập. */
const laLoiTrungSdt = (e: { code?: string; message?: string } | null) =>
  e?.code === "23505" || /duplicate key|customers_org_id_phone/i.test(e?.message ?? "")

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
  /**
   * BƯỚC LỌC TRÙNG (chủ nhà 03/11/2026: "tất cả các chỗ tạo khách hàng đều phải qua bước lọc trùng"): đọc file xong là
   * hỏi sổ từng số (`kiemTrungSdtHangLoat` — thấy cả khách NV khác). `null` = chưa kiểm xong → chưa cho nhập.
   */
  const [trung, setTrung] = useState<Map<string, KhachTrung> | null>(null)
  const [tienDoKiem, setTienDoKiem] = useState<{ xong: number; tong: number } | null>(null)
  const [loiKiem, setLoiKiem] = useState<string | null>(null)
  /** Lượt kiểm mới nhất — chọn file khác giữa chừng thì kết quả lượt cũ bỏ. */
  const luotKiem = useRef(0)

  const validRows = rows.filter((r) => r.errors.length === 0)
  const errorRows = rows.filter((r) => r.errors.length > 0)
  const trungRows = useMemo(
    () => (trung ? validRows.filter((r) => trungCuaDong(r.phone, trung)) : []),
    [validRows, trung]
  )
  const moiRows = useMemo(
    () => (trung ? validRows.filter((r) => !trungCuaDong(r.phone, trung)) : []),
    [validRows, trung]
  )
  const daKiemXong = trung !== null && !loiKiem

  const kiemTrung = async (ds: ParsedCustomerRow[]) => {
    const luot = ++luotKiem.current
    setTrung(null)
    setLoiKiem(null)
    try {
      const kq = await kiemTrungSdtHangLoat(
        supabase,
        ds.filter((r) => r.errors.length === 0).map((r) => r.phone),
        { onTienDo: (xong, tong) => { if (luot === luotKiem.current) setTienDoKiem({ xong, tong }) } }
      )
      if (luot === luotKiem.current) setTrung(kq)
    } catch (e) {
      if (luot === luotKiem.current) setLoiKiem(errorMessage(e))
    } finally {
      if (luot === luotKiem.current) setTienDoKiem(null)
    }
  }

  const reset = () => {
    luotKiem.current += 1
    setFileName(null)
    setRows([])
    setHeaderError(null)
    setTrung(null)
    setLoiKiem(null)
    setTienDoKiem(null)
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
      } else {
        void kiemTrung(result.rows)
      }
    } catch {
      setHeaderError("Không đọc được file. Chỉ hỗ trợ .xlsx, .xls, .csv.")
    } finally {
      setParsing(false)
    }
  }

  const handleImport = async () => {
    if (!user?.org_id || !trung || loiKiem || moiRows.length === 0) return
    setImporting(true)
    try {
      /* ⚠ KHÔNG đối chiếu với `customers.phone` đọc thẳng nữa: dưới RLS NVBH chỉ thấy khách của mình — số của khách NV khác
         lọt qua (xem `kiem-trung-hang-loat.ts`). Bước lọc trùng đã hỏi sổ từng số; ở đây chỉ còn chống trùng TRONG lần ghi. */
      const soTrongLanNay = new Set<string>()
      type Payload = {
        org_id: string
        /** Nhân viên nhập file — người tạo của mọi dòng trong lần nhập này. */
        created_by: string
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
        // Số GHI chuẩn hoá như khi tạo tay — UNIQUE(org_id, phone) so nguyên văn (xem `sdtDeLuu`).
        const pk = sdtDeLuu(r.phone)
        if (trungCuaDong(r.phone, trung) || (pk && soTrongLanNay.has(pk))) {
          skipped++
          continue
        }
        if (pk) soTrongLanNay.add(pk)
        payloads.push({
          org_id: user.org_id,
          // ⚠ Trước đây màn này KHÔNG đóng dấu người tạo, nên mọi điểm bán
          // nhập từ Excel đều "không rõ ai tạo" — mà đó lại là đường vào
          // của phần lớn dữ liệu. Cột đã có từ mig 032; chỉ là chỗ này
          // quên điền.
          created_by: user.id,
          store_name: r.store_name,
          owner_name: r.owner_name,
          phone: pk,
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
        if (error && laLoiTrungSdt(error)) {
          /* Số vừa được tạo ở nơi khác giữa lúc xem trước và lúc nhập — cả lô bị từ chối. Ghi lại TỪNG dòng: dòng trùng
             bỏ qua (đếm vào "bỏ qua"), dòng còn lại vẫn vào. */
          for (const dong of slice) {
            const r1 = await supabase.from("customers").insert(dong).select("id").single()
            if (r1.error) {
              if (laLoiTrungSdt(r1.error)) { skipped++; continue }
              throw r1.error
            }
            insertedIds.push((r1.data as { id: string }).id)
          }
          continue
        }
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
      toast({ title: "Lỗi nhập KH", description: errorMessage(e), variant: "destructive" })
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
            Đọc file xong hệ thống <b>lọc trùng số điện thoại</b> với mọi khách đã có (kể cả khách NV khác phụ trách) —
            dòng trùng bị bỏ qua.
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
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="nhap-khach-tom-tat">
              {daKiemXong ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {moiRows.length} khách mới
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">{validRows.length} hợp lệ</Badge>
              )}
              {trungRows.length > 0 && (
                <Badge variant="warning" className="gap-1" data-testid="nhap-khach-so-trung">
                  <Copy className="h-3.5 w-3.5" /> {trungRows.length} trùng SĐT — bỏ qua
                </Badge>
              )}
              {errorRows.length > 0 && (
                <Badge variant="danger" className="gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> {errorRows.length} lỗi
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {tienDoKiem
                  ? `Đang lọc trùng số điện thoại… ${tienDoKiem.xong}/${tienDoKiem.tong}`
                  : daKiemXong
                    ? "Đã lọc trùng số điện thoại với mọi khách đã có."
                    : ""}
                {autoAssignToSelf && " KH mới sẽ tự gán vào danh sách của bạn."}
              </span>
            </div>
            {loiKiem && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-testid="nhap-khach-loi-kiem">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  Chưa lọc được trùng số điện thoại ({loiKiem}) — chưa nhập, vì nhập tiếp có thể tạo khách trùng.
                </span>
                <Button size="sm" variant="outline" onClick={() => void kiemTrung(rows)}>Kiểm lại</Button>
              </div>
            )}

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
                    const kh = ok && trung ? trungCuaDong(r.phone, trung) : null
                    return (
                      <tr key={idx} className={!ok ? "bg-destructive/5" : kh ? "bg-amber-50" : ""} data-testid={kh ? "nhap-khach-dong-trung" : undefined}>
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
                          ) : kh ? (
                            <span className="text-xs font-medium text-amber-600">
                              Trùng SĐT: đã có “{kh.store_name}”
                              {kh.primary_user_name ? ` (${kh.primary_user_name} phụ trách)` : ""} — bỏ qua
                            </span>
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
          <Button
            onClick={handleImport}
            data-testid="nhap-khach-nut"
            disabled={importing || !daKiemXong || moiRows.length === 0}
            title={!daKiemXong ? "Chờ lọc trùng số điện thoại xong" : moiRows.length === 0 ? "Không có khách mới để nhập" : undefined}
          >
            {importing
              ? "Đang nhập..."
              : loiKiem
                ? "Chưa lọc được trùng"
                : !daKiemXong && rows.length > 0
                  ? "Đang lọc trùng…"
                  : `Nhập ${moiRows.length} khách hàng`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
