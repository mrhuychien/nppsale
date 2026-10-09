"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useLuotNap } from "@/hooks/use-luot-nap"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField, FilterSearchSelect, FilterMultiSelect } from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { downloadXlsx } from "@/components/analytics/report-frame"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import {
  fetchRevenueInvoicesDu,
  fetchInvoiceLines,
  giamGiaHoaDon,
  fetchReturnsRowsDu,
  fetchPostedStockEntries,
  fetchOrgRows,
  type InvoiceLineRow,
  type RevenueInvoiceRow,
  type ReturnSummaryRow,
  fetchStockEntryLines,
  fetchReturnLines,
  fetchReturnCosts,
  giaVonBinhQuanCoSo,
  soLuongCoSoDongHd,
  COT_SP_QUY_DOI,
  type ReturnLineRow,
  type StockEntryLineRow,
} from "@/lib/analytics/sales"
import {
  congHangBanNhanVien, chotTienChungTu,
  congLoiNhuanNhanVien,
  nhanVienPhieuTra,
  phanTienQuaLoc,
  coDongQuaLoc,
  type HangBanNhanVien,
  type HangBanSanPham,
  type SanPhamHangBan,
} from "@/lib/analytics/hang-ban-nhan-vien"
import { congSL, hienSLTheoDonVi, tongSLTheoDonVi, truSL, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { toast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"

type Variant = "sales" | "profit" | "by_customer" | "products" | "summary"

const VARIANTS = [
  { key: "sales" as const, label: "Bán hàng" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "by_customer" as const, label: "Theo khách hàng" },
  { key: "products" as const, label: "Theo sản phẩm" },
  { key: "summary" as const, label: "Hàng bán theo nhân viên" },
] as const

interface UserRow {
  id: string
  full_name: string
  role: string
  is_active: boolean
}
interface CustomerRow {
  id: string
  store_name: string
  group_id?: string | null
  channel?: string | null
}
/** Mặt hàng kèm đơn vị quy đổi + bảng giá (`COT_SP_QUY_DOI`) + NCC chính (bộ lọc NCC). */
interface ProductRow extends SanPhamHangBan {
  primary_supplier_id?: string | null
}
interface StockEntry {
  id: string
  type: string
}

/** Số chênh có dấu: + xanh (bán trên giá), − đỏ (bán dưới giá). */
function hienChenh(v: number) {
  const t = Math.round(v)
  return (
    <span className={t > 0 ? "text-tertiary" : t < 0 ? "text-error" : "text-muted-foreground"}>
      {t === 0 ? "0" : `${t > 0 ? "+" : "−"}${formatCurrency(Math.abs(t))}`}
    </span>
  )
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Chủ DN",
  manager: "Quản lý",
  accountant: "Kế toán",
  sales: "NV Bán hàng",
  warehouse: "Thủ kho",
  driver: "Tài xế",
}

export default function EmployeesReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("sales")
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [search, setSearch] = useState("")
  const [productFilter, setProductFilter] = useState<string[]>([])
  /* Không còn lọc "Loại hàng" (`products.category`) — chủ nhà 03/10/2026 "Bỏ luôn trường nhóm hàng".
     Lọc theo NCC CHÍNH của mặt hàng (`primary_supplier_id`) thay cho Thương hiệu — chủ nhà 09/10/2026: "bộ lọc thương
     hiệu thay bằng NCC" (như màn Báo cáo bán hàng). */
  const [supplierFilter, setSupplierFilter] = useState<string[]>([])
  const [groupFilter, setGroupFilter] = useState("")
  const [salesUserFilter, setSalesUserFilter] = useState<string[]>([])
  const [routeFilter, setRouteFilter] = useState<string[]>([])
  const catalogs = useFilterCatalogs(user?.org_id)
  const [loading, setLoading] = useState(true)

  // Hóa đơn ĐÃ GHI SỔ trong kỳ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  const [invoices, setInvoices] = useState<RevenueInvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [returns, setReturns] = useState<ReturnSummaryRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLineRow[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  // Giá vốn hàng trả ĐÃ NHẬP LẠI KHO theo phiếu — trừ khỏi giá vốn (mig 192).
  const [returnCosts, setReturnCosts] = useState<Awaited<ReturnType<typeof fetchReturnCosts>>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const batLuot = useLuotNap()
  const load = useCallback(async () => {
    /* ⚠ CHẶN SỚM NẰM NGOÀI `try`. Để trong thì `finally` tắt vòng quay
       ngay cả khi chưa hề bắt đầu đọc — màn hiện một báo cáo rỗng trong
       lúc phiên đăng nhập còn đang tải. */
    if (!user?.org_id) return
    const conMoi = batLuot()
    /**
     * ⚠ ĐỌC HỎNG THÌ NÓI RA, ĐỪNG QUAY MÃI. Các hàm đọc dòng nay NÉM khi
     *   truy vấn hỏng thay vì trả mảng rỗng — vì một báo cáo tiền thiếu
     *   dòng trông y hệt một báo cáo đúng. Nhưng ném mà không ai bắt là
     *   vòng quay không bao giờ dừng và không có chữ nào giải thích.
     */
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      /* ⚠ PHIẾU XUẤT HỎNG THÌ NÉM. Bản cũ chỉ `console.error` rồi đọc
         `rows` rỗng → giá vốn 0 → lợi nhuận và hoa hồng phồng lên. Bảng
         tra cứu (khách, mặt hàng, người dùng) cũng đọc đủ theo trang. */
      const [invoiceRes, returnsRes, usersRes, customersRes, productsRes, stockEntriesRes] =
        await Promise.all([
          fetchRevenueInvoicesDu(supabase, orgId, range),
          fetchReturnsRowsDu(supabase, orgId, range),
          fetchOrgRows<UserRow>(supabase, "users", orgId, "id, full_name, role, is_active", "đọc nhân viên"),
          fetchOrgRows<CustomerRow>(supabase, "customers", orgId, "id, store_name, group_id, channel", "đọc khách hàng"),
          fetchOrgRows<ProductRow>(
            supabase, "products", orgId,
            `id, sku, name, base_unit, sell_price, primary_supplier_id, ${COT_SP_QUY_DOI}`, "đọc mặt hàng"
          ),
          fetchPostedStockEntries(supabase, orgId, range, "export"),
        ])
      const invoiceList = invoiceRes.rows
      const returnsRows = returnsRes.rows
      if (conMoi()) setTruncated(
        invoiceRes.truncated || returnsRes.truncated || usersRes.truncated ||
          customersRes.truncated || productsRes.truncated || stockEntriesRes.truncated
      )
      const invoiceIds = invoiceList.map((o) => o.id)
      const stockEntryIds = stockEntriesRes.rows.map((e) => e.id)
      const returnIds = returnsRows.map((r) => r.id)
      /* ⚠ CẢ BA ĐỀU PHẢI PHÂN TRANG. Trước đây chỉ `fetchInvoiceLines` phân
         trang, còn dòng kho và dòng trả nằm ngay cạnh trong cùng
         `Promise.all` thì đọc trần — quá 1.000 dòng là API trả đúng 1.000,
         không lỗi, và giá vốn thiếu kéo hoa hồng sai theo. */
      /* Giá vốn hàng trả đọc hỏng thì NÉM như ba bảng kia — 0 là lãi hạ oan. */
      const [linesList, stockLinesList, returnLinesList, returnCostMap] = await Promise.all([
        fetchInvoiceLines(supabase, invoiceIds),
        fetchStockEntryLines(supabase, stockEntryIds),
        fetchReturnLines(supabase, returnIds),
        fetchReturnCosts(supabase, returnIds),
      ])
      if (conMoi()) setInvoices(invoiceList)
      if (conMoi()) setLines(linesList)
      if (conMoi()) setReturns(returnsRows)
      if (conMoi()) setUsers(usersRes.rows)
      if (conMoi()) setCustomers(customersRes.rows)
      if (conMoi()) setProducts(productsRes.rows)
      if (conMoi()) setStockEntries(stockEntriesRes.rows)
      if (conMoi()) setStockLines(stockLinesList)
      if (conMoi()) setReturnLines(returnLinesList)
      if (conMoi()) setReturnCosts(returnCostMap)
    } catch (err) {
      if (conMoi()) setLoadError(errorMessage(err))
      toast({
        title: "Chưa dựng được báo cáo",
        description: errorMessage(err),
        variant: "destructive",
      })
    } finally {
      if (conMoi()) setLoading(false)
    }
  }, [user?.org_id, range, supabase, batLuot])

  useEffect(() => {
    load()
  }, [load])

  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  // Giá vốn bình quân MỖI ĐƠN VỊ CƠ SỞ theo mặt hàng trong kỳ.
  const avgCostMap = useMemo(() => giaVonBinhQuanCoSo(stockLines), [stockLines])

  // Map invoice_id -> [dòng hóa đơn]
  /* ⚠ BỎ DÒNG HÀNG ĐỔI (`is_exchange`) — không phải hàng bán (cùng luật Báo cáo tổng hợp, `dungDongBan`). Tính vào là
     SL bán phồng, "Theo bảng giá" phồng và chênh lệch ÂM OAN (hàng đổi giá 0 so với giá bảng), trong khi phía hàng
     trả đã bỏ hàng đổi (`fetchReturnLines`). Rà "Hàng bán theo nhân viên" 09/10/2026. */
  const linesByInvoice = useMemo(() => {
    const m = new Map<string, InvoiceLineRow[]>()
    for (const l of lines) {
      if (l.is_exchange) continue
      const a = m.get(l.invoice_id) || []
      a.push(l)
      m.set(l.invoice_id, a)
    }
    return m
  }, [lines])

  const matchSearchUser = useCallback(
    (uid: string) => {
      if (salesUserFilter.length && !salesUserFilter.includes(uid)) return false
      if (!search) return true
      const u = userMap.get(uid)
      if (!u) return false
      return viMatchAllWords(search, u.full_name)
    },
    [search, salesUserFilter, userMap]
  )

  // Filter at the line level — applied where lines are iterated.
  const productPasses = useCallback(
    (productId: string) => {
      if (!productFilter.length && !supplierFilter.length) return true
      const p = productMap.get(productId)
      if (!p) return false
      if (productFilter.length && !productFilter.includes(p.id)) return false
      if (supplierFilter.length && !supplierFilter.includes(p.primary_supplier_id || "")) return false
      return true
    },
    [productFilter, supplierFilter, productMap]
  )

  /**
   * ⚠ ĐANG LỌC HÀNG HOÁ / NCC THÌ TIỀN CẤP NHÂN VIÊN LÀ PHẦN CỦA HÀNG ĐƯỢC LỌC (chủ nhà 09/10/2026). Bản cũ cộng
   *   NGUYÊN tiền hoá đơn ở các tab Bán hàng / Lợi nhuận / Theo khách / Theo sản phẩm dù đang lọc hàng — chọn một NCC
   *   vẫn ra doanh thu của cả hoá đơn, và tab Lợi nhuận trừ giá vốn CHỈ của hàng đã lọc khỏi doanh thu của CẢ hoá đơn
   *   → lãi phồng. Nay: chỉ chứng từ có dòng qua lọc, tiền = phần phân bổ của các dòng ấy (`phanTienQuaLoc` — cùng luật
   *   Báo cáo tổng hợp). Không lọc → nguyên tiền chứng từ (khớp công nợ).
   */
  const coLocHang = productFilter.length > 0 || supplierFilter.length > 0
  const hoaDonTheoLoc = useMemo(() => {
    if (!coLocHang) return invoices
    const out: RevenueInvoiceRow[] = []
    for (const o of invoices) {
      const ls = linesByInvoice.get(o.id) || []
      if (!coDongQuaLoc(ls, productPasses)) continue
      out.push({ ...o, total: phanTienQuaLoc(Number(o.total || 0), ls, productPasses) })
    }
    return out
  }, [coLocHang, invoices, linesByInvoice, productPasses])
  const phieuTraTheoLoc = useMemo(() => {
    if (!coLocHang) return returns
    const theoPhieu = new Map<string, ReturnLineRow[]>()
    for (const l of returnLines) {
      const a = theoPhieu.get(l.return_id)
      if (a) a.push(l)
      else theoPhieu.set(l.return_id, [l])
    }
    const out: ReturnSummaryRow[] = []
    for (const r of returns) {
      const ls = theoPhieu.get(r.id) || []
      if (!coDongQuaLoc(ls, productPasses)) continue
      out.push({ ...r, credit_note_amount: phanTienQuaLoc(Number(r.credit_note_amount || 0), ls, productPasses) })
    }
    return out
  }, [coLocHang, returns, returnLines, productPasses])

  // Filter at the customer level (group + route) — applied where orders / customers are iterated.
  const customerPasses = useCallback(
    (customerId: string) => {
      if (!groupFilter && !routeFilter.length) return true
      const c = customerMap.get(customerId)
      if (!c) return false
      if (groupFilter && c.group_id !== groupFilter) return false
      if (routeFilter.length) {
        const matchVals = new Set<string>()
        for (const rid of routeFilter) {
          const route = catalogs.routes.find((r) => r.id === rid)
          for (const v of [route?.id, route?.label, route?.hint]) if (v) matchVals.add(v)
        }
        if (!c.channel || !matchVals.has(c.channel)) return false
      }
      return true
    },
    [groupFilter, routeFilter, customerMap, catalogs.routes]
  )

  /**
   * Quy phiếu trả về nhân viên — MỘT LUẬT cho mọi bảng của trang (`nhanVienPhieuTra`):
   * tên trên phiếu (mig 160) → NV của hóa đơn phiếu gắn → NV hóa đơn gần nhất của
   * cùng khách (phiếu cũ chưa gán — vẫn đoán, không bỏ ra ngoài sổ).
   *
   * ⚠ HAI BẢNG LỆCH LUẬT LÀ HAI CON SỐ TRẢ HÀNG KHÁC NHAU TRÊN CÙNG MỘT TRANG.
   */
  const nvPhieuTra = useMemo(() => nhanVienPhieuTra(returns, invoices), [returns, invoices])

  const returnById = useMemo(() => {
    const m = new Map<string, ReturnSummaryRow>()
    for (const r of returns) m.set(r.id, r)
    return m
  }, [returns])

  /**
   * Dòng hàng trả đã quy nhân viên, qua CÙNG bộ lọc với dòng hóa đơn (người bán,
   * khách, mặt hàng). Dùng cho các bảng theo mặt hàng.
   */
  const returnLinesTheoNv = useMemo(() => {
    const out: { uid: string; customerId: string; line: ReturnLineRow }[] = []
    for (const rl of returnLines) {
      const r = returnById.get(rl.return_id)
      const uid = nvPhieuTra.get(rl.return_id)
      if (!r || !uid || !matchSearchUser(uid)) continue
      if (!customerPasses(r.customer_id) || !productPasses(rl.product_id)) continue
      out.push({ uid, customerId: r.customer_id, line: rl })
    }
    return out
  }, [returnLines, returnById, nvPhieuTra, matchSearchUser, customerPasses, productPasses])

  /** Phiếu trả đã quy nhân viên, qua bộ lọc người bán + khách (cấp tiền của phiếu; đang lọc hàng thì phần của hàng ấy). */
  const returnsTheoNv = useMemo(() => {
    const out: { uid: string; r: ReturnSummaryRow }[] = []
    for (const r of phieuTraTheoLoc) {
      const uid = nvPhieuTra.get(r.id)
      if (!uid || !matchSearchUser(uid) || !customerPasses(r.customer_id)) continue
      out.push({ uid, r })
    }
    return out
  }, [phieuTraTheoLoc, nvPhieuTra, matchSearchUser, customerPasses])

  // ============== Bán hàng (drill-down theo thời gian) ==============
  type SalesRow = {
    id: string
    name: string
    role: string
    revenue: number
    returnValue: number
    netRevenue: number
    days: { date: string; label: string; revenue: number; returnValue: number; netRevenue: number }[]
  }

  const salesRows: SalesRow[] = useMemo(() => {
    const m = new Map<string, SalesRow>()
    // doanh thu từ hóa đơn đã ghi sổ (đang lọc hàng: phần của hàng được lọc — `hoaDonTheoLoc`)
    for (const o of hoaDonTheoLoc) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const u = userMap.get(o.sales_user_id)
      const e =
        m.get(o.sales_user_id) ||
        ({
          id: o.sales_user_id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          returnValue: 0,
          netRevenue: 0,
          days: [],
        } as SalesRow)
      e.revenue += Number(o.total || 0)
      const d = String(o.invoice_date).slice(0, 10)
      const dd = d.split("-")
      const lbl = `${dd[2]}/${dd[1]}/${dd[0]}`
      const dayBucket = e.days.find((x) => x.date === d)
      if (dayBucket) {
        dayBucket.revenue += Number(o.total || 0)
      } else {
        e.days.push({ date: d, label: lbl, revenue: Number(o.total || 0), returnValue: 0, netRevenue: 0 })
      }
      m.set(o.sales_user_id, e)
    }
    /**
     * Quy phiếu trả về nhân viên — `returnsTheoNv` (luật chung `nhanVienPhieuTra`).
     *
     * ⚠ PHIẾU CÓ GHI TÊN THÌ ĐỌC TÊN, ĐỪNG ĐOÁN (mig 160). Đoán theo hóa
     *   đơn gần nhất của cùng khách sai ngay khi một khách mua của hai
     *   nhân viên, và nó sai vào đúng con số trừ doanh số.
     *
     * ⚠ PHIẾU CHƯA GÁN THÌ VẪN ĐOÁN, KHÔNG BỎ RA NGOÀI SỔ. Mọi phiếu lập
     *   trước mig 160 đều rỗng cột ấy; bỏ chúng đi là doanh số thuần của
     *   cả năm ngoái tự nhiên tăng lên, không ai hiểu vì sao.
     */
    for (const { uid, r } of returnsTheoNv) {
      const u = userMap.get(uid)
      const e =
        m.get(uid) ||
        ({
          id: uid,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          returnValue: 0,
          netRevenue: 0,
          days: [],
        } as SalesRow)
      const amt = Number(r.credit_note_amount || 0)
      e.returnValue += amt
      const d = String(r.created_at).slice(0, 10)
      const dd = d.split("-")
      const lbl = `${dd[2]}/${dd[1]}/${dd[0]}`
      const dayBucket = e.days.find((x) => x.date === d)
      if (dayBucket) {
        dayBucket.returnValue += amt
      } else {
        e.days.push({ date: d, label: lbl, revenue: 0, returnValue: amt, netRevenue: 0 })
      }
      m.set(uid, e)
    }
    return Array.from(m.values())
      .map((r) => ({
        ...r,
        netRevenue: r.revenue - r.returnValue,
        days: r.days
          .map((d) => ({ ...d, netRevenue: d.revenue - d.returnValue }))
          .sort((a, b) => b.date.localeCompare(a.date)),
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [hoaDonTheoLoc, returnsTheoNv, userMap, matchSearchUser, customerPasses])

  // ============== Lợi nhuận ==============
  type ProfitRow = {
    id: string
    name: string
    role: string
    orders: number
    revenue: number
    cogs: number
    profit: number
    margin: number
  }
  /**
   * ⚠ LÃI GỘP THUẦN (chủ nhà 25/09/2026: "Rà soát lại toàn bộ doanh số tính bằng
   *   số đi - số trả"). Doanh thu = hóa đơn − hàng trả quy về nhân viên; giá vốn =
   *   giá vốn dòng hóa đơn − giá vốn hàng trả đã nhập lại kho (lọc mặt hàng như
   *   dòng hóa đơn). Bản cũ lấy nguyên tiền hóa đơn — hoa hồng tính trên số phồng.
   */
  const profitRows: ProfitRow[] = useMemo(() => {
    const hoaDon = hoaDonTheoLoc.filter((o) => matchSearchUser(o.sales_user_id) && customerPasses(o.customer_id))
    const giaVonHoaDon = (invoiceId: string) => {
      let cogs = 0
      for (const l of linesByInvoice.get(invoiceId) || []) {
        if (!productPasses(l.product_id)) continue
        // SL cơ sở × giá vốn mỗi đơn vị cơ sở.
        cogs += soLuongCoSoDongHd(l, productMap.get(l.product_id)) * (avgCostMap.get(l.product_id) || 0)
      }
      return cogs
    }
    const tra = returnsTheoNv.map((x) => x.r)
    const nv = new Map(returnsTheoNv.map((x) => [x.r.id, x.uid] as const))
    return congLoiNhuanNhanVien({
      hoaDon,
      giaVonHoaDon,
      phieuTra: tra,
      nvPhieuTra: nv,
      giaVonTra: returnCosts,
      matHangQua: productPasses,
    })
      .map((r) => {
        const u = userMap.get(r.id)
        return {
          id: r.id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          orders: r.orders,
          revenue: r.revenue,
          cogs: r.cogs,
          profit: r.profit,
          margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0,
        }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [
    hoaDonTheoLoc, linesByInvoice, avgCostMap, returnsTheoNv, returnCosts, userMap, productMap,
    matchSearchUser, customerPasses, productPasses,
  ])

  // ============== Hàng bán theo nhân viên ==============
  type EmployeeProductRow = {
    id: string
    name: string
    role: string
    revenue: number
    /** ⚠ Tổng lẫn đơn vị — chỉ để sắp xếp. Hiện `qtyTheoDv`. */
    qty: number
    qtyTheoDv: SLTheoDonVi
    products: {
      id: string
      sku: string
      name: string
      /** Đơn vị cơ sở — `qty` đã quy về nó. */
      unit: string
      qty: number
      revenue: number
      customers: { id: string; store_name: string; qty: number; revenue: number }[]
    }[]
  }
  const employeeProductRows: EmployeeProductRow[] = useMemo(() => {
    const m = new Map<string, EmployeeProductRow>()
    for (const o of hoaDonTheoLoc) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const u = userMap.get(o.sales_user_id)
      const e =
        m.get(o.sales_user_id) ||
        ({
          id: o.sales_user_id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          qty: 0,
          qtyTheoDv: {},
          products: [],
        } as EmployeeProductRow)
      e.revenue += Number(o.total || 0)
      const ls = linesByInvoice.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        const prod = productMap.get(l.product_id)
        if (!prod) continue
        let pr = e.products.find((x) => x.id === l.product_id)
        if (!pr) {
          pr = { id: l.product_id, sku: prod.sku, name: prod.name, unit: prod.base_unit || "", qty: 0, revenue: 0, customers: [] }
          e.products.push(pr)
        }
        // SL quy về đơn vị cơ sở trước khi cộng (3 thùng + 5 hộp ≠ 8).
        const qty = soLuongCoSoDongHd(l, prod)
        pr.qty += qty
        pr.revenue += Number(l.line_total || 0)
        e.qty += qty
        // Nhiều mặt hàng → giữ theo từng đơn vị cơ sở, không cộng hộp + chai.
        congSL(e.qtyTheoDv, prod.base_unit, qty)
        const c = customerMap.get(o.customer_id)
        let cust = pr.customers.find((x) => x.id === o.customer_id)
        if (!cust) {
          cust = {
            id: o.customer_id,
            store_name: c?.store_name || "—",
            qty: 0,
            revenue: 0,
          }
          pr.customers.push(cust)
        }
        cust.qty += qty
        cust.revenue += Number(l.line_total || 0)
      }
      m.set(o.sales_user_id, e)
    }
    /**
     * ⚠ DOANH THU THUẦN (chủ nhà 25/09/2026: "Rà soát lại toàn bộ doanh số tính
     *   bằng số đi - số trả"). Cấp nhân viên trừ `credit_note_amount` của phiếu (cùng
     *   cấp với tiền hóa đơn); cấp mặt hàng / khách trừ `line_total` dòng trả (hàng
     *   đổi đã bỏ). SL giữ là SL BÁN — SL trả xem tab "Hàng bán theo nhân viên".
     */
    const dongNv = (uid: string) => {
      let e = m.get(uid)
      if (!e) {
        const u = userMap.get(uid)
        e = {
          id: uid,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          qty: 0,
          qtyTheoDv: {},
          products: [],
        }
        m.set(uid, e)
      }
      return e
    }
    for (const { uid, r } of returnsTheoNv) dongNv(uid).revenue -= Number(r.credit_note_amount || 0)
    for (const { uid, customerId, line } of returnLinesTheoNv) {
      const e = dongNv(uid)
      const prod = productMap.get(line.product_id)
      let pr = e.products.find((x) => x.id === line.product_id)
      if (!pr) {
        pr = { id: line.product_id, sku: prod?.sku || "—", name: prod?.name || "—", unit: prod?.base_unit || "", qty: 0, revenue: 0, customers: [] }
        e.products.push(pr)
      }
      pr.revenue -= Number(line.line_total || 0)
      let cust = pr.customers.find((x) => x.id === customerId)
      if (!cust) {
        cust = { id: customerId, store_name: customerMap.get(customerId)?.store_name || "—", qty: 0, revenue: 0 }
        pr.customers.push(cust)
      }
      cust.revenue -= Number(line.line_total || 0)
    }
    for (const e of Array.from(m.values())) {
      e.products.sort((a, b) => b.revenue - a.revenue)
      for (const p of e.products) p.customers.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [
    hoaDonTheoLoc, linesByInvoice, returnsTheoNv, returnLinesTheoNv, userMap, customerMap, productMap,
    matchSearchUser, customerPasses, productPasses,
  ])

  // ============== Theo khách hàng (NV → KH → mặt hàng) ==============
  type EmployeeCustomerRow = {
    id: string
    name: string
    role: string
    revenue: number
    /** ⚠ Tổng lẫn đơn vị — chỉ để sắp xếp. Hiện `qtyTheoDv`. */
    qty: number
    qtyTheoDv: SLTheoDonVi
    customers: {
      id: string
      store_name: string
      orders: number
      qty: number
      qtyTheoDv: SLTheoDonVi
      revenue: number
      products: { id: string; sku: string; name: string; unit: string; qty: number; revenue: number }[]
    }[]
  }
  const employeeCustomerRows: EmployeeCustomerRow[] = useMemo(() => {
    const m = new Map<string, EmployeeCustomerRow>()
    for (const o of hoaDonTheoLoc) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const u = userMap.get(o.sales_user_id)
      const e =
        m.get(o.sales_user_id) ||
        ({
          id: o.sales_user_id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          qty: 0,
          qtyTheoDv: {},
          customers: [],
        } as EmployeeCustomerRow)
      e.revenue += Number(o.total || 0)

      let cust = e.customers.find((x) => x.id === o.customer_id)
      if (!cust) {
        const c = customerMap.get(o.customer_id)
        cust = {
          id: o.customer_id,
          store_name: c?.store_name || "—",
          orders: 0,
          qty: 0,
          qtyTheoDv: {},
          revenue: 0,
          products: [],
        }
        e.customers.push(cust)
      }
      cust.orders += 1
      cust.revenue += Number(o.total || 0)

      const ls = linesByInvoice.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        const prod = productMap.get(l.product_id)
        if (!prod) continue
        const qty = soLuongCoSoDongHd(l, prod)
        cust.qty += qty
        e.qty += qty
        congSL(cust.qtyTheoDv, prod.base_unit, qty)
        congSL(e.qtyTheoDv, prod.base_unit, qty)
        let pr = cust.products.find((x) => x.id === l.product_id)
        if (!pr) {
          pr = { id: l.product_id, sku: prod.sku, name: prod.name, unit: prod.base_unit || "", qty: 0, revenue: 0 }
          cust.products.push(pr)
        }
        pr.qty += qty
        pr.revenue += Number(l.line_total || 0)
      }
      m.set(o.sales_user_id, e)
    }
    /**
     * ⚠ DOANH THU THUẦN (chủ nhà 25/09/2026: "Rà soát lại toàn bộ doanh số tính
     *   bằng số đi - số trả"). Nhân viên + khách trừ `credit_note_amount` của phiếu
     *   (cùng cấp với tiền hóa đơn); mặt hàng của khách trừ `line_total` dòng trả.
     *   Khách chỉ có hàng trả trong kỳ vẫn hiện (0 HĐ, doanh thu âm).
     */
    const dongNv = (uid: string) => {
      let e = m.get(uid)
      if (!e) {
        const u = userMap.get(uid)
        e = {
          id: uid,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          qty: 0,
          qtyTheoDv: {},
          customers: [],
        }
        m.set(uid, e)
      }
      return e
    }
    const dongKhach = (e: EmployeeCustomerRow, customerId: string) => {
      let cust = e.customers.find((x) => x.id === customerId)
      if (!cust) {
        cust = {
          id: customerId,
          store_name: customerMap.get(customerId)?.store_name || "—",
          orders: 0,
          qty: 0,
          qtyTheoDv: {},
          revenue: 0,
          products: [],
        }
        e.customers.push(cust)
      }
      return cust
    }
    for (const { uid, r } of returnsTheoNv) {
      const e = dongNv(uid)
      const amt = Number(r.credit_note_amount || 0)
      e.revenue -= amt
      dongKhach(e, r.customer_id).revenue -= amt
    }
    for (const { uid, customerId, line } of returnLinesTheoNv) {
      const cust = dongKhach(dongNv(uid), customerId)
      let pr = cust.products.find((x) => x.id === line.product_id)
      if (!pr) {
        const prod = productMap.get(line.product_id)
        pr = { id: line.product_id, sku: prod?.sku || "—", name: prod?.name || "—", unit: prod?.base_unit || "", qty: 0, revenue: 0 }
        cust.products.push(pr)
      }
      pr.revenue -= Number(line.line_total || 0)
    }
    for (const e of Array.from(m.values())) {
      e.customers.sort((a, b) => b.revenue - a.revenue)
      for (const c of e.customers) c.products.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [
    hoaDonTheoLoc, linesByInvoice, returnsTheoNv, returnLinesTheoNv, userMap, customerMap, productMap,
    matchSearchUser, customerPasses, productPasses,
  ])

  // ============== Hàng bán theo nhân viên (summary 9 cột) ==============
  // SL quy về đơn vị cơ sở, niêm yết theo giá của đúng đơn vị dòng — `congHangBanNhanVien`.
  type SummaryProduct = HangBanSanPham
  type SummaryRow = Omit<HangBanNhanVien, "products"> & { name: string; role: string; products: SummaryProduct[] }

  const employeeSummaryRows: SummaryRow[] = useMemo(() => {
    const ban: { uid: string; line: InvoiceLineRow }[] = []
    const giamDon: { uid: string; tien: number }[] = []
    /* ⚠ Chủ nhà 26/09/2026: doanh thu thuần phải khớp công nợ — tiền CHỨNG TỪ (`chotTienChungTu`). Đang lọc hàng hoá /
       NCC thì `hoaDonTheoLoc` / `returnsTheoNv` đã là PHẦN của hàng được lọc (09/10/2026). */
    const tienHd = new Map<string, number>()
    for (const o of hoaDonTheoLoc) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const dongHd = linesByInvoice.get(o.id) || []
      tienHd.set(o.sales_user_id, (tienHd.get(o.sales_user_id) ?? 0) + Number(o.total || 0))
      // Giảm giá cả đơn tính RIÊNG theo hoá đơn (chủ nhà 30/09/2026), không trộn vào chênh. Đang lọc hàng: phần của
      // hàng được lọc, cùng luật phân bổ với tiền hoá đơn — không phải giảm giá của CẢ hoá đơn.
      const giam = giamGiaHoaDon(o, dongHd)
      giamDon.push({ uid: o.sales_user_id, tien: coLocHang ? phanTienQuaLoc(giam, dongHd, productPasses) : giam })
      for (const l of dongHd) {
        if (!productPasses(l.product_id)) continue
        ban.push({ uid: o.sales_user_id, line: l })
      }
    }

    /**
     * Quy dòng hàng trả về nhân viên — CÙNG MỘT LUẬT với bảng doanh số
     * phía trên (`returnLinesTheoNv` ← `nhanVienPhieuTra`: tên trên phiếu,
     * rồi NV hóa đơn gắn, rồi mới đoán theo hóa đơn gần nhất của khách),
     * và qua cùng bộ lọc khách / mặt hàng với dòng bán.
     *
     * ⚠ HAI BẢNG LỆCH LUẬT LÀ HAI CON SỐ TRẢ HÀNG KHÁC NHAU TRÊN CÙNG
     *   MỘT TRANG, và không ai biết tin bảng nào.
     */
    const tra = returnLinesTheoNv.map(({ uid, line }) => ({ uid, line }))
    const tienTra = new Map<string, number>()
    for (const { uid, r } of returnsTheoNv) {
      tienTra.set(uid, (tienTra.get(uid) ?? 0) + Number(r.credit_note_amount || 0))
    }
    const rows = chotTienChungTu(congHangBanNhanVien({ ban, tra, sanPham: productMap, giamDon }), tienHd, tienTra)
    return rows.map((r) => {
      const u = userMap.get(r.id)
      return { ...r, name: u?.full_name || "—", role: ROLE_LABEL[u?.role || ""] || u?.role || "—" }
    })
  }, [hoaDonTheoLoc, linesByInvoice, returnLinesTheoNv, returnsTheoNv, userMap, productMap, matchSearchUser, customerPasses, productPasses, coLocHang])

  const handleExport = () => {
    if (variant === "sales") {
      const out: (string | number)[][] = [
        ["Người bán", "Vai trò", "Doanh thu", "Giá trị trả", "Doanh thu thuần"],
      ]
      for (const r of salesRows)
        out.push([r.name, r.role, r.revenue, -r.returnValue, r.netRevenue])
      downloadXlsx(`bao-cao-nv-banhang-${range.from}-${range.to}`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [
        ["Người bán", "Vai trò", "Số HĐ", "Doanh thu thuần", "Giá vốn thuần", "Lợi nhuận", "Biên LN (%)"],
      ]
      for (const r of profitRows)
        out.push([r.name, r.role, r.orders, r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      downloadXlsx(`bao-cao-nv-loinhuan-${range.from}-${range.to}`, out)
    } else if (variant === "by_customer") {
      const out: (string | number)[][] = [
        ["Nhân viên", "Khách hàng", "Mã hàng", "Tên hàng", "Đơn vị", "SL", "Doanh thu thuần"],
      ]
      for (const e of employeeCustomerRows) {
        for (const c of e.customers) {
          for (const p of c.products) {
            out.push([e.name, c.store_name, p.sku, p.name, p.unit, p.qty, p.revenue])
          }
        }
      }
      downloadXlsx(`bao-cao-nv-theo-khach-${range.from}-${range.to}`, out)
    } else if (variant === "products") {
      const out: (string | number)[][] = [
        ["Nhân viên", "Mã hàng", "Tên hàng", "Đơn vị", "Khách hàng", "SL", "Doanh thu thuần"],
      ]
      for (const e of employeeProductRows) {
        for (const p of e.products) {
          for (const c of p.customers) {
            out.push([e.name, p.sku, p.name, p.unit, c.store_name, c.qty, c.revenue])
          }
        }
      }
      downloadXlsx(`bao-cao-nv-theo-sanpham-${range.from}-${range.to}`, out)
    } else if (variant === "summary") {
      const out: (string | number)[][] = [
        [
          "Người bán",
          "Mã hàng",
          "Tên hàng",
          "Đơn vị",
          "SL bán",
          "Bảng giá (theo ĐVT)",
          "Giá bán (theo ĐVT)",
          "Theo bảng giá",
          "Doanh thu",
          "Chênh lệch bán",
          "Giảm giá đơn",
          "SL trả",
          "Giá trị trả",
          "Chênh lệch trả",
          "SL thực bán",
          "Doanh thu thuần",
          "Chênh lệch thuần",
        ],
      ]
      for (const r of employeeSummaryRows) {
        // Tổng hợp NV (không có mã hàng)
        out.push([
          r.name,
          "",
          "(Tổng hợp)",
          "",
          // Dòng tổng nhiều mặt hàng: xuất "640 hộp · 12 chai", không cộng lẫn đơn vị.
          hienSLTheoDonVi(r.qtyTheoDv),
          "",
          "",
          r.listed,
          r.revenue,
          Math.round(r.diff),
          -r.docDiscount,
          hienSLTheoDonVi(r.returnQtyTheoDv),
          -r.returnValue,
          Math.round(r.diffReturn),
          hienSLTheoDonVi(truSL(r.qtyTheoDv, r.returnQtyTheoDv)),
          r.netRevenue,
          Math.round(r.diffNet),
        ])
        // Mỗi mặt hàng × ĐƠN VỊ TÍNH một dòng — giá bảng / giá bán của đúng đơn vị ấy (chủ nhà 09/10/2026).
        for (const p of r.products) {
          for (const d of p.donVi) {
            out.push([
              r.name,
              p.sku,
              p.name,
              d.unit,
              d.qty,
              d.giaBang > 0 ? Math.round(d.giaBang) : "",
              d.giaBan != null ? Math.round(d.giaBan) : "",
              d.listed,
              d.revenue,
              Math.round(d.diff),
              "",
              d.returnQty,
              -d.returnValue,
              Math.round(d.diffReturn),
              d.netQty,
              d.netRevenue,
              Math.round(d.diffNet),
            ])
          }
        }
      }
      downloadXlsx(`bao-cao-nv-hangban-summary-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  // suppress unused warning
  void stockEntries

  const totalsSales = salesRows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      returnValue: acc.returnValue + r.returnValue,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { revenue: 0, returnValue: 0, netRevenue: 0 }
  )
  const totalsProfit = profitRows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
    }),
    { orders: 0, revenue: 0, cogs: 0, profit: 0 }
  )
  // SL dòng tổng: gộp theo đơn vị cơ sở — hộp + chai không cộng thành một số.
  const totalsProducts = {
    qtyTheoDv: tongSLTheoDonVi(employeeProductRows),
    revenue: employeeProductRows.reduce((s, r) => s + r.revenue, 0),
  }
  const totalsByCustomer = {
    qtyTheoDv: tongSLTheoDonVi(employeeCustomerRows),
    revenue: employeeCustomerRows.reduce((s, r) => s + r.revenue, 0),
    customers: employeeCustomerRows.reduce((s, r) => s + r.customers.length, 0),
  }
  const totalsSummaryQty = tongSLTheoDonVi(employeeSummaryRows)
  const totalsSummaryReturnQty = tongSLTheoDonVi(employeeSummaryRows, (r) => r.returnQtyTheoDv)

  return (
    <ReportShell
      title="Báo cáo nhân viên"
      variants={VARIANTS}
      variant={variant}
      onVariantChange={(v) => setVariant(v)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
      filters={
        <>
          <FilterField label="Hàng hóa (chọn nhiều)">
            <FilterMultiSelect
              value={productFilter}
              onChange={setProductFilter}
              options={catalogs.products}
              placeholder="Tất cả hàng hóa"
              loading={catalogs.loading}
            />
          </FilterField>
          {/* NCC chính của mặt hàng thay cho Thương hiệu — chủ nhà 09/10/2026. */}
          <FilterField label="Nhà cung cấp (chọn nhiều)">
            <FilterMultiSelect
              value={supplierFilter}
              onChange={setSupplierFilter}
              options={catalogs.suppliers}
              placeholder="Tất cả NCC"
              loading={catalogs.loading}
            />
          </FilterField>
          {/* Lọc theo NHÓM KHÁCH (bảng giá) — không phải nhóm hàng (đã bỏ, chủ nhà 03/10/2026). */}
          <FilterField label="Bảng giá / Nhóm khách">
            <FilterSearchSelect
              value={groupFilter}
              onChange={setGroupFilter}
              options={catalogs.customerGroups}
              placeholder="Chọn bảng giá"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Người bán (chọn nhiều)">
            <FilterMultiSelect
              value={salesUserFilter}
              onChange={setSalesUserFilter}
              options={catalogs.salesUsers}
              placeholder="Tất cả người bán"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Kênh bán (chọn nhiều)">
            <FilterMultiSelect
              value={routeFilter}
              onChange={setRouteFilter}
              options={catalogs.routes}
              placeholder="Tất cả kênh bán"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Tìm tự do">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên NV (tự do)"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
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
      ) : loading ? (
        <Skeleton className="h-72" />
      ) : variant === "sales" ? (
        <ReportTable
          rows={salesRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium text-primary">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
            { key: "ret", label: "Giá trị trả", align: "right", render: (r) => (r.returnValue > 0 ? <span className="text-error">-{formatCurrency(r.returnValue)}</span> : "0") },
            { key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${salesRows.length}`, colSpan: 2 },
                { content: formatCurrency(totalsSales.revenue), align: "right" },
                {
                  content:
                    totalsSales.returnValue > 0
                      ? `-${formatCurrency(totalsSales.returnValue)}`
                      : "0",
                  align: "right",
                  className: "text-error",
                },
                { content: formatCurrency(totalsSales.netRevenue), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="rounded-md border border-border/40 bg-background/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#ecfdf3]/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Thời gian</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị trả</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu thuần</th>
                  </tr>
                </thead>
                <tbody>
                  {r.days.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-center text-xs text-muted-foreground">
                        Không có ngày phát sinh
                      </td>
                    </tr>
                  ) : (
                    r.days.map((d) => (
                      <tr key={d.date} className="border-t border-border/30">
                        <td className="px-3 py-1.5 text-primary">{d.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(d.revenue)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {d.returnValue > 0 ? <span className="text-error">-{formatCurrency(d.returnValue)}</span> : "0"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                          {formatCurrency(d.netRevenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        />
      ) : variant === "profit" ? (
        <ReportTable
          rows={profitRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "or", label: "Số HĐ", align: "right", render: (r) => r.orders },
            { key: "rev", label: "Doanh thu thuần", align: "right", render: (r) => formatCurrency(r.revenue) },
            { key: "cogs", label: "Giá vốn thuần", align: "right", render: (r) => formatCurrency(r.cogs) },
            { key: "profit", label: "Lợi nhuận", align: "right", render: (r) => <span className={r.profit >= 0 ? "font-semibold text-tertiary" : "font-semibold text-error"}>{formatCurrency(r.profit)}</span> },
            { key: "m", label: "Biên LN", align: "right", render: (r) => `${r.margin.toFixed(1)}%` },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${profitRows.length}`, colSpan: 2 },
                { content: totalsProfit.orders, align: "right" },
                { content: formatCurrency(totalsProfit.revenue), align: "right" },
                { content: formatCurrency(totalsProfit.cogs), align: "right" },
                { content: formatCurrency(totalsProfit.profit), align: "right", className: "text-primary" },
                {
                  content: `${
                    totalsProfit.revenue > 0
                      ? ((totalsProfit.profit / totalsProfit.revenue) * 100).toFixed(1)
                      : "0.0"
                  }%`,
                  align: "right",
                },
              ]}
            />
          }
        />
      ) : variant === "by_customer" ? (
        <ReportTable
          rows={employeeCustomerRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium text-primary">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "ck", label: "Số khách", align: "right", render: (r) => r.customers.length },
            { key: "qty", label: "Tổng SL", align: "right", render: (r) => hienSLTheoDonVi(r.qtyTheoDv) },
            { key: "rev", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.revenue)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${employeeCustomerRows.length}`, colSpan: 2 },
                { content: totalsByCustomer.customers, align: "right" },
                { content: hienSLTheoDonVi(totalsByCustomer.qtyTheoDv), align: "right" },
                { content: formatCurrency(totalsByCustomer.revenue), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="space-y-2">
              {r.customers.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Nhân viên này chưa có khách hàng
                </p>
              ) : (
                r.customers.map((c) => (
                  <div key={c.id} className="rounded-md border border-border/40 bg-background/60 overflow-x-auto">
                    <div className="flex items-center justify-between border-b border-border/40 bg-[#ecfdf3]/60 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.store_name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({c.orders} HĐ)
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        SL:{" "}
                        <span className="font-semibold text-foreground">
                          {hienSLTheoDonVi(c.qtyTheoDv)}
                        </span>
                        <span className="mx-2">·</span>
                        DT thuần:{" "}
                        <span className="font-semibold text-primary">
                          {formatCurrency(c.revenue)}
                        </span>
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase">
                            Mã hàng
                          </th>
                          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase">
                            Tên hàng
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">
                            SL
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">
                            DT thuần
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.products.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-3 py-2 text-center text-xs text-muted-foreground"
                            >
                              Không có dòng hàng
                            </td>
                          </tr>
                        ) : (
                          c.products.map((p) => (
                            <tr key={p.id} className="border-t border-border/30">
                              <td className="px-3 py-1.5 font-mono text-xs text-primary">
                                {p.sku}
                              </td>
                              <td className="px-3 py-1.5">{p.name}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {p.qty.toLocaleString("vi-VN")}
                                {p.unit ? ` ${p.unit}` : ""}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatCurrency(p.revenue)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}
        />
      ) : variant === "summary" ? (
        <ReportTable
          rows={employeeSummaryRows}
          rowKey={(r) => r.id}
          columns={[
            {
              key: "name",
              label: "Người bán",
              render: (r) => <span className="font-medium text-primary">{r.name}</span>,
            },
            {
              key: "qty",
              label: "SL bán",
              align: "right",
              render: (r) => hienSLTheoDonVi(r.qtyTheoDv),
            },
            {
              key: "unit",
              label: "Đơn vị",
              render: () => <span className="text-muted-foreground">—</span>,
            },
            {
              key: "listed",
              label: "Theo bảng giá",
              align: "right",
              render: (r) => formatCurrency(r.listed),
            },
            {
              key: "revenue",
              label: "Doanh thu",
              align: "right",
              render: (r) => formatCurrency(r.revenue),
            },
            {
              /* Chênh = SL × (giá HĐ − giá bảng cùng đơn vị); giảm giá cả đơn là cột riêng (chủ nhà 01/10/2026). */
              key: "diff",
              label: "Chênh lệch bán",
              align: "right",
              render: (r) => hienChenh(r.diff),
            },
            {
              key: "docDiscount",
              label: "Giảm giá đơn",
              align: "right",
              render: (r) => (r.docDiscount > 0 ? <span className="text-error">-{formatCurrency(r.docDiscount)}</span> : "0"),
            },
            {
              key: "rqty",
              label: "SL trả",
              align: "right",
              render: (r) => hienSLTheoDonVi(r.returnQtyTheoDv),
            },
            {
              key: "rval",
              label: "Giá trị trả",
              align: "right",
              render: (r) =>
                r.returnValue > 0 ? (
                  <span className="text-error">-{formatCurrency(r.returnValue)}</span>
                ) : (
                  "0"
                ),
            },
            {
              key: "diffReturn",
              label: "Chênh lệch trả",
              align: "right",
              render: (r) => hienChenh(r.diffReturn),
            },
            {
              key: "net",
              label: "Doanh thu thuần",
              align: "right",
              render: (r) => (
                <span className="font-semibold text-primary">
                  {formatCurrency(r.netRevenue)}
                </span>
              ),
            },
            {
              key: "diffNet",
              label: "Chênh lệch thuần",
              align: "right",
              render: (r) => <span className="font-semibold">{hienChenh(r.diffNet)}</span>,
            },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${employeeSummaryRows.length}` },
                { content: hienSLTheoDonVi(totalsSummaryQty), align: "right" },
                { content: "" },
                {
                  content: formatCurrency(
                    employeeSummaryRows.reduce((s, r) => s + r.listed, 0)
                  ),
                  align: "right",
                },
                {
                  content: formatCurrency(
                    employeeSummaryRows.reduce((s, r) => s + r.revenue, 0)
                  ),
                  align: "right",
                },
                { content: hienChenh(employeeSummaryRows.reduce((s, r) => s + r.diff, 0)), align: "right" },
                {
                  content: (() => {
                    const v = employeeSummaryRows.reduce((s, r) => s + r.docDiscount, 0)
                    return v > 0 ? `-${formatCurrency(v)}` : "0"
                  })(),
                  align: "right",
                  className: "text-error",
                },
                { content: hienSLTheoDonVi(totalsSummaryReturnQty), align: "right" },
                {
                  content: (() => {
                    const v = employeeSummaryRows.reduce((s, r) => s + r.returnValue, 0)
                    return v > 0 ? `-${formatCurrency(v)}` : "0"
                  })(),
                  align: "right",
                  className: "text-error",
                },
                { content: hienChenh(employeeSummaryRows.reduce((s, r) => s + r.diffReturn, 0)), align: "right" },
                {
                  content: formatCurrency(
                    employeeSummaryRows.reduce((s, r) => s + r.netRevenue, 0)
                  ),
                  align: "right",
                  className: "text-primary",
                },
                { content: hienChenh(employeeSummaryRows.reduce((s, r) => s + r.diffNet, 0)), align: "right" },
              ]}
            />
          }
          expandable={(r) => (
            /* ⚠ Chủ nhà 09/10/2026: "Xem chi tiết từng nhân viên: thêm cột bảng giá (theo đơn vị), giá bán (theo đơn
               vị), SL thực bán (sl bán - sl trả)". Mỗi dòng là một mặt hàng × ĐƠN VỊ TÍNH của dòng hoá đơn / phiếu trả:
               giá chỉ so được trên cùng đơn vị (luật chênh 01/10/2026), SL không quy đổi. Mặt hàng bán nhiều đơn vị có
               thêm dòng "Cộng" quy về đơn vị cơ sở. */
            <div className="rounded-md border border-border/40 bg-background/60 overflow-x-auto" data-testid="nv-hang-ban-chi-tiet">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#ecfdf3]/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã hàng</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Tên hàng</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Đơn vị</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL bán</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Bảng giá (theo ĐVT)</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá bán (theo ĐVT)</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Theo bảng giá</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Chênh lệch bán</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL trả</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị trả</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Chênh lệch trả</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL thực bán</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">DT thuần</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Chênh thuần</th>
                  </tr>
                </thead>
                <tbody>
                  {r.products.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="px-3 py-2 text-center text-xs text-muted-foreground">
                        Không có dòng hàng
                      </td>
                    </tr>
                  ) : (
                    r.products.flatMap((p) => [
                      ...p.donVi.map((d, i) => (
                        <tr key={`${p.productId}|${d.unit}`} className="border-t border-border/30">
                          <td className="px-3 py-1.5 font-mono text-xs text-primary">{i === 0 ? p.sku : ""}</td>
                          <td className="px-3 py-1.5">{i === 0 ? p.name : ""}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {d.unit || "—"}
                            {d.heSo > 1 && p.unit ? (
                              <span className="text-xs text-muted-foreground"> ({d.heSo.toLocaleString("vi-VN")} {p.unit})</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.qty.toLocaleString("vi-VN")}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.giaBang > 0 ? formatCurrency(d.giaBang) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.giaBan != null ? formatCurrency(d.giaBan) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(d.listed)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(d.revenue)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{hienChenh(d.diff)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {d.returnQty ? d.returnQty.toLocaleString("vi-VN") : "0"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {d.returnValue > 0 ? <span className="text-error">-{formatCurrency(d.returnValue)}</span> : "0"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{hienChenh(d.diffReturn)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{d.netQty.toLocaleString("vi-VN")}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(d.netRevenue)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{hienChenh(d.diffNet)}</td>
                        </tr>
                      )),
                      ...(p.donVi.length > 1
                        ? [
                            <tr key={`${p.productId}|cong`} className="border-t border-border/30 bg-muted/30 text-xs">
                              <td className="px-3 py-1.5" />
                              <td className="px-3 py-1.5 text-muted-foreground">Cộng {p.name}</td>
                              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">quy về {p.unit || "ĐV cơ sở"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{p.qty.toLocaleString("vi-VN")}</td>
                              <td className="px-3 py-1.5" />
                              <td className="px-3 py-1.5" />
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(p.listed)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(p.revenue)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{hienChenh(p.diff)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{p.returnQty ? p.returnQty.toLocaleString("vi-VN") : "0"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {p.returnValue > 0 ? <span className="text-error">-{formatCurrency(p.returnValue)}</span> : "0"}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{hienChenh(p.diffReturn)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{p.netQty.toLocaleString("vi-VN")}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(p.netRevenue)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{hienChenh(p.diffNet)}</td>
                            </tr>,
                          ]
                        : []),
                    ])
                  )}
                </tbody>
              </table>
            </div>
          )}
        />
      ) : (
        <ReportTable
          rows={employeeProductRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium text-primary">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "skus", label: "Số mặt hàng", align: "right", render: (r) => r.products.length },
            { key: "qty", label: "Tổng SL", align: "right", render: (r) => hienSLTheoDonVi(r.qtyTheoDv) },
            { key: "rev", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.revenue)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${employeeProductRows.length}`, colSpan: 3 },
                { content: hienSLTheoDonVi(totalsProducts.qtyTheoDv), align: "right" },
                { content: formatCurrency(totalsProducts.revenue), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="space-y-2">
              {r.products.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Nhân viên này chưa có hàng bán
                </p>
              ) : (
                r.products.map((p) => (
                  <div key={p.id} className="rounded-md border border-border/40 bg-background/60 overflow-x-auto">
                    <div className="flex items-center justify-between border-b border-border/40 bg-[#ecfdf3]/60 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-primary">{p.sku}</span>
                        <span className="font-medium">{p.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        SL: <span className="font-semibold text-foreground">{p.qty.toLocaleString("vi-VN")}{p.unit ? ` ${p.unit}` : ""}</span>
                        <span className="mx-2">·</span>
                        DT thuần: <span className="font-semibold text-primary">{formatCurrency(p.revenue)}</span>
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase">Khách hàng</th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">SL</th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">DT thuần</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.customers.map((c) => (
                          <tr key={c.id} className="border-t border-border/30">
                            <td className="px-3 py-1.5">{c.store_name}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {c.qty.toLocaleString("vi-VN")}
                              {p.unit ? ` ${p.unit}` : ""}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {formatCurrency(c.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}
        />
      )}
    </ReportShell>
  )
}
