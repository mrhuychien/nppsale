"use client"

/**
 * T-09: "Tồn kho hiện tại" balance table.
 *
 * Reads `v_stock_balance_by_zone` and pivots to a wide table:
 *   Mã SP | Tên SP | Kho bán SL+Giá trị | Kho date SL+Giá trị | Tổng
 *
 * Click a row → opens StockHistoryDrawer for that product. Search +
 * "chỉ hiện hàng còn tồn" filter at the top.
 *
 * ⚠ HAI ĐƯỜNG ĐỌC (chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → đợt 4): sổ có RPC `ton_kho_trang` (mig 255) thì máy
 *   chủ gộp + lọc + tìm + sắp + chia trang, máy chỉ nhận trang đang xem kèm TỔNG CỘNG của cả tập đã lọc; sổ chưa có
 *   (PGRST202) thì lùi về cách cũ: đọc đủ hai bảng, gộp / lọc / chia trang trên máy (`gopTonTheoSanPham`).
 */

import { duocXuatFile } from "@/lib/permissions"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { Check, ArrowUpDown, Download, FileSpreadsheet, Search } from "lucide-react"
import { xemDuocGiaVon } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { nhanSapXep, sapXepKeTiep, sapXepTon, type SapXepTon } from "@/lib/inventory/kho-hang-mobile"
import { StockHistoryDrawer } from "@/components/inventory/stock-history-drawer"
import { buildStockExportAoa, stockExportFileName } from "@/lib/inventory/stock-export"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { chuaCoRpc } from "@/lib/supabase/chua-co-rpc"
import { ghepTrang } from "@/lib/list/ghep-trang"
import { TONG_RONG, docTatCaTon, docTrangTon, type DongTon, type TongTon } from "@/lib/inventory/ton-kho-trang"

/** Số dòng mỗi lần "Xem thêm" trên điện thoại — như mẫu "đang hiện 20/257"; đường RPC cũng đọc từng trang này. */
const BUOC_HIEN = 20

interface BalanceRow {
  product_id: string
  warehouse_zone: "sale" | "date"
  qty_in_base_uom: number
  value: number
}

interface ProductUnitMeta {
  unit_name: string
  conversion: number
}

interface ProductMeta {
  id: string
  sku: string
  name: string
  base_unit: string
  units?: ProductUnitMeta[]
  /** `active` / ngừng bán… — mã ngừng bán chỉ lên bảng khi còn tồn. */
  status?: string | null
}

/** Build a tooltip showing the qty in every defined unit, e.g.:
 *    400 hộp = 40 thùng = 80 lốc
 *  Falls back to "X <base_unit>" when no other units are registered. */
function buildQtyTooltip(qtyBase: number, product: ProductMeta): string {
  if (qtyBase <= 0) return `0 ${product.base_unit}`
  const baseStr = `${qtyBase.toLocaleString("vi-VN")} ${product.base_unit}`
  const units = (product.units || [])
    .filter((u) => u.unit_name !== product.base_unit && u.conversion > 0)
    .sort((a, b) => b.conversion - a.conversion)
  const extras = units
    .map((u) => {
      const qty = qtyBase / u.conversion
      // Use up to 2 decimals for non-integer conversions, drop trailing zeros.
      const display = Number.isInteger(qty)
        ? qty.toLocaleString("vi-VN")
        : Number(qty.toFixed(2)).toLocaleString("vi-VN")
      return `${display} ${u.unit_name}`
    })
    .filter((s) => !s.startsWith("0 "))
  return [baseStr, ...extras].join(" = ")
}

export interface PivotRow {
  product: ProductMeta
  saleQty: number
  saleValue: number
  dateQty: number
  dateValue: number
  totalQty: number
  totalValue: number
}

