"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { viMatchAllWords } from "@/lib/search"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useLuotNap } from "@/hooks/use-luot-nap"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { locBienThe } from "@/lib/permissions"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField, FilterMultiSelect } from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  fetchRevenueInvoicesDu,
  fetchInvoiceLines,
  fetchReturnsRowsDu,
  fetchReturnCosts,
  fetchReturnLines,
  fetchCogsForRange,
  fetchOrgRows,
  vnDateOf,
  giamGiaHoaDon,
  giaVonBinhQuanCoSo,
  giaTriDongKho,
  soLuongCoSoDongHd,
  type InvoiceLineRow,
  type RevenueInvoiceRow,
  type StockExportLineRow,
  type ReturnLineRow,
  type ReturnSummaryRow as ReturnRowMeta,
} from "@/lib/analytics/sales"
import type { SanPhamQuyDoi } from "@/lib/analytics/units"
import {
  congLoiNhuanNhanVien,
  congLoiNhuanTheoNgay,
  giaVonTraCuaPhieu,
  nhanVienPhieuTra,
  phanTienQuaLoc,
  coDongQuaLoc,
} from "@/lib/analytics/hang-ban-nhan-vien"
import { errorMessage } from "@/lib/errors"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { ByTimeView, type DayBucket } from "./_views/by-time"
import { ProfitByTimeView, type ProfitByDayRow } from "./_views/by-profit"
import { DiscountView, type DiscountRow } from "./_views/by-discount"
import { ReturnsView, type ReturnSummaryRow } from "./_views/by-returns"
import { EmployeeView, type EmployeeRow } from "./_views/by-employee"

type Variant = "time" | "profit" | "discount" | "returns" | "employee"

const VARIANTS = [
  { key: "time" as const, label: "Thời gian" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "discount" as const, label: "Giảm giá HĐ" },
  { key: "returns" as const, label: "Trả hàng" },
  { key: "employee" as const, label: "Nhân viên" },
] as const

interface CustomerRow {
  id: string
  store_name: string
}
/** Mặt hàng: NCC + đơn vị quy đổi (dòng hóa đơn thiếu hệ số chụp mới cần). */
type SanPhamBaoCao = SanPhamQuyDoi & { id: string; primary_supplier_id: string | null }
interface UserRow {
  id: string
  full_name: string
  role: string
}
const ROLE_LABEL: Record<string, string> = {
  owner: "Chủ DN",
  manager: "Quản lý",
  accountant: "Kế toán",
  sales: "NV Bán hàng",
  warehouse: "Thủ kho",
  driver: "Tài xế",
}

