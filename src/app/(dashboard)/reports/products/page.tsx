"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { viMatchAllWords } from "@/lib/search"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useLuotNap } from "@/hooks/use-luot-nap"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { locBienThe } from "@/lib/permissions"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ReportShell,
  FilterCheckbox,
  FilterField,
  FilterMultiSelect,
} from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  fetchRevenueInvoicesDu,
  fetchInvoiceLines,
  fetchReturnsRowsDu,
  fetchReturnLines,
  fetchReturnCosts,
  fetchStockEntryLines,
  fetchPostedStockEntries,
  locPhieuXuatBan,
  fetchOrgRows,
  soLuongCoSoDongHd,
  soLuongCoSoDongTra,
  soLuongCoSoDongKho,
  giaTriDongKho,
  COT_SP_QUY_DOI,
  type InvoiceLineRow,
  type RevenueInvoiceRow,
  type ReturnLineRow,
  type StockEntryLineRow,
} from "@/lib/analytics/sales"
import type { SanPhamQuyDoi } from "@/lib/analytics/units"
import { congSL, hienSLTheoDonVi, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { napBienDong, tinhXnt, type BienDong } from "@/lib/bao-cao/nap-kho"
import { docSoBanKy } from "@/lib/bao-cao/nap-ban-hang"
import { baoNapSauKhiVe } from "@/lib/pos/bao-nap"
import { errorMessage } from "@/lib/errors"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { SalesByProductView, type SalesByProductRow } from "./_views/sales-by-product"
import { ProfitByProductView, type ProfitByProductRow } from "./_views/profit-by-product"
import { StockValueView, type StockValueRow } from "./_views/stock-value"
import { StockMovementView, type StockMovementRow } from "./_views/stock-movement"

type Variant = "sales" | "profit" | "stock_value" | "movement" | "movement_detail"

/** Khoá dòng gộp của mặt hàng chưa gán NCC (khi "Gộp theo nhà cung cấp"). */
const CHUA_GAN_NCC = "__chua_gan_ncc__"

const VARIANTS = [
  { key: "sales" as const, label: "Bán hàng" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "stock_value" as const, label: "Giá trị kho" },
  { key: "movement" as const, label: "Xuất nhập tồn" },
  { key: "movement_detail" as const, label: "Xuất nhập tồn chi tiết" },
] as const

/** Mặt hàng kèm đơn vị quy đổi (`COT_SP_QUY_DOI`) — SL cộng dồn quy về đơn vị cơ sở. */
interface ProductRow extends SanPhamQuyDoi {
  id: string
  sku: string
  name: string
  brand?: string | null
  base_unit: string
  primary_supplier_id?: string | null
}

interface SupplierRow {
  id: string
  name: string
}

interface BatchRow {
  id: string
  product_id: string
  qty_on_hand: number
  unit_cost: number
}

interface StockEntry {
  id: string
  type: "import" | "export" | "stocktake" | "transfer"
  status: string
  posted_at: string | null
  entry_code: string
}

interface CustomerRow {
  id: string
  store_name: string
}

export default function ProductsReportPage() {
  const { user: nguoiXem, loading: authLoading } = useRoleGuard("reports")
  /* ⚠ Chủ nhà 25/09/2026: NVBH không xem giá vốn / lãi / giá trị kho của NPP. */
  const bienThe = locBienThe(nguoiXem?.role, VARIANTS)
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("sales")
  const [preset, setPreset] = useState<PeriodPreset>("this_week")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_week"))
  const [groupSameType, setGroupSameType] = useState(false)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  // Hóa đơn ĐÃ GHI SỔ trong kỳ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  const [invoices, setInvoices] = useState<RevenueInvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  /** Giá vốn hàng trả ĐÃ NHẬP LẠI KHO theo mặt hàng — trừ giá vốn ở màn Lợi nhuận. */
  const [returnCostByProduct, setReturnCostByProduct] = useState<Map<string, number>>(() => new Map())
  const [products, setProducts] = useState<ProductRow[]>([])
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLineRow[]>([])
  /** Phiếu XUẤT BÁN của kỳ (bỏ phiếu đảo phiếu trả, phiếu của HĐ đã huỷ) — chỉ chúng mới vào giá vốn. */
  const [phieuXuatBan, setPhieuXuatBan] = useState<Set<string>>(() => new Set())
  /** Biến động kho (có dấu) từ đầu kỳ tới nay — tồn đầu / tồn cuối THEO KỲ của Xuất – nhập – tồn. */
  const [bienDong, setBienDong] = useState<BienDong[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [supplierFilter, setSupplierFilter] = useState<string[]>([])
  const [productFilter, setProductFilter] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  /* ⚠ Đã BỎ ô "Bảng giá / Nhóm khách" (rà báo cáo 09/10/2026): chọn được mà không tab nào dùng tới — số không đổi,
     người xem tưởng đã lọc. Như Báo cáo tổng hợp (chủ nhà 27/09/2026 bỏ lọc Nhóm khách / Bảng giá). */
  const catalogs = useFilterCatalogs(user?.org_id)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  /** Giá vốn xuất theo mặt hàng do hàm máy chủ gộp sẵn; `null` = đường đọc từng bảng (cộng từ dòng phiếu xuất bán). */
  const [giaVonTheoSpMotLuot, setGiaVonTheoSpMotLuot] = useState<Map<string, number> | null>(null)
  /** Phần KHO đã đọc chưa — lô tồn (Giá trị kho, XNT) · phiếu kho + dòng + biến động (XNT). Đường một lượt đọc khi mở tab ấy. */
  const [loDaNap, setLoDaNap] = useState(false)
  const [xntDaNap, setXntDaNap] = useState(false)

  /* ⚠ LÔ CÒN HÀNG. Lô đã hết vẫn nằm trong bảng mãi mãi; đọc cả chúng thì trần 1.000 dòng cạn nhanh gấp mấy lần, mà giá
     trị kho và tồn cuối của chúng đều là 0. */
  const docLoTon = useCallback(
    (orgId: string) =>
      docDuHoacNem<BatchRow>(
        (from, to) =>
          supabase
            .from("batches")
            .select("id, product_id, qty_on_hand, unit_cost", { count: "exact" })
            .eq("org_id", orgId)
            .gt("qty_on_hand", 0)
            .order("id")
            .range(from, to),
        "đọc lô tồn kho"
      ),
    [supabase]
  )

  const batLuot = useLuotNap()
  const load = useCallback(async () => {
    if (!user?.org_id) return
    const conMoi = batLuot()
    /**
     * ⚠ MỌI BẢNG ĐỀU ĐỌC ĐỦ, HỎNG THÌ NÉM. Bản cũ đọc mặt hàng, lô, phiếu
     *   kho trần (cắt ở 1.000 dòng) và `.in(...)` cả danh sách id phiếu
     *   trả / phiếu kho (URL quá dài) — lỗi chỉ `console.error`. Mặt hàng
     *   thứ 1.001 không có trong map thì mọi view `if (!p) continue` bỏ
     *   luôn doanh số và giá vốn của nó, không một dấu vết.
     */
    const batDau = typeof performance !== "undefined" ? performance.now() : 0
    let loiNap: string | null = null
    let soHd = 0
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      /* ⚠ MỘT LƯỢT (chủ nhà 03/11/2026: "chuyển nốt các báo cáo cũ đi em"): số bán cả kỳ + giá vốn xuất theo mặt hàng qua
         `bao_cao_so_ban` CÙNG ĐỢT với danh mục. Phần KHO (lô tồn, phiếu kho, biến động) chỉ các tab kho cần — đọc khi mở
         tab ấy (`canLo` / `canXnt`). Sổ chưa có hàm (`null`) → đọc từng bảng như cũ, mọi thứ một lúc. */
      const [mot, productsRes, customersRes, suppliersRes] = await Promise.all([
        docSoBanKy(supabase, range),
        fetchOrgRows<ProductRow>(
          supabase, "products", orgId,
          `id, sku, name, brand, base_unit, sell_price, primary_supplier_id, ${COT_SP_QUY_DOI}`, "đọc mặt hàng"
        ),
        fetchOrgRows<CustomerRow>(supabase, "customers", orgId, "id, store_name", "đọc khách hàng"),
        fetchOrgRows<SupplierRow>(supabase, "suppliers", orgId, "id, name", "đọc nhà cung cấp"),
      ])
      if (conMoi()) setProducts(productsRes.rows)
      if (conMoi()) setCustomers(customersRes.rows)
      if (conMoi()) setSuppliers(suppliersRes.rows.slice().sort((x, y) => x.name.localeCompare(y.name, "vi")))
      const tranDanhMuc = productsRes.truncated || customersRes.truncated || suppliersRes.truncated

      if (mot) {
        soHd = mot.hd.length
        const costByProduct = new Map<string, number>()
        mot.giaVonTra.forEach((c) => {
          c.byProduct.forEach((v, pid) => costByProduct.set(pid, (costByProduct.get(pid) ?? 0) + v))
        })
        if (conMoi()) setTruncated(tranDanhMuc)
        if (conMoi()) setInvoices(mot.hd)
        if (conMoi()) setLines(mot.dongHd)
        if (conMoi()) setReturnLines(mot.dongTra)
        if (conMoi()) setReturnCostByProduct(costByProduct)
        if (conMoi()) setGiaVonTheoSpMotLuot(mot.giaVonTheoSp)
        if (conMoi()) setLoDaNap(false)
        if (conMoi()) setXntDaNap(false)
        return
      }

      const [invoiceRes, batchesRes, returnsRes, entriesRes, bienDongRes] = await Promise.all([
        fetchRevenueInvoicesDu(supabase, orgId, range),
        docLoTon(orgId),
        fetchReturnsRowsDu(supabase, orgId, range),
        fetchPostedStockEntries(supabase, orgId, range, null),
        napBienDong(supabase, orgId, range.from),
      ])

      const returnIds = returnsRes.rows.map((r) => r.id)
      const [lineList, returnLineList, stockLineList, returnCosts, xuatBan] = await Promise.all([
        fetchInvoiceLines(supabase, invoiceRes.rows.map((o) => o.id)),
        fetchReturnLines(supabase, returnIds),
        fetchStockEntryLines(supabase, entriesRes.rows.map((e) => e.id)),
        fetchReturnCosts(supabase, returnIds),
        locPhieuXuatBan(supabase, entriesRes.rows),
      ])
      const costByProduct = new Map<string, number>()
      returnCosts.forEach((c) => {
        c.byProduct.forEach((v, pid) => costByProduct.set(pid, (costByProduct.get(pid) ?? 0) + v))
      })

      soHd = invoiceRes.rows.length
      if (conMoi()) setTruncated(
        tranDanhMuc || invoiceRes.truncated || batchesRes.truncated || returnsRes.truncated || entriesRes.truncated ||
          bienDongRes.thieu
      )
      if (conMoi()) setInvoices(invoiceRes.rows)
      if (conMoi()) setLines(lineList)
      if (conMoi()) setReturnLines(returnLineList)
      if (conMoi()) setReturnCostByProduct(costByProduct)
      if (conMoi()) setGiaVonTheoSpMotLuot(null)
      if (conMoi()) setBatches(batchesRes.rows)
      if (conMoi()) setStockEntries(entriesRes.rows)
      if (conMoi()) setStockLines(stockLineList)
      if (conMoi()) setPhieuXuatBan(new Set(xuatBan.map((e) => e.id)))
      if (conMoi()) setBienDong(bienDongRes.ds)
      if (conMoi()) setLoDaNap(true)
      if (conMoi()) setXntDaNap(true)
    } catch (err) {
      if (conMoi()) setLoadError(errorMessage(err))
      loiNap = errorMessage(err)
    } finally {
      if (conMoi()) setLoading(false)
      if (conMoi()) baoNapSauKhiVe("bc-hang-hoa", batDau, { loi: loiNap, dong: soHd })
    }
  }, [user?.org_id, range, supabase, batLuot, docLoTon])

  useEffect(() => {
    load()
  }, [load])

  /* Đường một lượt: phần KHO đọc khi mở tab cần nó (cách cũ đọc lúc mở trang cho mọi tab). Đổi kỳ / tab giữa chừng → điều
     kiện đổi, lượt đang chạy bỏ kết quả (không đè số kỳ cũ lên kỳ mới). */
  const xemKho = variant === "stock_value" || variant === "movement" || variant === "movement_detail"
  const xemXnt = variant === "movement" || variant === "movement_detail"
  const canLo = !loading && !loadError && !loDaNap && xemKho
  const canXnt = !loading && !loadError && !xntDaNap && xemXnt
  useEffect(() => {
    if (!canLo || !user?.org_id) return
    let bo = false
    docLoTon(user.org_id)
      .then((res) => {
        if (bo) return
        setBatches(res.rows)
        if (res.truncated) setTruncated(true)
        setLoDaNap(true)
      })
      .catch((err) => {
        if (!bo) setLoadError(errorMessage(err))
      })
    return () => {
      bo = true
    }
  }, [canLo, user?.org_id, docLoTon])
  useEffect(() => {
    if (!canXnt || !user?.org_id) return
    let bo = false
    const orgId = user.org_id
    // Xuất – nhập – tồn: MỌI loại phiếu kho của kỳ (không chỉ phiếu xuất bán) + biến động từ đầu kỳ tới nay.
    Promise.all([fetchPostedStockEntries(supabase, orgId, range, null), napBienDong(supabase, orgId, range.from)])
      .then(async ([entriesRes, bienDongRes]) => {
        const dong = await fetchStockEntryLines(supabase, entriesRes.rows.map((e) => e.id))
        if (bo) return
        setStockEntries(entriesRes.rows)
        setStockLines(dong)
        setBienDong(bienDongRes.ds)
        if (entriesRes.truncated || bienDongRes.thieu) setTruncated(true)
        setXntDaNap(true)
      })
      .catch((err) => {
        if (!bo) setLoadError(errorMessage(err))
      })
    return () => {
      bo = true
    }
  }, [canXnt, user?.org_id, range, supabase])

  // §3.2 + filter overhaul — apply ALL catalog-backed filters at the
  // productMap layer; downstream views skip any line/batch whose
  // product isn't in the map.
  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) {
      if (supplierFilter.length && !supplierFilter.includes(p.primary_supplier_id || "")) continue
      if (productFilter.length && !productFilter.includes(p.id)) continue
      const brand = (p as unknown as { brand?: string | null }).brand
      if (brandFilter.length && !brandFilter.includes(brand || "")) continue
      m.set(p.id, p)
    }
    return m
  }, [products, supplierFilter, productFilter, brandFilter])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const orderMap = useMemo(() => {
    const m = new Map<string, { id: string; order_code: string; order_date: string; customer_name: string }>()
    for (const o of invoices) {
      m.set(o.id, {
        id: o.id,
        // Chi tiết theo HÓA ĐƠN: mã và ngày của tờ hóa đơn.
        order_code: o.invoice_code,
        order_date: o.invoice_date,
        customer_name: customerMap.get(o.customer_id)?.store_name || "—",
      })
    }
    return m
  }, [invoices, customerMap])

  const stockEntryMap = useMemo(() => {
    const m = new Map<string, StockEntry>()
    for (const e of stockEntries) m.set(e.id, e)
    return m
  }, [stockEntries])

  const filterFn = useCallback(
    (p: ProductRow) => {
      if (!search) return true
      return viMatchAllWords(search, p.sku, p.name)
    },
    [search]
  )

  /* Tên NCC theo id — cho cột "Nhà cung cấp" và dòng gộp theo NCC. */
  const tenNcc = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])

  /* ⚠ GỘP THEO NHÀ CUNG CẤP, không theo "nhóm hàng" (chủ nhà 03/10/2026, Update 3.10 mục 2: "gộp Nhóm
     hàng vào NCC" → "Bỏ luôn trường nhóm hàng"). Khoá là NCC chính của mặt hàng; chưa gán → một dòng
     "Chưa gán NCC". `products.category` không còn được đọc. */
  const groupKey = useCallback(
    (p: ProductRow): string => {
      if (groupSameType) return p.primary_supplier_id || CHUA_GAN_NCC
      return p.id
    },
    [groupSameType]
  )

  const groupLabel = useCallback(
    (key: string, sample: ProductRow): { sku: string; name: string } => {
      if (groupSameType) {
        return { sku: "NCC", name: key === CHUA_GAN_NCC ? "Chưa gán NCC" : tenNcc.get(key) || "NCC đã xoá" }
      }
      return { sku: sample.sku, name: sample.name }
    },
    [groupSameType, tenNcc]
  )

  /* ⚠ Mỗi bảng chỉ tính khi đang xem mối quan tâm của nó (`if (variant !== …) return …`, `variant` trong mảng phụ thuộc) —
     như Báo cáo › Nhân viên. Xuất Excel cũng chỉ xuất bảng đang xem. */

  // -------------------- Bán hàng --------------------
  const salesRows: SalesByProductRow[] = useMemo(() => {
    if (variant !== "sales") return []
    const m = new Map<string, SalesByProductRow>()
    const moiDongBan = (k: string, lbl: { sku: string; name: string }, p: ProductRow): SalesByProductRow => ({
      id: k, sku: lbl.sku, name: lbl.name, unit: groupSameType ? "" : p.base_unit,
      qty: 0, qtyTheoDv: {}, revenue: 0, returnQty: 0, returnQtyTheoDv: {}, returnValue: 0, netRevenue: 0,
      productIds: [],
    })
    const ghiMatHang = (e: SalesByProductRow, id: string) => { if (!e.productIds.includes(id)) e.productIds.push(id) }
    for (const l of lines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || moiDongBan(k, lbl, p)
      // SL quy về đơn vị cơ sở (ưu tiên hệ số chụp trên dòng hóa đơn).
      const q = soLuongCoSoDongHd(l, p)
      e.qty += q
      // Gộp theo nhóm = nhiều mặt hàng → giữ theo từng đơn vị cơ sở.
      congSL(e.qtyTheoDv, p.base_unit, q)
      e.revenue += Number(l.line_total || 0)
      ghiMatHang(e, p.id)
      m.set(k, e)
    }
    for (const l of returnLines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || moiDongBan(k, lbl, p)
      // Dòng trả không có hệ số chụp → tra danh mục.
      const q = soLuongCoSoDongTra(l, p)
      e.returnQty += q
      congSL(e.returnQtyTheoDv, p.base_unit, q)
      e.returnValue += Number(l.line_total || 0)
      ghiMatHang(e, p.id)
      m.set(k, e)
    }
    return Array.from(m.values())
      .map((r) => ({ ...r, netRevenue: r.revenue - r.returnValue }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [variant, lines, returnLines, productMap, filterFn, groupKey, groupLabel, groupSameType])

  /** Giá vốn xuất của kỳ theo mặt hàng — bản hàm máy chủ gộp sẵn, hoặc cộng từ dòng phiếu xuất bán (đường đọc từng bảng). */
  const giaVonXuatTheoSp = useMemo(() => {
    if (giaVonTheoSpMotLuot) return giaVonTheoSpMotLuot
    /* ⚠ Giá vốn chỉ từ phiếu XUẤT BÁN (`locPhieuXuatBan`, mig 228) — bản cũ lấy mọi phiếu xuất: cả phiếu của HĐ đã huỷ /
       tờ cũ của HĐ đã sửa (hàng đã hoàn kho, không còn doanh thu) → giá vốn cao giả (rà báo cáo 09/10/2026). */
    const exportLines = stockLines.filter((l) => phieuXuatBan.has(l.entry_id))
    const m = new Map<string, number>()
    // SL cơ sở × giá vốn mỗi đơn vị cơ sở.
    for (const l of exportLines) m.set(l.product_id, (m.get(l.product_id) || 0) + giaTriDongKho(l))
    return m
  }, [giaVonTheoSpMotLuot, stockLines, phieuXuatBan])

  // -------------------- Lợi nhuận --------------------
  /**
   * ⚠ SỐ THUẦN = SỐ ĐI − SỐ TRẢ (chủ nhà 25/09/2026: "Rà soát lại toàn bộ doanh số
   *   tính bằng số đi - số trả"). Doanh thu = Σ dòng hóa đơn đã ghi sổ − Σ dòng hàng
   *   trả (không tính hàng đổi) trừ trong kỳ; giá vốn = phiếu xuất − giá vốn hàng trả
   *   đã nhập lại kho (`fetchReturnCosts`). Trừ một vế mà quên vế kia là lãi lệch.
   */
  const profitRows: ProfitByProductRow[] = useMemo(() => {
    if (variant !== "profit") return []
    // Doanh thu & SL từ dòng hóa đơn đã ghi sổ; giá vốn từ phiếu XUẤT BÁN đã ghi sổ (`giaVonXuatTheoSp`).
    const m = new Map<string, ProfitByProductRow>()
    const moiDong = (k: string, p: ProductRow): ProfitByProductRow => {
      const lbl = groupLabel(k, p)
      return { id: k, sku: lbl.sku, name: lbl.name, qty: 0, qtyTheoDv: {}, revenue: 0, cogs: 0, profit: 0, margin: 0 }
    }

    for (const l of lines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const e = m.get(k) || moiDong(k, p)
      const q = soLuongCoSoDongHd(l, p)
      e.qty += q
      congSL(e.qtyTheoDv, p.base_unit, q)
      e.revenue += Number(l.line_total || 0)
      m.set(k, e)
    }
    // Hàng trả trừ doanh thu (dòng không đổi — cùng số với `credit_note_amount`).
    for (const l of returnLines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const e = m.get(k) || moiDong(k, p)
      e.revenue -= Number(l.line_total || 0)
      m.set(k, e)
    }
    giaVonXuatTheoSp.forEach((giaVon, pid) => {
      const p = productMap.get(pid)
      if (!p || !filterFn(p)) return
      const k = groupKey(p)
      const e = m.get(k) || moiDong(k, p)
      e.cogs += giaVon
      m.set(k, e)
    })
    // Giá vốn của chính số hàng trả đã về kho — trừ khỏi giá vốn.
    returnCostByProduct.forEach((cost, pid) => {
      const p = productMap.get(pid)
      if (!p || !filterFn(p)) return
      const k = groupKey(p)
      const e = m.get(k) || moiDong(k, p)
      e.cogs -= cost
      m.set(k, e)
    })
    return Array.from(m.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [variant, lines, returnLines, giaVonXuatTheoSp, returnCostByProduct, productMap, filterFn, groupKey, groupLabel])

  // -------------------- Giá trị kho --------------------
  const stockValueRows: StockValueRow[] = useMemo(() => {
    if (variant !== "stock_value") return []
    const m = new Map<string, StockValueRow & { _qtyAccum: number; _valAccum: number }>()
    for (const b of batches) {
      const p = productMap.get(b.product_id)
      if (!p || !filterFn(p)) continue
      if (Number(b.qty_on_hand || 0) <= 0) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || {
        id: k,
        sku: lbl.sku,
        name: lbl.name,
        ncc: (p.primary_supplier_id && tenNcc.get(p.primary_supplier_id)) || "—",
        qty: 0,
        qtyTheoDv: {},
        unit_cost: 0,
        value: 0,
        batches: 0,
        _qtyAccum: 0,
        _valAccum: 0,
      }
      const q = Number(b.qty_on_hand || 0)
      const c = Number(b.unit_cost || 0)
      e.qty += q
      congSL(e.qtyTheoDv, p.base_unit, q)
      e.value += q * c
      e.batches += 1
      e._qtyAccum += q
      e._valAccum += q * c
      m.set(k, e)
    }
    return Array.from(m.values())
      .map(({ _qtyAccum, _valAccum, ...rest }) => ({
        ...rest,
        /* ⚠ Giá vốn TB chỉ có nghĩa trên MỘT đơn vị cơ sở. Nhóm lẫn hộp + chai thì
           giá trị ÷ SL lẫn đơn vị là số vô nghĩa → `null` ("—"). */
        unit_cost: Object.keys(rest.qtyTheoDv).length === 1 && _qtyAccum > 0 ? _valAccum / _qtyAccum : null,
      }))
      .sort((a, b) => b.value - a.value)
  }, [variant, batches, productMap, filterFn, groupKey, groupLabel, tenNcc])

  // -------------------- Xuất nhập tồn --------------------
  const movementData = useMemo(() => {
    type MR = StockMovementRow & { _id: string }
    if (!xemXnt) return { rows: [] as StockMovementRow[], detail: new Map<string, { date: string; type: "import" | "export" | "stocktake" | "transfer"; doc: string; qty: number; unit: string; unit_cost: number }[]>() }
    const m = new Map<string, MR>()
    const detail = new Map<string, { date: string; type: "import" | "export" | "stocktake" | "transfer"; doc: string; qty: number; unit: string; unit_cost: number }[]>()
    const moiDongXnt = (k: string, lbl: { sku: string; name: string }): MR => ({
      _id: k, id: k, sku: lbl.sku, name: lbl.name,
      beginQty: 0, importQty: 0, importValue: 0, exportQty: 0, exportValue: 0, otherQty: 0, endQty: 0,
      beginTheoDv: {}, importTheoDv: {}, exportTheoDv: {}, otherTheoDv: {}, endTheoDv: {},
    })

    /* ⚠ TỒN ĐẦU / TỒN CUỐI THEO KỲ (`tinhXnt` — một luật với Báo cáo tổng hợp › Kho): tồn cuối = tồn hiện tại lùi các
       biến động SAU cuối kỳ; tồn đầu = tồn cuối lùi các biến động trong kỳ. Bản cũ lấy tồn HIỆN TẠI làm tồn cuối của
       mọi kỳ → xem tháng trước là sai cả hai cột (rà báo cáo 09/10/2026). */
    const tonNay = new Map<string, number>()
    for (const b of batches) tonNay.set(b.product_id, (tonNay.get(b.product_id) || 0) + Number(b.qty_on_hand || 0))
    tinhXnt(tonNay, bienDong, range.from, range.to).forEach((x, sp) => {
      const p = productMap.get(sp)
      if (!p || !filterFn(p)) return
      const k = groupKey(p)
      const e = m.get(k) || moiDongXnt(k, groupLabel(k, p))
      e.beginQty += x.dau
      congSL(e.beginTheoDv, p.base_unit, x.dau)
      e.endQty += x.cuoi
      congSL(e.endTheoDv, p.base_unit, x.cuoi)
      m.set(k, e)
    })

    // import / export within period
    for (const l of stockLines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const entry = stockEntryMap.get(l.entry_id)
      if (!entry) continue
      const e = m.get(k) || moiDongXnt(k, lbl)
      // SL cơ sở — cùng đơn vị với tồn lô (`qty_on_hand`) và `unit_cost`.
      const q = soLuongCoSoDongKho(l)
      const c = Number(l.unit_cost || 0)
      if (entry.type === "import") {
        e.importQty += q
        congSL(e.importTheoDv, p.base_unit, q)
        e.importValue += q * c
      } else if (entry.type === "export") {
        e.exportQty += q
        congSL(e.exportTheoDv, p.base_unit, q)
        e.exportValue += q * c
      }
      m.set(k, e)
      const arr = detail.get(k) || []
      arr.push({
        date: entry.posted_at || "",
        type: entry.type,
        doc: entry.entry_code,
        qty: q,
        unit: p.base_unit || "",
        unit_cost: c,
      })
      detail.set(k, arr)
    }

    // Kiểm kho / chuyển kho trong kỳ = phần còn lại để Đầu + Nhập − Xuất ± Khác = Cuối (không kẹp âm).
    for (const e of Array.from(m.values())) {
      e.otherQty = e.endQty - e.beginQty - e.importQty + e.exportQty
      const dv = new Set([...Object.keys(e.beginTheoDv), ...Object.keys(e.endTheoDv), ...Object.keys(e.importTheoDv), ...Object.keys(e.exportTheoDv)])
      e.otherTheoDv = {}
      for (const u of Array.from(dv)) {
        congSL(e.otherTheoDv, u, (e.endTheoDv[u] || 0) - (e.beginTheoDv[u] || 0) - (e.importTheoDv[u] || 0) + (e.exportTheoDv[u] || 0))
      }
    }

    return {
      rows: Array.from(m.values()).sort((a, b) => b.endQty - a.endQty) as StockMovementRow[],
      detail,
    }
  }, [xemXnt, batches, bienDong, range.from, range.to, stockLines, stockEntryMap, productMap, filterFn, groupKey, groupLabel])

  /** Ô SL khi xuất: một mặt hàng → số; gộp theo nhóm → chuỗi theo đơn vị. */
  const slXuat = (qty: number, theoDv: SLTheoDonVi): string | number => (groupSameType ? hienSLTheoDonVi(theoDv) : qty)

  const handleExport = () => {
    if (variant === "sales") {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "Đơn vị", "SL bán", "Doanh thu", "SL trả", "Giá trị trả", "Doanh thu thuần"],
      ]
      for (const r of salesRows) {
        // Gộp theo nhóm: xuất "640 hộp · 12 chai", không cộng lẫn đơn vị.
        out.push([r.sku, r.name, r.unit, slXuat(r.qty, r.qtyTheoDv), r.revenue, slXuat(r.returnQty, r.returnQtyTheoDv), -r.returnValue, r.netRevenue])
      }
      downloadXlsx(`bao-cao-hh-banhang-${range.from}-${range.to}`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "SL bán", "Doanh thu thuần", "Giá vốn thuần", "Lợi nhuận", "Biên LN (%)"],
      ]
      for (const r of profitRows) {
        out.push([r.sku, r.name, slXuat(r.qty, r.qtyTheoDv), r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      }
      downloadXlsx(`bao-cao-hh-loinhuan-${range.from}-${range.to}`, out)
    } else if (variant === "stock_value") {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "Nhà cung cấp", "SL tồn", "Giá vốn TB", "Giá trị tồn", "Số lô"],
      ]
      for (const r of stockValueRows) {
        out.push([r.sku, r.name, r.ncc, slXuat(r.qty, r.qtyTheoDv), r.unit_cost ?? "—", r.value, r.batches])
      }
      downloadXlsx(`bao-cao-hh-giatrikho-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "Tồn đầu", "SL nhập", "Giá trị nhập", "SL xuất", "Giá trị xuất", "Kiểm / chuyển kho", "Tồn cuối"],
      ]
      for (const r of movementData.rows) {
        out.push([
          r.sku, r.name, slXuat(r.beginQty, r.beginTheoDv), slXuat(r.importQty, r.importTheoDv), r.importValue,
          slXuat(r.exportQty, r.exportTheoDv), r.exportValue, slXuat(r.otherQty, r.otherTheoDv), slXuat(r.endQty, r.endTheoDv),
        ])
      }
      downloadXlsx(`bao-cao-hh-xnt-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportShell
      title="Báo cáo hàng hóa"
      variants={bienThe}
      variant={variant}
      onVariantChange={(v) => setVariant(v)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
      extraOptions={
        <FilterField label="Tùy chọn">
          <FilterCheckbox
            label="Gộp theo nhà cung cấp"
            checked={groupSameType}
            onChange={setGroupSameType}
          />
        </FilterField>
      }
      filters={
        <>
          <FilterField label="Hàng hóa (chọn nhiều)">
            <FilterMultiSelect
              value={productFilter}
              onChange={setProductFilter}
              options={catalogs.products}
              khiMo={catalogs.nang}
              placeholder="Tất cả hàng hóa"
              loading={catalogs.nangDangTai}
            />
          </FilterField>
          <FilterField label="Tìm tự do">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Theo mã, tên hàng (tự do)"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
            />
          </FilterField>
          <FilterField label="Thương hiệu (chọn nhiều)">
            <FilterMultiSelect
              value={brandFilter}
              onChange={setBrandFilter}
              options={catalogs.brands}
              khiMo={catalogs.nang}
              placeholder="Tất cả thương hiệu"
              loading={catalogs.nangDangTai}
            />
          </FilterField>
          <FilterField label="Nhà cung cấp (chọn nhiều)">
            <FilterMultiSelect
              value={supplierFilter}
              onChange={setSupplierFilter}
              options={suppliers.map((s) => ({ id: s.id, label: s.name }))}
              placeholder="Tất cả NCC"
              loading={catalogs.loading}
            />
          </FilterField>
        </>
      }
    >
      <div className="hidden print:block mb-3 text-center text-xs text-muted-foreground">
        {VARIANTS.find((v) => v.key === variant)?.label} · {formatRangeLabel(range)}
      </div>
      {!loadError && <ReportLoadNotice truncated={truncated} />}
      {loadError ? (
        <ReportLoadNotice error={loadError} />
      ) : loading || (xemKho && !loDaNap) || (xemXnt && !xntDaNap) ? (
        <Skeleton className="h-72" />
      ) : variant === "sales" ? (
        <SalesByProductView rows={salesRows} orderLines={lines} orderMap={orderMap} productMap={productMap} />
      ) : variant === "profit" ? (
        <ProfitByProductView rows={profitRows} />
      ) : variant === "stock_value" ? (
        <StockValueView rows={stockValueRows} />
      ) : variant === "movement" ? (
        <StockMovementView rows={movementData.rows} />
      ) : (
        <StockMovementView
          rows={movementData.rows}
          detail
          detailLines={movementData.detail}
        />
      )}
    </ReportShell>
  )
}