/**
 * Gộp tồn theo kho thành một dòng / mặt hàng.
 *
 * ⚠ MÃ NGỪNG BÁN VẪN CÒN TỒN PHẢI LÊN BẢNG (rà soát 03/10/2026). Bản cũ chỉ đọc
 *   `products.status = 'active'`, nên mã đã ngừng bán mà kho còn hàng bị bỏ qua lặng lẽ
 *   (`if (!product) continue`) — hàng có thật, có giá trị, mà bảng tồn và file Excel không
 *   có dòng nào; tổng giá trị tồn cũng thiếu đúng phần ấy. Nay đọc MỌI mã; mã ngừng bán chỉ
 *   hiện khi có tồn khác 0, còn "hiện cả mã hết tồn" vẫn chỉ thêm mã ĐANG BÁN như trước.
 */
export function gopTonTheoSanPham(
  rows: readonly BalanceRow[],
  products: ReadonlyMap<string, ProductMeta>,
  onlyOnHand: boolean
): PivotRow[] {
  const dangBan = (p: ProductMeta) => (p.status ?? "active") === "active"
  const map = new Map<string, PivotRow>()
  for (const r of rows) {
    const product = products.get(r.product_id)
    if (!product) continue
    const existing =
      map.get(r.product_id) ?? {
        product,
        saleQty: 0,
        saleValue: 0,
        dateQty: 0,
        dateValue: 0,
        totalQty: 0,
        totalValue: 0,
      }
    const qty = Number(r.qty_in_base_uom || 0)
    const val = Number(r.value || 0)
    if (r.warehouse_zone === "date") {
      existing.dateQty += qty
      existing.dateValue += val
    } else {
      existing.saleQty += qty
      existing.saleValue += val
    }
    existing.totalQty += qty
    existing.totalValue += val
    map.set(r.product_id, existing)
  }
  // Mã ngừng bán mà hết tồn: không phải hàng để xem ở bảng tồn.
  map.forEach((v, id) => {
    if (!dangBan(v.product) && v.saleQty === 0 && v.dateQty === 0) map.delete(id)
  })
  // Include products with zero balance so the search can find them (chỉ mã đang bán).
  products.forEach((p) => {
    if (!map.has(p.id) && !onlyOnHand && dangBan(p)) {
      map.set(p.id, {
        product: p,
        saleQty: 0,
        saleValue: 0,
        dateQty: 0,
        dateValue: 0,
        totalQty: 0,
        totalValue: 0,
      })
    }
  })
  let arr = Array.from(map.values())
  if (onlyOnHand) arr = arr.filter((r) => r.totalQty > 0)
  return arr
}