export default function SalesReportPage() {
  const { user: nguoiXem, loading: authLoading } = useRoleGuard("reports")
  /* ⚠ Chủ nhà 25/09/2026: NVBH không xem giá vốn / lãi / giá trị kho của NPP. */
  const bienThe = locBienThe(nguoiXem?.role, VARIANTS)
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("time")
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  // Hóa đơn ĐÃ GHI SỔ trong kỳ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  const [invoices, setInvoices] = useState<RevenueInvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [returns, setReturns] = useState<ReturnRowMeta[]>([])
  // Dòng hàng trả (không gồm hàng đổi) — để lọc NCC và chia tiền phiếu trả theo dòng.
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  // Giá vốn hàng trả ĐÃ NHẬP LẠI KHO theo phiếu — trừ khỏi giá vốn (mig 192).
  const [returnCosts, setReturnCosts] = useState<Awaited<ReturnType<typeof fetchReturnCosts>>>(new Map())
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [stockLines, setStockLines] = useState<StockExportLineRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [productSupplierMap, setProductSupplierMap] = useState<Map<string, string | null>>(new Map())
  const [productMap, setProductMap] = useState<Map<string, SanPhamBaoCao>>(new Map())
  const [supplierFilter, setSupplierFilter] = useState<string[]>([])
  const [priceListFilter, setPriceListFilter] = useState<string[]>([])
  const [routeFilter, setRouteFilter] = useState<string[]>([])
  const catalogs = useFilterCatalogs(user?.org_id)
  // Customer → group_id map (for bảng giá / kênh bán filtering on orders)
  const [customerGroupMap, setCustomerGroupMap] = useState<Map<string, string | null>>(new Map())
  const [customerRouteMap, setCustomerRouteMap] = useState<Map<string, string | null>>(new Map())

  const batLuot = useLuotNap()
  const load = useCallback(async () => {
    if (!user?.org_id) return
    const conMoi = batLuot()
    /**
     * ⚠ ĐỌC HỎNG THÌ NÓI RA. Bản cũ đọc phiếu xuất và dòng phiếu kho trần
     *   (1.000 dòng, `.in` cả danh sách id — URL quá dài), lỗi chỉ
     *   `console.error`, dòng kho thành [] → giá vốn 0, lãi 100% ở tab
     *   Lợi nhuận và Nhân viên. Nay đi chung đường giá vốn với màn Tài
     *   chính (`fetchCogsForRange`), hỏng thì ném và dải báo thay bảng số.
     */
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      const [invoiceRes, returnsRes, customersRes, usersRes, cogsRes, suppliersRes, productsRes] = await Promise.all([
        fetchRevenueInvoicesDu(supabase, orgId, range),
        fetchReturnsRowsDu(supabase, orgId, range),
        fetchOrgRows<CustomerRow & { group_id: string | null; channel: string | null }>(
          supabase, "customers", orgId, "id, store_name, group_id, channel", "đọc khách hàng"
        ),
        fetchOrgRows<UserRow>(supabase, "users", orgId, "id, full_name, role", "đọc nhân viên"),
        fetchCogsForRange(supabase, orgId, range),
        fetchOrgRows<{ id: string; name: string }>(supabase, "suppliers", orgId, "id, name", "đọc nhà cung cấp"),
        fetchOrgRows<SanPhamBaoCao>(
          supabase, "products", orgId, "id, base_unit, primary_supplier_id, units:product_units(unit_name, conversion)", "đọc mặt hàng"
        ),
      ])
      /* ⚠ Giá vốn hàng trả đọc hỏng thì NÉM (dải báo lỗi), đừng thành 0 — 0 là
         giá vốn thuần cao giả, lãi hạ oan. */
      const [linesList, returnCostMap, returnLinesList] = await Promise.all([
        fetchInvoiceLines(supabase, invoiceRes.rows.map((o) => o.id)),
        fetchReturnCosts(supabase, returnsRes.rows.map((r) => r.id)),
        fetchReturnLines(supabase, returnsRes.rows.map((r) => r.id)),
      ])
      if (conMoi()) setTruncated(
        invoiceRes.truncated || returnsRes.truncated || customersRes.truncated || usersRes.truncated ||
          cogsRes.truncated || suppliersRes.truncated || productsRes.truncated
      )
      if (conMoi()) setInvoices(invoiceRes.rows)
      if (conMoi()) setLines(linesList)
      if (conMoi()) setReturns(returnsRes.rows)
      if (conMoi()) setReturnLines(returnLinesList)
      if (conMoi()) setReturnCosts(returnCostMap)
      if (conMoi()) setCustomers(customersRes.rows)
      const groupMap = new Map<string, string | null>()
      const routeMap = new Map<string, string | null>()
      for (const c of customersRes.rows) {
        groupMap.set(c.id, c.group_id)
        routeMap.set(c.id, c.channel)
      }
      if (conMoi()) setCustomerGroupMap(groupMap)
      if (conMoi()) setCustomerRouteMap(routeMap)
      if (conMoi()) setUsers(usersRes.rows)
      if (conMoi()) setStockLines(cogsRes.lines)
      if (conMoi()) setSuppliers(suppliersRes.rows.slice().sort((x, y) => x.name.localeCompare(y.name, "vi")))
      const psMap = new Map<string, string | null>()
      const spMap = new Map<string, SanPhamBaoCao>()
      for (const p of productsRes.rows) {
        psMap.set(p.id, p.primary_supplier_id)
        spMap.set(p.id, p)
      }
      if (conMoi()) setProductSupplierMap(psMap)
      if (conMoi()) setProductMap(spMap)
    } catch (err) {
      if (conMoi()) setLoadError(errorMessage(err))
    } finally {
      if (conMoi()) setLoading(false)
    }
  }, [user?.org_id, range, supabase, batLuot])

  useEffect(() => {
    load()
  }, [load])

  /* ⚠ LỌC NCC (chọn nhiều) = PHẦN TIỀN của hàng NCC ấy — cùng luật Báo cáo tổng hợp / báo cáo Nhân viên
     (`phanTienQuaLoc`): chứng từ có ≥ 1 dòng (không phải hàng đổi) qua lọc, tiền chứng từ chia theo tỉ lệ `line_total`.
     Bản cũ giữ NGUYÊN tiền hoá đơn có một dòng của NCC, không lọc phiếu trả, tab Giảm giá cộng nguyên giảm giá HĐ
     (rà báo cáo 09/10/2026). */
  const coLocHang = supplierFilter.length > 0
  const quaHang = useCallback(
    (pid: string) => supplierFilter.includes(productSupplierMap.get(pid) || ""),
    [supplierFilter, productSupplierMap]
  )
  const filteredLines = useMemo(() => (coLocHang ? lines.filter((l) => quaHang(l.product_id)) : lines), [lines, coLocHang, quaHang])
  const dongTheoHd = useMemo(() => {
    const m = new Map<string, InvoiceLineRow[]>()
    for (const l of lines) {
      const a = m.get(l.invoice_id)
      if (a) a.push(l)
      else m.set(l.invoice_id, [l])
    }
    return m
  }, [lines])
  const dongTheoTra = useMemo(() => {
    const m = new Map<string, ReturnLineRow[]>()
    for (const l of returnLines) {
      const a = m.get(l.return_id)
      if (a) a.push(l)
      else m.set(l.return_id, [l])
    }
    return m
  }, [returnLines])

  // Bộ lọc cấp KHÁCH (bảng giá + kênh bán) — dùng chung cho hóa đơn và phiếu trả.
  const customerPasses = useMemo(() => {
    const matchVals = new Set<string>()
    for (const rid of routeFilter) {
      const route = catalogs.routes.find((r) => r.id === rid)
      for (const v of [route?.id, route?.label, route?.hint]) if (v) matchVals.add(v)
    }
    return (customerId: string) => {
      if (priceListFilter.length > 0 && !priceListFilter.includes(customerGroupMap.get(customerId) || "")) return false
      if (routeFilter.length > 0) {
        const ch = customerRouteMap.get(customerId)
        if (!ch || !matchVals.has(ch)) return false
      }
      return true
    }
  }, [priceListFilter, customerGroupMap, routeFilter, catalogs.routes, customerRouteMap])

  /** Hoá đơn qua lọc; đang lọc NCC thì `total` = phần của các dòng NCC ấy (`subtotal` giữ nguyên để tính giảm giá). */
  const filteredInvoices = useMemo<RevenueInvoiceRow[]>(() => {
    const out: RevenueInvoiceRow[] = []
    for (const o of invoices) {
      if (!customerPasses(o.customer_id)) continue
      if (!coLocHang) {
        out.push(o)
        continue
      }
      const ls = dongTheoHd.get(o.id) || []
      if (!coDongQuaLoc(ls, quaHang)) continue
      out.push({ ...o, total: phanTienQuaLoc(Number(o.total || 0), ls, quaHang) })
    }
    return out
  }, [invoices, customerPasses, coLocHang, dongTheoHd, quaHang])

  /**
   * Phiếu trả qua CÙNG bộ lọc với hóa đơn — lọc bảng giá / kênh mà trừ hàng trả của cả sổ là doanh số thuần âm oan.
   * Đang lọc NCC: phiếu có dòng của NCC ấy, tiền ghi có = phần của các dòng ấy.
   */
  const filteredReturns = useMemo(() => {
    const out: ReturnRowMeta[] = []
    for (const r of returns) {
      if (!customerPasses(r.customer_id)) continue
      if (!coLocHang) {
        out.push(r)
        continue
      }
      const ls = dongTheoTra.get(r.id) || []
      if (!coDongQuaLoc(ls, quaHang)) continue
      out.push({ ...r, credit_note_amount: phanTienQuaLoc(Number(r.credit_note_amount || 0), ls, quaHang) })
    }
    return out
  }, [returns, customerPasses, coLocHang, dongTheoTra, quaHang])

  // Lọc NCC phía giá vốn hàng trả — cùng bộ lọc với dòng hóa đơn.
  const supplierPasses = coLocHang ? quaHang : undefined
  // Đang lọc (NCC / bảng giá / kênh) — giá vốn tab Lợi nhuận phải là của ĐÚNG hàng đã lọc.
  const dangLoc = coLocHang || priceListFilter.length > 0 || routeFilter.length > 0

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  // -------------------- Thời gian --------------------
  const timeBuckets: DayBucket[] = useMemo(() => {
    const map = new Map<string, DayBucket>()
    for (const o of filteredInvoices) {
      const d = String(o.invoice_date).slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, returnValue: 0, netRevenue: 0, invoices: [] }
      e.revenue += Number(o.total || 0)
      const code = o.invoice_code
      if (
        !search ||
        viMatchAllWords(search, code, customerMap.get(o.customer_id)?.store_name)
      ) {
        e.invoices.push({
          id: o.id,
          code,
          time: new Date(o.invoice_date).toLocaleString("vi-VN"),
          customer: customerMap.get(o.customer_id)?.store_name || "—",
          total: Number(o.total || 0),
        })
      }
      map.set(d, e)
    }
    for (const r of filteredReturns) {
      const d = String(r.created_at).slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, returnValue: 0, netRevenue: 0, invoices: [] }
      e.returnValue += Number(r.credit_note_amount || 0)
      map.set(d, e)
    }
    return Array.from(map.values())
      .map((b) => ({ ...b, netRevenue: b.revenue - b.returnValue }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredInvoices, filteredReturns, customerMap, search])

  // -------------------- Lợi nhuận --------------------
  /**
   * ⚠ LÃI GỘP THUẦN (chủ nhà 25/09/2026: "Rà soát lại toàn bộ doanh số tính bằng
   *   số đi - số trả"). Doanh thu = hóa đơn theo `invoice_date` − hàng trả theo
   *   ngày trừ doanh số; giá vốn = giá vốn xuất − giá vốn hàng trả đã nhập lại kho.
   *   Bản cũ lấy nguyên tiền hóa đơn − giá vốn xuất: ngày có hàng trả thì lãi phồng.
   */
  const profitRows: ProfitByDayRow[] = useMemo(() => {
    if (!dangLoc) {
      // Không lọc: giá vốn xuất = phiếu XUẤT đã ghi sổ (`fetchCogsForRange`), theo ngày Việt Nam, SL cơ sở × giá vốn
      // cơ sở — khớp màn Tài chính. Giá vốn hàng trả đi cặp: mọi phiếu trả của kỳ.
      const giaVonXuat = stockLines
        .filter((l) => l.posted_at)
        .map((l) => ({ ngay: vnDateOf(l.posted_at as string), giaVon: giaTriDongKho(l) }))
      const giaVonTra = returns.map((r) => ({
        ngay: String(r.created_at).slice(0, 10),
        giaVon: giaVonTraCuaPhieu(returnCosts.get(r.id)),
      }))
      return congLoiNhuanTheoNgay({ hoaDon: filteredInvoices, phieuTra: filteredReturns, giaVonXuat, giaVonTra })
    }
    /* ⚠ ĐANG LỌC: giá vốn của ĐÚNG hàng đã lọc — dòng hoá đơn qua lọc × giá vốn bình quân cơ sở của kỳ (như tab Nhân
       viên), giá vốn hàng trả của các phiếu đã lọc. Bản cũ lấy doanh thu ĐÃ LỌC trừ giá vốn CẢ SỔ → lãi âm vô lý
       (rà báo cáo 09/10/2026). */
    const avgCost = giaVonBinhQuanCoSo(stockLines)
    const giaVonXuat = filteredInvoices.map((o) => {
      let giaVon = 0
      for (const l of dongTheoHd.get(o.id) || []) {
        if (coLocHang && !quaHang(l.product_id)) continue
        giaVon += soLuongCoSoDongHd(l, productMap.get(l.product_id)) * (avgCost.get(l.product_id) || 0)
      }
      return { ngay: String(o.invoice_date).slice(0, 10), giaVon }
    })
    const giaVonTra = filteredReturns.map((r) => ({
      ngay: String(r.created_at).slice(0, 10),
      giaVon: giaVonTraCuaPhieu(returnCosts.get(r.id), supplierPasses),
    }))
    return congLoiNhuanTheoNgay({ hoaDon: filteredInvoices, phieuTra: filteredReturns, giaVonXuat, giaVonTra })
  }, [dangLoc, filteredInvoices, filteredReturns, returns, returnCosts, stockLines, dongTheoHd, coLocHang, quaHang, productMap, supplierPasses])

  // -------------------- Giảm giá HĐ --------------------
  const discountRows: DiscountRow[] = useMemo(() => {
    // Hóa đơn không có cột giảm giá: giảm = Σ dòng − subtotal (mig 183) — tính trên MỌI dòng của tờ. Đang lọc NCC thì
    // giảm giá / tạm tính là PHẦN của các dòng NCC ấy (chia theo tỉ lệ `line_total`, như tiền hoá đơn).
    return filteredInvoices
      .map((o) => {
        const ls = dongTheoHd.get(o.id) || []
        const giamHd = giamGiaHoaDon(o, ls)
        if (!coLocHang) return { o, giam: giamHd, tamTinh: Number(o.subtotal || 0) + giamHd }
        const tamTinh = ls.filter((l) => quaHang(l.product_id)).reduce((t, l) => t + Number(l.line_total || 0), 0)
        return { o, giam: phanTienQuaLoc(giamHd, ls, quaHang), tamTinh }
      })
      .filter(({ giam }) => giam > 0)
      .filter(({ o }) => {
        if (!search) return true
        return (
          viMatchAllWords(search, o.invoice_code, customerMap.get(o.customer_id)?.store_name)
        )
      })
      .map(({ o, giam, tamTinh }) => {
        // Tạm tính = tiền hàng TRƯỚC giảm giá cả đơn.
        const subtotal = tamTinh
        return {
          id: o.id,
          order_code: o.invoice_code,
          order_date: o.invoice_date,
          customer: customerMap.get(o.customer_id)?.store_name || "—",
          subtotal,
          discount: giam,
          total: Number(o.total || 0),
          pct: subtotal > 0 ? (giam / subtotal) * 100 : 0,
        }
      })
      .sort((a, b) => b.discount - a.discount)
  }, [filteredInvoices, dongTheoHd, coLocHang, quaHang, customerMap, search])

  // -------------------- Trả hàng --------------------
  const returnsRows: ReturnSummaryRow[] = useMemo(() => {
    // ⚠ Qua CÙNG bộ lọc với các tab khác (bảng giá / kênh / NCC — tiền là phần của hàng đã lọc). Bản cũ liệt kê mọi
    // phiếu trả của kỳ dù đang lọc (rà báo cáo 09/10/2026).
    return filteredReturns
      .filter((r) => {
        if (!search) return true
        return viMatchAllWords(search, customerMap.get(r.customer_id)?.store_name)
      })
      .map((r) => ({
        id: r.id,
        date: r.created_at,
        customer: customerMap.get(r.customer_id)?.store_name || "—",
        reason: "—", // table doesn't include reason in our shape
        status: r.status,
        amount: Number(r.credit_note_amount || 0),
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [filteredReturns, customerMap, search])

  // -------------------- Nhân viên --------------------
  // Nhân viên của phiếu trả: tên trên phiếu → NV hóa đơn gắn → NV hóa đơn gần
  // nhất của khách — một luật với báo cáo Nhân viên (`nhanVienPhieuTra`).
  const nvPhieuTra = useMemo(() => nhanVienPhieuTra(returns, invoices), [returns, invoices])

  /**
   * ⚠ DOANH THU / TB/HĐ / LỢI NHUẬN THUẦN theo nhân viên (chủ nhà 25/09/2026: "Rà
   *   soát lại toàn bộ doanh số tính bằng số đi - số trả"). Phiếu trả không quy được
   *   về ai gom vào dòng "Chưa gán nhân viên" — bỏ đi thì tổng tab này lệch tab
   *   Thời gian.
   */
  const employeeRows: EmployeeRow[] = useMemo(() => {
    // attribute COGS by line aggregated to order
    const lineByInvoice = new Map<string, InvoiceLineRow[]>()
    for (const l of filteredLines) {
      const a = lineByInvoice.get(l.invoice_id) || []
      a.push(l)
      lineByInvoice.set(l.invoice_id, a)
    }
    // Giá vốn bình quân mỗi đơn vị cơ sở (dòng từ `fetchCogsForRange` đã là SL cơ sở).
    const avgCost = giaVonBinhQuanCoSo(stockLines)
    const giaVonHoaDon = (invoiceId: string) => {
      let cogs = 0
      for (const l of lineByInvoice.get(invoiceId) || []) {
        // SL dòng hóa đơn quy về đơn vị cơ sở trước khi nhân giá vốn cơ sở.
        cogs += soLuongCoSoDongHd(l, productMap.get(l.product_id)) * (avgCost.get(l.product_id) || 0)
      }
      return cogs
    }
    return congLoiNhuanNhanVien({
      hoaDon: filteredInvoices,
      giaVonHoaDon,
      phieuTra: filteredReturns,
      nvPhieuTra,
      giaVonTra: returnCosts,
      matHangQua: supplierPasses,
    })
      .map((r) => {
        const u = userMap.get(r.id)
        return {
          id: r.id,
          name: r.id ? u?.full_name || "—" : "Chưa gán nhân viên",
          role: r.id ? ROLE_LABEL[u?.role || ""] || u?.role || "—" : "—",
          orders: r.orders,
          revenue: r.revenue,
          cogs: r.cogs,
          profit: r.profit,
          aov: r.orders > 0 ? r.revenue / r.orders : 0,
        }
      })
      .filter((r) => {
        if (!search) return true
        return viMatchAllWords(search, r.name)
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [
    filteredInvoices, filteredLines, filteredReturns, nvPhieuTra, returnCosts,
    stockLines, userMap, productMap, supplierPasses, search,
  ])

  const handleExport = () => {
    if (variant === "time") {
      const out: (string | number)[][] = [["Thời gian", "Doanh thu", "Giá trị trả", "Doanh thu thuần"]]
      for (const r of timeBuckets) out.push([r.label, r.revenue, -r.returnValue, r.netRevenue])
      downloadXlsx(`bao-cao-banhang-thoigian-${range.from}-${range.to}`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [["Thời gian", "Doanh thu thuần", "Giá vốn thuần", "Lợi nhuận", "Biên LN (%)"]]
      for (const r of profitRows) out.push([r.label, r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      downloadXlsx(`bao-cao-banhang-loinhuan-${range.from}-${range.to}`, out)
    } else if (variant === "discount") {
      const out: (string | number)[][] = [["Mã HĐ", "Ngày", "Khách hàng", "Tạm tính", "Giảm giá", "Thành tiền", "% giảm"]]
      for (const r of discountRows)
        out.push([r.order_code, r.order_date, r.customer, r.subtotal, r.discount, r.total, r.pct.toFixed(2)])
      downloadXlsx(`bao-cao-banhang-giamgia-${range.from}-${range.to}`, out)
    } else if (variant === "returns") {
      const out: (string | number)[][] = [["Mã trả", "Ngày", "Khách hàng", "Trạng thái", "Giá trị trả"]]
      for (const r of returnsRows) out.push([r.id, r.date, r.customer, r.status, r.amount])
      downloadXlsx(`bao-cao-banhang-trahang-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [["Nhân viên", "Vai trò", "Số HĐ", "Doanh thu thuần", "Giá vốn thuần", "Lợi nhuận", "TB/HĐ"]]
      for (const r of employeeRows)
        out.push([r.name, r.role, r.orders, r.revenue, r.cogs, r.profit, r.aov])
      downloadXlsx(`bao-cao-banhang-nhanvien-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportShell
      title="Báo cáo bán hàng"
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
      filters={
        <>
          <FilterField label="Tìm kiếm">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mã HĐ, khách hàng, NV…"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
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
          <FilterField label="Bảng giá (chọn nhiều)">
            <FilterMultiSelect
              value={priceListFilter}
              onChange={setPriceListFilter}
              options={catalogs.customerGroups}
              placeholder="Tất cả bảng giá"
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
          {/* ⚠ Đã BỎ ô "Phương thức bán hàng" (24/09/2026): sổ không ghi thông tin
              này ở đâu (không cột `sales_method`) — chọn là ra rỗng. */}
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
      ) : variant === "time" ? (
        <ByTimeView buckets={timeBuckets} />
      ) : variant === "profit" ? (
        <ProfitByTimeView rows={profitRows} />
      ) : variant === "discount" ? (
        <DiscountView rows={discountRows} />
      ) : variant === "returns" ? (
        <ReturnsView rows={returnsRows} />
      ) : (
        <EmployeeView rows={employeeRows} />
      )}
    </ReportShell>
  )
}
