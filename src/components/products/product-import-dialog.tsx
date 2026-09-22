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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ghiPhieuNhapKho } from "@/lib/inventory/post-import"
import { formatCurrency } from "@/lib/utils"
import { vnToday } from "@/lib/inventory/opening-stock"
import {
  buildOpeningEntry,
  canPostOpeningStock,
  planOpeningStock,
} from "@/lib/products/opening-stock-plan"
import { readSheetAsRows } from "@/lib/xlsx-safe"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react"
import {
  parseProductSheet,
  groupRowsForImport,
  TEMPLATE_HEADERS,
  TEMPLATE_SAMPLE_ROWS,
  type ParsedProductRow,
} from "@/lib/products/import-parse"
import { errorMessage } from "@/lib/errors"

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
  // Ngày chốt sổ của bên bàn giao, không phải ngày bấm nút. Mặc định hôm
  // nay theo lịch Việt Nam.
  const [openingDate, setOpeningDate] = useState<string>(vnToday(new Date()))

  const validRows = rows.filter((r) => r.errors.length === 0)
  const errorRows = rows.filter((r) => r.errors.length > 0)
  // Dòng vẫn được nhập nhưng có chuyện đáng nói (vd chưa có NCC).
  const warnRows = rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0)
  // Group theo cấu trúc KiotViet: dòng có "Mã ĐVT Cơ bản" sẽ thành đơn vị quy đổi.
  const grouped = groupRowsForImport(rows)
  const productCount = grouped.baseRows.length
  const unitCount = Object.values(grouped.unitsByParentSku).reduce((s, u) => s + u.length, 0)
  const orphanCount = grouped.orphanedRows.length
  // Xem trước phần tồn đầu kỳ, tính thẳng từ các dòng sản phẩm.
  const withStock = grouped.baseRows.filter((r) => r.opening_qty > 0)
  const openingRowCount = withStock.length
  const openingValue = withStock.reduce((s, r) => s + r.opening_qty * r.cost_price, 0)
  const openingNoCost = withStock.filter((r) => r.cost_price <= 0).length
  const canPostStock = canPostOpeningStock(user?.role)

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
      // readSheetAsRows: cô lập Object.prototype khi phân tích file
      // người dùng tải lên (xlsx trên npm còn lỗ hổng — xem lib).
      const aoa = await readSheetAsRows(file)
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

  /**
   * Ghi phiếu tồn đầu kỳ. Trả về một câu để ghép vào thông báo — kể cả
   * khi hỏng.
   *
   * ⚠ KHÔNG ném lỗi ra ngoài. Sản phẩm đã nằm trong cơ sở dữ liệu rồi;
   * để lỗi nổ lên sẽ hiện "Lỗi nhập sản phẩm" trong khi sản phẩm đã nhập
   * xong — người dùng nhập lại lần nữa là trùng SKU toàn bộ. Hỏng thì nói
   * đúng là hỏng chỗ nào và còn phải làm gì.
   */
  const importOpeningStock = async (
    idBySku: Record<string, string>
  ): Promise<string | null> => {
    if (!user?.org_id || openingRowCount === 0) return null
    if (!canPostStock) {
      return `⚠ CHƯA tạo phiếu tồn đầu kỳ cho ${openingRowCount} mặt hàng: chỉ tài khoản chủ NPP mới ghi được kho`
    }

    const plan = planOpeningStock(
      grouped.baseRows.map((r) => ({
        sku: r.sku,
        name: r.name,
        opening_qty: r.opening_qty,
        cost_price: r.cost_price,
      })),
      idBySku
    )
    if (plan.lines.length === 0) return null

    try {
      const payload = buildOpeningEntry({
        orgId: user.org_id,
        userId: user.id,
        entryDate: openingDate,
        now: new Date(),
        rand: Math.random(),
        lines: plan.lines,
      })

      // Tên đơn vị lấy từ chính dòng file — đơn vị tính của sản phẩm.
      const unitBySku: Record<string, string> = {}
      for (const r of grouped.baseRows) unitBySku[r.sku] = r.base_unit

      // ⚠ MỘT GIAO DỊCH (mig 168). Bản cũ ghi phiếu → lô → dòng bằng ba
      //   lệnh rời: dòng hỏng là phiếu `posted` rỗng mà lô vẫn có tồn.
      await ghiPhieuNhapKho(supabase, {
        entry_code: payload.entry.entry_code,
        posted_at: payload.entry.posted_at,
        notes: payload.entry.notes,
        lines: plan.lines.map((l, i) => ({
          product_id: l.productId,
          batch_code: payload.batches[i].batch_code,
          expires_at: payload.batches[i].expires_at,
          unit_name: unitBySku[l.sku] || "cái",
          qty_tx: l.qty,
          conv: 1,
          base_qty: l.qty,
          base_cost: l.unitCost,
        })),
      })

      const parts = [
        `tồn đầu kỳ ${plan.lines.length} mặt hàng (${formatCurrency(plan.totalValue)})`,
      ]
      if (plan.missingCost.length > 0) {
        parts.push(`⚠ ${plan.missingCost.length} mặt hàng chưa có giá vốn — lãi gộp sẽ tính sai`)
      }
      if (plan.unmatched > 0) {
        parts.push(`${plan.unmatched} dòng có tồn nhưng SKU đã tồn tại — bỏ qua, nhập kho tay nếu cần`)
      }
      return parts.join(" · ")
    } catch (e) {
      console.error("[products/product-import-dialog] tồn đầu kỳ lỗi:", e)
      return `⚠ Sản phẩm đã nhập xong nhưng CHƯA tạo được phiếu tồn đầu kỳ (${
        (e as Error)?.message || "lỗi không rõ"
      }) — vào Kho › Nhập kho để tạo tay`
    }
  }

  const handleImport = async () => {
    if (!user?.org_id || productCount === 0) return
    setImporting(true)
    try {
      // 1. Lấy SKU đã tồn tại + NCC hiện có trong org.
      //
      // ⚠ PHẢI PHÂN TRANG. Câu này từng là `.select("sku")` trần: Supabase
      // chặn 1.000 dòng mỗi request và trả 200 KHÔNG kèm lỗi. Với 1.740
      // sản phẩm thì ~740 mã không lọt vào danh sách "đã có", nên nhập
      // lại file cũ là TẠO TRÙNG chứ không bỏ qua — đúng triệu chứng
      // "thử import chưa thấy bỏ qua mã trùng".
      //
      // Danh sách này quyết định tạo hay bỏ qua, nên thiếu một phần là
      // sai theo hướng nguy hiểm: sinh ra sản phẩm trùng mã.
      const [skuRes, supRes] = await Promise.all([
        fetchAllForAggregate<{ sku: string }>((from, to) =>
          supabase
            .from("products")
            .select("sku", { count: "exact" })
            .eq("org_id", user.org_id)
            .range(from, to)
        ),
        fetchAllForAggregate<{ id: string; name: string }>((from, to) =>
          supabase
            .from("suppliers")
            .select("id, name", { count: "exact" })
            .eq("org_id", user.org_id)
            .range(from, to)
        ),
      ])
      // Đọc thiếu danh sách này thì KHÔNG được nhập tiếp: bỏ qua lỗi là
      // đẩy vào cơ sở dữ liệu một mớ sản phẩm trùng mã, mà gỡ ra thì phải
      // dò tay từng dòng.
      const readErr = skuRes.error || supRes.error
      if (readErr) {
        throw new Error(
          `Không đọc được danh sách sản phẩm hiện có (${readErr}) — dừng, ` +
            `vì nhập tiếp sẽ tạo ra sản phẩm trùng mã.`
        )
      }
      if (skuRes.truncated) {
        throw new Error(
          "Danh mục quá lớn để đối chiếu mã trùng trong một lần. Dừng lại " +
            "thay vì nhập một phần rồi tạo ra sản phẩm trùng mã."
        )
      }
      const usedSku = new Set(skuRes.rows.map((r) => r.sku))
      const supplierByLower: Record<string, string> = {}
      for (const s of supRes.rows) {
        supplierByLower[s.name.toLowerCase()] = s.id
      }

      // 1b. Auto-tạo NCC mới cho các tên NCC trong file chưa có.
      const newSupplierNames = new Set<string>()
      for (const r of grouped.baseRows) {
        const sname = r.supplier_name?.trim()
        if (sname && !supplierByLower[sname.toLowerCase()]) newSupplierNames.add(sname)
      }
      if (newSupplierNames.size > 0) {
        const insertRows = Array.from(newSupplierNames).map((name) => ({
          org_id: user.org_id, name, is_active: true,
        }))
        const { data: createdSup, error: supErr } = await supabase
          .from("suppliers")
          .insert(insertRows)
          .select("id, name")
        if (supErr) throw supErr
        for (const s of (createdSup as { id: string; name: string }[]) || []) {
          supplierByLower[s.name.toLowerCase()] = s.id
        }
      }

      // 2. Dựng payload từ baseRows (đã group qua groupRowsForImport).
      type Payload = {
        org_id: string; sku: string; name: string; category: string | null
        primary_supplier_id: string | null; barcode: string | null; base_unit: string
        vat_rate: number; cost_price: number; sell_price: number
        min_stock: number; max_stock: number | null
        shelf_life_days: number | null; status: string
        description: string | null; shelf_location: string | null
        weight: number | null; warranty_info: string | null; direct_sale: boolean
      }
      const payloads: Payload[] = []
      /** SKU mới sau khi auto-gen → SKU gốc trong file (để map units). */
      const newSkuFromOriginal: Record<string, string> = {}
      let skipped = 0

      for (const r of grouped.baseRows) {
        const original = r.sku.trim()
        let sku = original
        if (sku) {
          if (usedSku.has(sku)) { skipped++; continue }
        } else {
          do { sku = genSku() } while (usedSku.has(sku))
        }
        usedSku.add(sku)
        if (original) newSkuFromOriginal[original] = sku
        const sname = r.supplier_name?.trim().toLowerCase() || ""
        const supplier_id = supplierByLower[sname] || null
        payloads.push({
          org_id: user.org_id,
          sku,
          name: r.name,
          category: r.category,
          primary_supplier_id: supplier_id,
          barcode: r.barcode,
          base_unit: r.base_unit,
          vat_rate: r.vat_rate,
          cost_price: r.cost_price,
          sell_price: r.sell_price,
          min_stock: r.min_stock,
          max_stock: r.max_stock,
          shelf_life_days: r.shelf_life_days,
          status: r.status,
          description: r.description,
          shelf_location: r.shelf_location,
          weight: r.weight,
          warranty_info: r.warranty_info,
          direct_sale: r.direct_sale,
        })
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

      // 3. Bulk insert products theo batch 200 (Supabase OK với insert lớn,
      //    nhưng batch nhỏ cho file 3000+ dòng để tránh timeout + dễ retry).
      const BATCH = 200
      const insertedRows: { id: string; sku: string }[] = []
      for (let i = 0; i < payloads.length; i += BATCH) {
        const slice = payloads.slice(i, i + BATCH)
        const { data, error } = await supabase
          .from("products")
          .insert(slice)
          .select("id, sku")
        if (error) throw error
        insertedRows.push(...((data as { id: string; sku: string }[]) || []))
      }

      // 4. Build product_units: gắn SKU file gốc → product_id mới.
      //    grouped.unitsByParentSku dùng SKU file gốc làm key, tra qua
      //    newSkuFromOriginal để ra SKU thật (sau khi gen), rồi tìm id.
      const idBySku: Record<string, string> = {}
      for (const p of insertedRows) idBySku[p.sku] = p.id

      type UnitInsert = { product_id: string; unit_name: string; conversion: number }
      const unitInserts: UnitInsert[] = []
      for (const [origSku, units] of Object.entries(grouped.unitsByParentSku)) {
        const realSku = newSkuFromOriginal[origSku] || origSku
        const productId = idBySku[realSku]
        if (!productId) continue
        for (const u of units) {
          unitInserts.push({ product_id: productId, unit_name: u.unit_name, conversion: u.conversion })
        }
      }
      // Batch insert units cũng để an toàn.
      for (let i = 0; i < unitInserts.length; i += BATCH) {
        const slice = unitInserts.slice(i, i + BATCH)
        await supabase.from("product_units").insert(slice).throwOnError()
      }

      // 5. Tồn kho đầu kỳ — một phiếu nhập ghi lùi ngày, định giá bằng
      //    cột "Giá vốn" của chính file này.
      //
      //    Chạy SAU khi sản phẩm đã vào. Sản phẩm vào rồi mà phiếu kho
      //    hỏng thì vẫn còn danh mục để nhập kho tay; làm ngược lại thì
      //    phiếu kho trỏ vào sản phẩm chưa tồn tại.
      const openingNote = await importOpeningStock(idBySku)

      toast({
        title: `Đã nhập ${insertedRows.length} sản phẩm`,
        description: [
          unitInserts.length > 0 ? `${unitInserts.length} đơn vị quy đổi` : null,
          openingNote,
          // ⚠ Trước đây thông báo KHÔNG hề nhắc tới dòng bị loại vì lỗi.
          // 40 sản phẩm biến mất mà lần nhập vẫn báo thành công — đó là
          // lý do không ai phát hiện ra suốt từ đầu.
          errorRows.length > 0
            ? `⚠ BỎ ${errorRows.length} dòng lỗi — những mã này KHÔNG được tạo`
            : null,
          warnRows.length > 0 ? `${warnRows.length} dòng thiếu NCC (vẫn nhập)` : null,
          skipped > 0 ? `Bỏ qua ${skipped} SKU trùng` : null,
          orphanCount > 0 ? `${orphanCount} dòng quy đổi mồ côi (không tìm thấy SKU cha)` : null,
          grouped.droppedOpeningQtyRows > 0
            ? `${grouped.droppedOpeningQtyRows} dòng quy đổi có ghi tồn — đã bỏ để không nhân đôi kho`
            : null,
        ].filter(Boolean).join(" · ") || undefined,
        variant: errorRows.length > 0 ? "destructive" : undefined,
      })
      onImported?.()
      handleClose(false)
    } catch (e) {
      toast({ title: "Lỗi nhập sản phẩm", description: errorMessage(e), variant: "destructive" })
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
            Điền thêm cột &quot;Tồn kho đầu kỳ&quot; và &quot;Giá vốn&quot; thì hệ thống tạo luôn
            phiếu nhập tồn đầu kỳ — không phải gõ tay lại ở màn Nhập kho.
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
                <CheckCircle2 className="h-3.5 w-3.5" /> {productCount} sản phẩm
              </Badge>
              {unitCount > 0 && (
                <Badge variant="default" className="gap-1">
                  {unitCount} đơn vị quy đổi
                </Badge>
              )}
              {errorRows.length > 0 && (
                <Badge variant="danger" className="gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> {errorRows.length} dòng BỊ BỎ
                </Badge>
              )}
              {warnRows.length > 0 && (
                <Badge variant="warning" className="gap-1">
                  {warnRows.length} dòng thiếu thông tin (vẫn nhập)
                </Badge>
              )}
              {orphanCount > 0 && (
                <Badge variant="warning" className="gap-1">
                  {orphanCount} quy đổi không có SP cha
                </Badge>
              )}
              {openingRowCount > 0 && (
                <Badge variant="default" className="gap-1">
                  {openingRowCount} mặt hàng có tồn đầu kỳ
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {validRows.length} dòng hợp lệ → {productCount} sản phẩm + {unitCount} ĐV quy đổi. SKU trùng sẽ bị bỏ qua.
              </span>
            </div>

            {/* Tồn kho đầu kỳ — chỉ hiện khi file thật sự có cột tồn. */}
            {openingRowCount > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Tồn kho đầu kỳ</p>
                    <p className="text-xs text-muted-foreground">
                      Sẽ tạo thêm <strong>1 phiếu nhập kho</strong> cho {openingRowCount} mặt hàng,
                      trị giá {formatCurrency(openingValue)} theo cột &quot;Giá vốn&quot; trong file.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Ngày chốt sổ
                    </Label>
                    <Input
                      type="date"
                      value={openingDate}
                      onChange={(e) => setOpeningDate(e.target.value)}
                      className="h-9 w-[160px]"
                    />
                  </div>
                </div>
                {/* Ngày này đi thẳng vào sổ kho, nên phải nói rõ nó làm gì. */}
                <p className="text-[11px] text-muted-foreground">
                  Phiếu ghi vào ngày này, không phải hôm nay — chọn đúng ngày chốt sổ của phần mềm cũ
                  thì báo cáo nhập xuất tồn mới khớp.
                </p>
                {openingNoCost > 0 && (
                  <p className="text-xs font-semibold text-amber-600">
                    ⚠ {openingNoCost} mặt hàng có tồn nhưng chưa có giá vốn — lãi gộp của số hàng
                    này sẽ tính sai cho tới khi bổ sung.
                  </p>
                )}
                {!canPostStock && (
                  <p className="text-xs font-semibold text-destructive">
                    ⚠ Tài khoản này nhập được danh mục nhưng không ghi được kho — chỉ chủ NPP mới
                    tạo được phiếu tồn đầu kỳ. Sản phẩm vẫn nhập bình thường.
                  </p>
                )}
                {grouped.droppedOpeningQtyRows > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {grouped.droppedOpeningQtyRows} dòng đơn vị quy đổi cũng ghi tồn — đã bỏ, vì đó
                    là cùng lô hàng đếm theo đơn vị khác.
                  </p>
                )}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border bg-card max-h-[40vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium w-8">#</th>
                    <th className="px-2 py-2 text-left font-medium">Tên</th>
                    <th className="px-2 py-2 text-left font-medium">ĐVT</th>
                    <th className="px-2 py-2 text-left font-medium">NCC</th>
                    <th className="px-2 py-2 text-right font-medium">Giá vốn</th>
                    <th className="px-2 py-2 text-right font-medium">Giá bán</th>
                    <th className="px-2 py-2 text-right font-medium">Tồn ĐK</th>
                    <th className="px-2 py-2 text-left font-medium">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, idx) => {
                    const ok = r.errors.length === 0
                    const isUnit = ok && !!r.parent_sku
                    return (
                      <tr key={idx} className={!ok ? "bg-destructive/5" : isUnit ? "bg-muted/20" : ""}>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-2 py-1.5 font-medium truncate max-w-[180px]">
                          {r.name || "—"}
                          {isUnit && (
                            <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">↳ quy đổi</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{r.base_unit || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.supplier_name || "—"}</td>
                        {/* Giá vốn 0 mà dòng có tồn thì tô vàng: đó là lô
                            hàng sắp vào kho không mang theo giá nào. */}
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums${
                            ok && !isUnit && r.opening_qty > 0 && r.cost_price <= 0
                              ? " font-semibold text-amber-600"
                              : ""
                          }`}
                        >
                          {r.cost_price ? formatCurrency(r.cost_price) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.sell_price ? formatCurrency(r.sell_price) : "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {isUnit && r.opening_qty > 0 ? (
                            <span className="text-muted-foreground line-through">{r.opening_qty}</span>
                          ) : r.opening_qty > 0 ? (
                            r.opening_qty
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {!ok ? (
                            <span className="text-xs text-destructive">{r.errors.join("; ")}</span>
                          ) : isUnit ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              1 {r.base_unit} = {r.conversion} của {r.parent_sku}
                            </span>
                          ) : r.warnings.length > 0 ? (
                            <span className="text-xs text-amber-600">{r.warnings.join("; ")}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-tertiary">
                              <CheckCircle2 className="h-3 w-3" />
                              {r.secondary_unit ? `1 ${r.secondary_unit} = ${r.conversion} ${r.base_unit}` : "OK"}
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
              <p className="text-xs text-muted-foreground">Hiển thị 100/{rows.length} dòng đầu. Tất cả dòng hợp lệ vẫn được nhập.</p>
            )}
          </div>
        )}

        {/* Action */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={importing}>
            Huỷ
          </Button>
          <Button onClick={handleImport} disabled={importing || productCount === 0}>
            {importing ? "Đang nhập..." : `Nhập ${productCount} sản phẩm`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