export function StockBalanceTable({
  dienThoai = false,
  dauMuc,
}: {
  /** Màn Kho hàng trên điện thoại (thiết kế 30/09/2026): danh sách dòng thay cho bảng. */
  dienThoai?: boolean
  /** Đầu mục "Tồn kho" của màn điện thoại — nhận nút Xuất Excel (null khi không được xuất). */
  dauMuc?: (nutXuat: ReactNode) => ReactNode
} = {}) {
  const { user } = useAuth()
  const [rows, setRows] = useState<BalanceRow[]>([])
  const [products, setProducts] = useState<Map<string, ProductMeta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [onlyOnHand, setOnlyOnHand] = useState(true)
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Lỗi/thiếu dữ liệu của chính bảng này — phải hiện ra, vì một bảng
  // thiếu dòng trông y hệt một bảng đủ dòng.
  const [loadError, setLoadError] = useState<string | null>(null)
  const pg = usePagination()

  /* ⚠ HAI ĐƯỜNG ĐỌC (xem đầu tệp): `rpc` true = máy chủ chia trang (`trang` là trang đang xem — điện thoại: các trang đã
     nối), `tongSo` / `tongCong` là số dòng + tổng cộng của CẢ tập đã lọc; `rpc` false = đường cũ (rows / products). */
  const cheDo = useRef<"rpc" | "cu" | null>(null)
  const [rpc, setRpc] = useState<boolean | null>(null)
  const [trang, setTrang] = useState<DongTon[]>([])
  const [tongSo, setTongSo] = useState(0)
  const [tongCong, setTongCong] = useState<TongTon>(TONG_RONG)
  const [sapXep, setSapXep] = useState<SapXepTon>("ten")
  const [dangThem, setDangThem] = useState(false)
  /* Ô tìm hỏi máy chủ sau khi NGỪNG gõ 300 ms — không một câu mỗi phím. */
  const [timTre, setTimTre] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setTimTre(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  /* ---------------- Đường cũ: sổ chưa có RPC mig 255 — đọc đủ, gộp trên máy ---------------- */
  const taiCachCu = useCallback((supabase: ReturnType<typeof createClient>, huy: () => boolean) => {
    // ⚠ PHẢI PHÂN TRANG CẢ HAI. Supabase chặn 1.000 dòng mỗi request và
    // trả 200 KHÔNG kèm lỗi.
    //
    // Với 1.740 sản phẩm thì truy vấn `products` chỉ về 1.000 dòng, và ở
    // phần gộp dưới đây mỗi dòng tồn không tra ra sản phẩm bị BỎ QUA
    // LẶNG LẼ (`if (!product) continue`). Hậu quả đã gặp: nhập 40 sản
    // phẩm, phiếu nhập kho có, lô hàng có, mà bảng tồn kho không hiện
    // dòng nào của chúng — vì chính 40 mã mới nhất nằm ngoài 1.000 dòng
    // đầu.
    //
    // Cùng cái bẫy với thẻ KPI đầu trang Kho và với phép đối chiếu mã
    // trùng lúc nhập sản phẩm. Ở đâu cộng hay gộp trên TOÀN BỘ bảng thì ở
    // đó phải đọc đủ.
    Promise.all([
      fetchAllForAggregate<BalanceRow>((from, to) =>
        supabase
          .from("v_stock_balance_by_zone")
          .select("product_id, warehouse_zone, qty_in_base_uom, value", { count: "exact" })
          // ⚠ VIEW GROUP BY KHÔNG CÓ THỨ TỰ CỐ ĐỊNH. `fetchAllForAggregate`
          // gọi các trang SONG SONG; không `.order()` thì Postgres được phép
          // trả mỗi trang một thứ tự (nhất là khi `batches` đang bị ghi) —
          // dòng tồn lặp hoặc sót. Khoá của view là (org_id, product_id,
          // warehouse_zone) — đúng cột GROUP BY (mig 107) — nên xếp theo đủ
          // bộ ba ấy là duy nhất.
          .order("org_id")
          .order("product_id")
          .order("warehouse_zone")
          .range(from, to)
      ),
      fetchAllForAggregate<ProductMeta>((from, to) =>
        supabase
          .from("products")
          .select("id, sku, name, base_unit, status, units:product_units(unit_name, conversion)", {
            count: "exact",
          })
          // ⚠ KHÔNG lọc `status = 'active'`: mã ngừng bán còn tồn vẫn phải lên bảng —
          // xem `gopTonTheoSanPham`.
          // ⚠ Mốc `id` duy nhất — cùng lý do với truy vấn trên.
          .order("id")
          .range(from, to)
      ),
    ]).then(([balRes, prodRes]) => {
      if (huy()) return
      // View v_stock_balance_by_zone chạy security_invoker (mig 092) nên
      // chịu RLS. View luôn trả 200 kể cả khi bị chặn → không có lỗi để
      // hiện; giữ lỗi lại để MÀN HÌNH nói ra, đừng chỉ ghi console.
      const vErr = balRes.error || prodRes.error
      if (vErr) console.error("[stock-balance-table] truy vấn lỗi:", vErr)
      setLoadError(
        vErr
          ? `Không đọc được số liệu tồn kho: ${vErr}`
          : balRes.truncated || prodRes.truncated
            ? "Danh mục quá lớn để đọc hết trong một lần — bảng dưới đây còn THIẾU dòng."
            : null
      )
      setRows(balRes.rows)
      const map = new Map<string, ProductMeta>()
      prodRes.rows.forEach((p) => map.set(p.id, p))
      setProducts(map)
      setLoading(false)
    })
  }, [])

  /* ---------------- Đường RPC: trang đang xem (máy tính: theo thanh trang; điện thoại: 20 dòng đầu + "Xem thêm") ---------------- */
  useEffect(() => {
    if (!user?.org_id) return
    /* Đường cũ đã đọc đủ một lần — lọc / tìm / sắp / chia trang trên máy, không hỏi lại. */
    if (cheDo.current === "cu") return
    let cancelled = false
    const supabase = createClient()
    setLoading(true)
    setLoadError(null)
    docTrangTon(supabase, {
      tim: timTre,
      conTon: onlyOnHand,
      sapXep: dienThoai ? sapXep : "ten",
      offset: dienThoai ? 0 : pg.from,
      limit: dienThoai ? BUOC_HIEN : pg.pageSize,
    })
      .then((kq) => {
        if (cancelled) return
        cheDo.current = "rpc"
        setRpc(true)
        setTrang(kq.rows)
        setTongSo(kq.tong ?? 0)
        setTongCong(kq.tongCong ?? TONG_RONG)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        if (cheDo.current === null && chuaCoRpc(err)) {
          cheDo.current = "cu"
          setRpc(false)
          taiCachCu(supabase, () => cancelled)
          return
        }
        setLoadError(`Không đọc được số liệu tồn kho: ${errorMessage(err)}`)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.org_id, timTre, onlyOnHand, sapXep, dienThoai, pg.from, pg.pageSize, taiCachCu])

  /* Điện thoại, đường RPC: "Xem thêm" nối trang kế từ máy chủ (không lặp mã khi ranh giới trang dịch). */
  const themTrang = useCallback(async () => {
    setDangThem(true)
    try {
      const kq = await docTrangTon(createClient(), { tim: timTre, conTon: onlyOnHand, sapXep, offset: trang.length, limit: BUOC_HIEN })
      setTrang((cu) => ghepTrang(cu, kq.rows, (r) => r.product.id))
      if (kq.tong != null) setTongSo(kq.tong)
    } catch (err) {
      setLoadError(`Không đọc được số liệu tồn kho: ${errorMessage(err)}`)
    }
    setDangThem(false)
  }, [timTre, onlyOnHand, sapXep, trang.length])

  const pivot = useMemo<PivotRow[]>(() => {
    /* Đường RPC: máy chủ đã lọc / tìm / sắp — `trang` là trang đang xem. */
    if (rpc) return trang
    let arr = gopTonTheoSanPham(rows, products, onlyOnHand)
    if (search.trim()) {
      arr = arr.filter((r) => viMatchAllWords(search, r.product.sku, r.product.name))
    }
    return arr.sort((a, b) => a.product.name.localeCompare(b.product.name, "vi"))
  }, [rpc, trang, rows, products, search, onlyOnHand])
  /** Số dòng của CẢ tập đã lọc — đường RPC là tổng máy chủ đếm, đường cũ là số dòng gộp trên máy. */
  const soDong = rpc ? tongSo : pivot.length

  /**
   * ⚠ CHIA TRANG CHỈ Ở PHẦN VẼ, KHÔNG Ở PHẦN ĐỌC.
   *
   * Đọc phải ĐỦ: dòng "N sản phẩm — tổng giá trị X", dòng Tổng cộng cuối
   * bảng, ô tìm kiếm và nút Xuất Excel đều chạy trên TOÀN BỘ danh sách đã
   * lọc. Chia trang ở tầng truy vấn thì bốn thứ đó chỉ còn đúng cho một
   * trang — mà một con số tiền đúng cho một trang thì là con số sai.
   *
   * Cái phải chia là số dòng ĐƯA RA MÀN HÌNH: vẽ 1.700 dòng một lúc thì
   * trình duyệt ì, cuộn giật, và trên điện thoại thì gần như không dùng
   * được.
   */
  const pageRows = useMemo(
    () => (rpc ? pivot : pivot.slice(pg.from, pg.from + pg.pageSize)),
    [rpc, pivot, pg.from, pg.pageSize]
  )

  // Tổng số dòng để thanh phân trang biết có bao nhiêu trang (đường RPC: tổng máy chủ đếm).
  useEffect(() => {
    pg.setTotal(soDong)
  }, [soDong]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lọc hay tìm kiếm đổi thì về trang 1 — đứng ở trang 12 của kết quả cũ
  // rồi lọc còn 3 dòng thì màn hình trống trơn mà không hiểu vì sao.
  useEffect(() => {
    pg.reset()
  }, [search, onlyOnHand]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    /* Đường RPC: tổng cộng của CẢ tập đã lọc, máy chủ tính trước khi cắt trang — không phải tổng của một trang. */
    if (rpc) return tongCong
    return pivot.reduce(
      (acc, r) => {
        acc.saleQty += r.saleQty
        acc.saleValue += r.saleValue
        acc.dateQty += r.dateQty
        acc.dateValue += r.dateValue
        acc.totalQty += r.totalQty
        acc.totalValue += r.totalValue
        return acc
      },
      {
        saleQty: 0,
        saleValue: 0,
        dateQty: 0,
        dateValue: 0,
        totalQty: 0,
        totalValue: 0,
      }
    )
  }, [rpc, tongCong, pivot])

  /**
   * Xuất đúng những dòng ĐANG HIỆN ra Excel.
   *
   * `xlsx` nạp động: nó nặng vài trăm KB và phần lớn người mở trang Kho
   * không bấm nút này lần nào — nhét vào gói chính là bắt mọi người tải
   * cho một người dùng.
   */
  const handleExport = async () => {
    if (soDong === 0) return
    setExporting(true)
    try {
      const XLSX = await import("xlsx")
      /* Đường RPC: xuất ĐÚNG tập đang lọc trên máy chủ (đọc hết các trang), không chỉ trang đang xem. */
      const dong = rpc
        ? await docTatCaTon(createClient(), { tim: timTre, conTon: onlyOnHand, sapXep: dienThoai ? sapXep : "ten" })
        : pivot
      const aoa = buildStockExportAoa(
        dong.map((r) => ({
          sku: r.product.sku,
          name: r.product.name,
          baseUnit: r.product.base_unit,
          saleQty: r.saleQty,
          saleValue: r.saleValue,
          dateQty: r.dateQty,
          dateValue: r.dateValue,
          totalQty: r.totalQty,
          totalValue: r.totalValue,
        }))
      )
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws["!cols"] = [
        { wch: 12 }, { wch: 46 }, { wch: 8 },
        { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
        { wch: 12 }, { wch: 18 },
      ]
      // Khoá hàng tiêu đề: bảng vài trăm dòng mà cuộn xuống là quên mất
      // cột nào là kho bán, cột nào là kho date.
      ws["!freeze"] = { xSplit: "0", ySplit: "1" }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Ton kho")
      XLSX.writeFile(wb, stockExportFileName(new Date()))
    } catch (e) {
      // Không nuốt: nút bấm xong không thấy gì thì người dùng bấm tiếp
      // mấy lần rồi tưởng máy treo.
      console.error("[stock-balance-table] xuất Excel lỗi:", e)
      setExportError((e as Error)?.message || "Không xuất được file")
    } finally {
      setExporting(false)
    }
  }

  if (dienThoai) {
    const duocXuat = duocXuatFile(user?.role, "inventory")
    return (
      <TonKhoDienThoai
        rows={pivot}
        tongSo={soDong}
        loading={loading}
        loadError={loadError}
        exportError={exportError}
        search={search}
        onSearch={setSearch}
        onlyOnHand={onlyOnHand}
        onOnlyOnHand={setOnlyOnHand}
        sapXep={sapXep}
        onSapXep={setSapXep}
        onThem={rpc ? themTrang : undefined}
        dangThem={dangThem}
        xemGiaTri={xemDuocGiaVon(user?.role)}
        onOpen={setDrawerProductId}
        dauMuc={dauMuc}
        nutXuat={duocXuat ? (
          <button
            type="button"
            onClick={handleExport}
            disabled={loading || exporting || soDong === 0}
            title={soDong === 0 ? "Không có dòng nào để xuất" : `Xuất ${soDong} dòng đang lọc ra Excel`}
            className="tap inline-flex items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exporting ? "Đang xuất…" : "Xuất Excel"}
          </button>
        ) : null}
        drawer={
          <StockHistoryDrawer
            productId={drawerProductId}
            product={drawerProductId ? pivot.find((r) => r.product.id === drawerProductId)?.product ?? null : null}
            open={!!drawerProductId}
            onOpenChange={(o) => !o && setDrawerProductId(null)}
          />
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {loadError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          ⚠ {loadError}
        </div>
      )}
      {exportError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Không xuất được file Excel: {exportError}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Tìm theo tên / SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={onlyOnHand}
            onCheckedChange={(v) => setOnlyOnHand(!!v)}
          />
          Chỉ hiện hàng còn tồn
        </label>
        {duocXuatFile(user?.role, "inventory") && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={loading || exporting || soDong === 0}
          // Xuất đúng những dòng ĐANG LỌC, không phải toàn bộ kho: người
          // ta lọc rồi mới bấm xuất thì mong nhận đúng phần đã lọc.
          title={
            soDong === 0
              ? "Không có dòng nào để xuất"
              : `Xuất ${soDong} dòng đang lọc ra Excel`
          }
        >
          <Download className="mr-1.5 h-4 w-4" />
          {exporting ? "Đang xuất…" : "Xuất Excel"}
        </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground" data-testid="ton-dem-may-tinh">
          {soDong} sản phẩm — tổng giá trị{" "}
          <strong className="text-foreground">{formatCurrency(totals.totalValue)}</strong>
        </span>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Mã SP</TableHead>
                <TableHead>Tên SP</TableHead>
                <TableHead className="text-right">Kho bán SL</TableHead>
                <TableHead className="text-right">Kho bán Giá trị</TableHead>
                <TableHead className="text-right">Kho date SL</TableHead>
                <TableHead className="text-right">Kho date Giá trị</TableHead>
                <TableHead className="text-right font-semibold">Tổng SL</TableHead>
                <TableHead className="text-right font-semibold">Tổng Giá trị</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                    Không có dữ liệu phù hợp
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((r) => (
                  <TableRow
                    key={r.product.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setDrawerProductId(r.product.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.product.sku}</TableCell>
                    <TableCell className="font-medium">
                      {r.product.name}
                      {(r.product.status ?? "active") !== "active" && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          Ngừng bán
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title={buildQtyTooltip(r.saleQty, r.product)}
                    >
                      {r.saleQty.toLocaleString("vi-VN")}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        {r.product.base_unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.saleValue)}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title={buildQtyTooltip(r.dateQty, r.product)}
                    >
                      {r.dateQty.toLocaleString("vi-VN")}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        {r.product.base_unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.dateValue)}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      title={buildQtyTooltip(r.totalQty, r.product)}
                    >
                      {r.totalQty.toLocaleString("vi-VN")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatCurrency(r.totalValue)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {pivot.length > 0 && (
              <tfoot className="bg-muted/30 font-semibold">
                <tr>
                  <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground" colSpan={2}>
                    Tổng cộng
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.saleQty.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(totals.saleValue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.dateQty.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(totals.dateValue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.totalQty.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(totals.totalValue)}
                  </td>
                </tr>
              </tfoot>
            )}
          </Table>
        </div>
      )}

      {!loading && <DataPagination pg={pg} shownCount={pageRows.length} />}

      <StockHistoryDrawer
        productId={drawerProductId}
        product={
          drawerProductId
            ? pivot.find((r) => r.product.id === drawerProductId)?.product ?? null
            : null
        }
        open={!!drawerProductId}
        onOpenChange={(o) => !o && setDrawerProductId(null)}
      />
    </div>
  )
}

/**
 * Danh sách tồn trên điện thoại: ô tìm, chip Còn tồn / Sắp xếp, dòng tên · SKU · SL cơ sở · giá trị.
 * `onThem` có = đường RPC: `rows` là các trang máy chủ đã sắp + nối, `tongSo` là tổng máy chủ đếm, "Xem thêm" hỏi trang kế;
 * không có = đường cũ: sắp + cắt từng 20 dòng trên máy.
 */
function TonKhoDienThoai({
  rows, tongSo, loading, loadError, exportError, search, onSearch, onlyOnHand, onOnlyOnHand,
  sapXep, onSapXep, onThem, dangThem, xemGiaTri, onOpen, dauMuc, nutXuat, drawer,
}: {
  rows: PivotRow[]
  tongSo: number
  loading: boolean
  loadError: string | null
  exportError: string | null
  search: string
  onSearch: (s: string) => void
  onlyOnHand: boolean
  onOnlyOnHand: (v: boolean) => void
  sapXep: SapXepTon
  onSapXep: (k: SapXepTon) => void
  onThem?: () => void
  dangThem: boolean
  xemGiaTri: boolean
  onOpen: (id: string) => void
  dauMuc?: (nutXuat: ReactNode) => ReactNode
  nutXuat: ReactNode
  drawer: ReactNode
}) {
  const [soHien, setSoHien] = useState(BUOC_HIEN)
  useEffect(() => { setSoHien(BUOC_HIEN) }, [search, onlyOnHand, sapXep])
  const daSap = useMemo(() => (onThem ? rows : sapXepTon(rows, sapXep)), [rows, sapXep, onThem])
  const hien = onThem ? daSap : daSap.slice(0, soHien)
  const tongHien = onThem ? tongSo : daSap.length

  return (
    <div className="space-y-3" data-testid="ton-kho-dien-thoai">
      {dauMuc?.(nutXuat)}
      {loadError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">⚠ {loadError}</div>
      )}
      {exportError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Không xuất được file Excel: {exportError}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Tìm theo tên hoặc mã SKU"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-11 rounded-xl bg-card pl-9 text-base"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={onlyOnHand}
          onClick={() => onOnlyOnHand(!onlyOnHand)}
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-[13px] font-semibold",
            onlyOnHand ? "border-primary/40 bg-primary/10 text-primary" : "border-outline-variant bg-card text-on-surface-variant"
          )}
        >
          {onlyOnHand && <Check className="h-3.5 w-3.5" />} Còn tồn
        </button>
        <button
          type="button"
          onClick={() => onSapXep(sapXepKeTiep(sapXep))}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-outline-variant bg-card px-3 text-[13px] font-semibold text-on-surface"
        >
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" /> Sắp xếp: {nhanSapXep(sapXep)}
        </button>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground" data-testid="ton-dem-sku">{tongSo} SKU</span>
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Không có mặt hàng phù hợp{search ? " — thử bỏ bớt chữ tìm" : ""}.
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {hien.map((r) => (
            <li key={r.product.id}>
              <button
                type="button"
                onClick={() => onOpen(r.product.id)}
                className="flex w-full items-start gap-3 px-3.5 py-3 text-left active:bg-muted/40"
                data-testid="dong-ton"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-on-surface">{r.product.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{r.product.sku}</p>
                </div>
                <div className="shrink-0 text-right" title={buildQtyTooltip(r.totalQty, r.product)}>
                  <p className="text-sm tabular-nums">
                    <span className="font-bold">{r.totalQty.toLocaleString("vi-VN")}</span>{" "}
                    <span className="text-xs text-muted-foreground">{r.product.base_unit}</span>
                  </p>
                  {xemGiaTri && <p className="text-xs tabular-nums text-on-surface-variant">{formatCurrency(r.totalValue)}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && hien.length < tongHien && (
        <button
          type="button"
          onClick={() => (onThem ? onThem() : setSoHien((n) => n + BUOC_HIEN))}
          disabled={dangThem}
          className="h-12 w-full rounded-2xl border bg-card text-sm font-semibold text-primary disabled:opacity-50"
        >
          {dangThem ? "Đang tải…" : `Xem thêm · đang hiện ${hien.length}/${tongHien}`}
        </button>
      )}
      {drawer}
    </div>
  )
}
