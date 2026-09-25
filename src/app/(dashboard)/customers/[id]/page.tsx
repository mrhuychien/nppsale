"use client"

import { vnDateKey } from "@/lib/orders/status-tone"
import { useEffect, useMemo, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { useAuth } from "@/hooks/use-auth"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { newOrderHref } from "@/lib/nav/new-order"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CustomerPhotoCapture } from "@/components/customers/customer-photo-capture"
import { CustomerManagers } from "@/components/customers/customer-managers"
import { buildManagers, type Manager } from "@/lib/customers/managers"
import { CustomerForm } from "@/components/customers/customer-form"
import { AssignmentManager } from "@/components/customers/assignment-manager"
import { CustomerProfileCard } from "@/components/customers/customer-profile-card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { StickyActionBar } from "@/components/ui/sticky-action-bar"
import { formatCurrency, formatDate } from "@/lib/utils"
import { fullCustomerAddress } from "@/lib/customers/address"
import {
  customerInitial, daysSinceVN, todayVN,
} from "@/lib/customers/list-view"
import {
  debtBuckets, frequentProducts, revenueCompareText, customerTodos, mergeActivity,
  type ActivityItem,
} from "@/lib/customers/profile-stats"
import { ORDER_STATUS_MAP, INVOICE_STATUS_MAP, PAYMENT_METHOD_LABEL } from "@/lib/constants"
import { Badge } from "@/components/ui/badge"
import { VisitCheckinDialog } from "@/components/customers/visit-checkin-dialog"
import {
  Trash2, ArrowRight, Banknote, Navigation, MapPin, Camera, FilePlus2, Pencil, Phone,
} from "lucide-react"
import type { Customer, CustomerAssignment } from "@/types"
import { errorMessage } from "@/lib/errors"
import { traCuaKhach, traTheoHoaDon } from "@/lib/analytics/net-revenue"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"

interface OrderRow {
  id: string
  order_code: string
  order_date: string
  total: number
  status: string
}

interface PriceRow {
  id: string
  product_id: string
  group_id: string | null
  unit_name: string
  price: number
  effective_from: string | null
  effective_to: string | null
  product?: { name: string; sku: string; base_unit: string }
  group?: { name: string } | null
}

interface ReceivableRow {
  amount: number
  paid: number
  due_date: string | null
}

interface VisitRow {
  id: string
  visit_date: string
  check_in_at: string | null
  check_out_at: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  result: string | null
  notes: string | null
  photo_url: string | null
  sales_user?: { full_name?: string } | null
}

/** Số đơn gần nhất được kéo dòng hàng về để dựng "Sản phẩm hay lấy". */
const LINE_SCAN_ORDERS = 40
/** Trần ảnh điểm bán — khớp với `customer_photos.slot BETWEEN 1 AND 3`. */
const MAX_PHOTOS = 3

const DOW_LABEL = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"]

const VISIT_RESULT: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "secondary" | "danger" }
> = {
  order_placed: { label: "Đã đặt đơn", variant: "success" },
  no_order: { label: "Không đặt đơn", variant: "secondary" },
  closed: { label: "Đóng cửa", variant: "warning" },
  not_visited: { label: "Chưa ghé", variant: "danger" },
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("customers")
  const { groups } = useCustomerGroups()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [assignments, setAssignments] = useState<CustomerAssignment[]>([])
  // Tên người TẠO điểm bán. Tra riêng: người tạo có thể đã nghỉ, hoặc
  // không nằm trong danh sách đang phụ trách, nên không lấy ké được từ
  // bảng phân công.
  const [creatorName, setCreatorName] = useState<string | null>(null)
  /** Lỗi / chạm trần khi đọc đơn và công nợ — phải HIỆN, không để số trông như đúng. */
  const [statsError, setStatsError] = useState<string | null>(null)
  const [statsTruncated, setStatsTruncated] = useState(false)
  /** Ai phụ trách điểm bán này + mỗi người bán ngành hàng gì. */
  const [managers, setManagers] = useState<Manager[]>([])
  const [routeLabel, setRouteLabel] = useState<string | null>(null)
  /** Ngày trong tuần có xếp điểm này vào tuyến cố định. */
  const [visitSchedule, setVisitSchedule] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // KPI state
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [lastMonthRevenue, setLastMonthRevenue] = useState(0)
  const [totalOrders, setTotalOrders] = useState(0)
  const [orderFrequency, setOrderFrequency] = useState(0)

  // Tab data
  const [receivables, setReceivables] = useState<ReceivableRow[]>([])
  const [recentOrders, setRecentOrders] = useState<OrderRow[]>([])
  const [allOrders, setAllOrders] = useState<OrderRow[]>([])
  /** Số dòng hàng của từng đơn gần đây — cột "N mặt hàng" trong mẫu. */
  const [orderLineCount, setOrderLineCount] = useState<Record<string, number>>({})
  const [orderSummary, setOrderSummary] = useState<Record<string, string>>({})
  const [frequent, setFrequent] = useState<ReturnType<typeof frequentProducts>>([])
  const [photoCount, setPhotoCount] = useState(0)
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  /**
   * Hóa đơn bán + các khoản thanh toán của khách — tab "Giao dịch".
   *
   * ⚠ ĐƠN HÀNG KHÔNG PHẢI GIAO DỊCH. Đơn là lời đặt; giao dịch là tờ hóa
   *   đơn đã ghi sổ và số tiền đã thu. Kế toán ngồi đối chiếu với khách
   *   cần đúng hai thứ sau, còn đơn chỉ để truy nguồn.
   */
  const [allInvoices, setAllInvoices] = useState<Array<{
    id: string; invoice_code: string; invoice_date: string; total: number; status: string
  }>>([])
  /** Khoản trả đã trừ vào từng hóa đơn (mig 192) — cột tiền hiện SỐ CÒN LẠI. */
  const [traHD, setTraHD] = useState<Map<string, number>>(new Map())
  const [allPayments, setAllPayments] = useState<Array<{
    id: string; amount: number; method: string; collected_at: string
  }>>([])
  const [priceRows, setPriceRows] = useState<PriceRow[]>([])
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [visitDialogOpen, setVisitDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")

  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const now = new Date()
    /* ⚠ `invoice_date` là DATE: so bằng NGÀY theo giờ VN, không bằng mốc UTC —
       nửa đêm 01/09 giờ VN là 31/08 17:00Z, so kiểu ngày là lọt cả ngày 31/08. */
    const [nam, thang] = vnDateKey(now).split("-").map(Number)
    const ngayDauThang = `${nam}-${String(thang).padStart(2, "0")}-01`
    const ngayDauThangTruoc = thang === 1 ? `${nam - 1}-12-01` : `${nam}-${String(thang - 1).padStart(2, "0")}-01`
    const days90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()

    const [custRes, assignRes] = await Promise.all([
      supabase.from("customers").select("id, org_id, store_name, owner_name, phone, address, province, district, ward, channel, group_id, credit_limit, payment_terms, status, gps_lat, gps_lng, created_at, created_by, billing_name, tax_code, billing_address, billing_email, payment_method_label, group:customer_groups(*)").eq("id", id).single(),
      supabase.from("customer_assignments").select("id, customer_id, user_id, role, assigned_at, status, user:users(*)").eq("customer_id", id),
    ])
    const qErr2 = ([custRes, assignRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr2) console.error("[customers/id] truy vấn lỗi:", qErr2.message)
    if (custRes.data) setCustomer(custRes.data as unknown as Customer)
    const assignRows = (assignRes.data as unknown as CustomerAssignment[]) || []
    setAssignments(assignRows)

    // Ngành hàng của từng người phụ trách. Hỏi RIÊNG hai bảng rồi ghép ở
    // lib thuần: nhúng lồng ba tầng qua PostgREST vừa khó đọc vừa phụ
    // thuộc cách RLS áp lên từng bảng cha.
    // Người tạo — tra tên riêng. `created_by` có thể trỏ tới một nhân
    // viên KHÔNG còn nằm trong danh sách phụ trách (đã nghỉ, đã đổi
    // tuyến), nên lấy ké từ `assignRows` là có lúc ra rỗng.
    const creatorId = (custRes.data as { created_by?: string | null } | null)?.created_by
    if (creatorId) {
      const { data: cu, error: cuErr } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", creatorId)
        .maybeSingle()
      if (cuErr) console.error("[customers/id] truy vấn lỗi:", cuErr.message)
      setCreatorName((cu as { full_name?: string } | null)?.full_name ?? null)
    } else {
      setCreatorName(null)
    }

    const managerIds = Array.from(new Set(assignRows.map((a) => a.user_id).filter(Boolean)))
    if (managerIds.length === 0) {
      setManagers([])
    } else {
      const [linkRes, supRes] = await Promise.all([
        supabase.from("user_suppliers").select("user_id, supplier_id").in("user_id", managerIds),
        supabase.from("suppliers").select("id, name"),
      ])
      const linkErr = [linkRes, supRes].find((r) => r.error)?.error
      if (linkErr) console.error("[customers/id] truy vấn lỗi:", linkErr.message)
      setManagers(
        buildManagers(
          assignRows.map((a) => ({ user_id: a.user_id, role: a.role, status: a.status })),
          assignRows
            .map((a) => a.user)
            .filter((u): u is NonNullable<typeof u> => !!u)
            .map((u) => ({ id: u.id, full_name: u.full_name, is_active: u.is_active })),
          (linkRes.data as Array<{ user_id: string; supplier_id: string }>) || [],
          (supRes.data as Array<{ id: string; name: string }>) || []
        )
      )
    }

    // KPIs + tab data
    const [
      monthOrdersRes,
      prevMonthOrdersRes,
      allOrdersRes,
      receivablesRes,
      last90Res,
      invoicesRes,
      paymentsRes,
      photosRes,
      pjpRes,
    ] = await Promise.all([
      /* ⚠ DOANH THU TÍNH THEO HÓA ĐƠN ĐÃ GHI SỔ (chủ nhà 24/09/2026), theo ngày
         hóa đơn — như `dashboard_summary` (mig 126). Tổng đơn "Hoàn thành" lệch
         khi đơn xuất nhiều đợt, sửa lúc xuất, hay hóa đơn bị huỷ. */
      supabase
        .from("sales_invoices")
        .select("total")
        .eq("customer_id", id)
        .eq("status", "posted")
        .gte("invoice_date", ngayDauThang),
      supabase
        .from("sales_invoices")
        .select("total")
        .eq("customer_id", id)
        .eq("status", "posted")
        .gte("invoice_date", ngayDauThangTruoc)
        .lt("invoice_date", ngayDauThang),
      // ⚠ ĐỌC ĐỦ MỌI TRANG. Đọc trơn thì khách lâu năm dừng ở đúng 1.000
      //   đơn: "Tất cả đơn hàng (1000)", "TB …/đơn" chia sai, mà không báo.
      //   Khoá phụ `id` vì nhiều đơn cùng ngày (trang chạy song song).
      fetchAllForAggregate<OrderRow>((from, to) =>
        supabase
          .from("sales_orders")
          .select("id, order_code, order_date, total, status", { count: "exact" })
          .eq("customer_id", id)
          .order("order_date", { ascending: false })
          .order("id")
          .range(from, to)
      ),
      // ⚠ KÉO CẢ `due_date`: ba ô chia tuổi nợ đọc chính cột này. Thiếu
      //   nó thì mọi khoản rơi hết vào ô "Trong hạn" mà không ai biết.
      // ⚠ Đọc đủ — cùng lý do với đơn hàng ngay trên.
      fetchAllForAggregate<ReceivableRow>((from, to) =>
        supabase
          .from("receivables")
          .select("amount, paid, due_date, status", { count: "exact" })
          .eq("customer_id", id)
          .neq("status", "paid")
          .order("id")
          .range(from, to)
      ),
      supabase
        .from("sales_orders")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", id)
        .gte("order_date", days90Ago),
      // ⚠ HÓA ĐƠN ĐÃ HUỶ VẪN LIỆT KÊ, có nhãn trạng thái. Giấu đi thì
      //   người đối chiếu thấy một khoảng trống giữa hai số hóa đơn và
      //   không biết chuyện gì đã xảy ra ở đó.
      supabase
        .from("sales_invoices")
        .select("id, invoice_code, invoice_date, total, status")
        .eq("customer_id", id)
        .order("invoice_date", { ascending: false })
        .limit(200),
      /**
       * ⚠ ĐI QUA `receivables` VÌ `cash_receipts` KHÔNG CÓ `customer_id`.
       *   Bảng phiếu thu chỉ nối tới khách qua dòng phiếu → công nợ.
       */
      supabase
        .from("payments")
        .select("id, amount, method, collected_at, receivable:receivables!inner(customer_id)")
        .eq("receivable.customer_id", id)
        .order("collected_at", { ascending: false })
        .limit(200),
      supabase
        .from("customer_photos")
        .select("id, gps_accuracy, taken_at")
        .eq("customer_id", id)
        .order("taken_at", { ascending: false }),
      supabase
        .from("pjp_routes")
        .select("day_of_week")
        .eq("customer_id", id)
        .eq("is_active", true)
        .order("day_of_week"),
    ])
    const qErr = ([monthOrdersRes, prevMonthOrdersRes, last90Res, invoicesRes, paymentsRes, photosRes, pjpRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[customers/id] truy vấn lỗi:", qErr.message)
    setStatsError(
      allOrdersRes.error
        ? `Đơn hàng: ${allOrdersRes.error}`
        : receivablesRes.error
          ? `Công nợ: ${receivablesRes.error}`
          : null
    )
    setStatsTruncated(allOrdersRes.truncated || receivablesRes.truncated)

    const sumTotal = (rows: Array<{ total: number }> | null) =>
      (rows || []).reduce((s, o) => s + (o.total || 0), 0)
    /* ⚠ DOANH THU THUẦN = hàng đi − hàng trả (chủ nhà 25/09/2026: "Doanh thu lệch công
       nợ … Rà soát lại toàn bộ doanh số tính bằng số đi - số trả", mig 192). Hàng trả
       theo `returns.revenue_date` — cùng luật với công nợ. */
    const invoiceRows = ((invoicesRes.data as unknown) as typeof allInvoices) || []
    /* ⚠ ĐỌC HỎNG THÌ NÓI RA — im lặng về 0 là hiện doanh thu gộp như thể đã trừ. */
    let loiTra: string | null = null
    const baoLoi = <T,>(macDinh: T) => (e: unknown) => { loiTra = errorMessage(e); return macDinh }
    const [traThang, traThangTruoc, traTungHD] = await Promise.all([
      traCuaKhach(supabase, id, ngayDauThang, null).catch(baoLoi(0)),
      traCuaKhach(supabase, id, ngayDauThangTruoc, ngayDauThang).catch(baoLoi(0)),
      traTheoHoaDon(supabase, invoiceRows.filter((v) => v.status === "posted").map((v) => v.id)).catch(
        baoLoi(new Map<string, number>())
      ),
    ])
    if (loiTra) setStatsError((cu) => cu ?? `Hàng trả (chưa trừ vào doanh thu): ${loiTra}`)
    setMonthRevenue(sumTotal(monthOrdersRes.data as Array<{ total: number }>) - traThang)
    setLastMonthRevenue(sumTotal(prevMonthOrdersRes.data as Array<{ total: number }>) - traThangTruoc)
    setTraHD(traTungHD)

    setAllInvoices(invoiceRows)
    setAllPayments(((paymentsRes.data as unknown) as typeof allPayments) || [])

    const orders = allOrdersRes.rows
    setAllOrders(orders)
    setTotalOrders(orders.length)
    setRecentOrders(orders.slice(0, 5))

    setReceivables(receivablesRes.rows)

    const photos = (photosRes.data as Array<{ gps_accuracy: number | null }>) || []
    setPhotoCount(photos.length)
    setGpsAccuracy(
      photos.find((p) => p.gps_accuracy != null)?.gps_accuracy ?? null
    )

    setVisitSchedule(
      Array.from(
        new Set(
          ((pjpRes.data as Array<{ day_of_week: number }>) || []).map((r) => r.day_of_week)
        )
      ).sort((a, b) => a - b)
    )

    // Frequency
    setOrderFrequency(Math.round(((last90Res.count || 0) / 3) * 10) / 10)

    /**
     * Dòng hàng của những đơn gần nhất — nuôi cả "N mặt hàng" trên từng
     * dòng đơn lẫn khối "Sản phẩm hay lấy".
     *
     * ⚠ CHỈ QUÉT `LINE_SCAN_ORDERS` ĐƠN GẦN NHẤT. Khách mười năm có cả
     * nghìn đơn; kéo hết dòng hàng về là PostgREST cắt ở 1.000 dòng
     * TRONG IM LẶNG và bảng "hay lấy" ra một thứ tự sai mà nhìn vẫn hợp
     * lý. Giới hạn theo ĐƠN thì phạm vi luôn nói được thành lời.
     */
    const scanIds = orders.slice(0, LINE_SCAN_ORDERS).map((o) => o.id)
    if (scanIds.length > 0) {
      const linesRes = await supabase
        .from("sales_order_lines")
        .select("order_id, product_id, product:products(name)")
        .in("order_id", scanIds)
      if (linesRes.error) console.error("[customers/id] truy vấn dòng hàng lỗi:", linesRes.error.message)
      const rows =
        ((linesRes.data as unknown) as Array<{
          order_id: string
          product_id: string
          product?: { name?: string } | null
        }>) || []
      const counts: Record<string, number> = {}
      const names: Record<string, string[]> = {}
      for (const r of rows) {
        counts[r.order_id] = (counts[r.order_id] || 0) + 1
        const n = r.product?.name
        if (n) (names[r.order_id] = names[r.order_id] || []).push(n)
      }
      setOrderLineCount(counts)
      const summary: Record<string, string> = {}
      for (const oid of Object.keys(names)) {
        const list = names[oid]
        summary[oid] =
          list.slice(0, 2).join(", ") + (list.length > 2 ? ` +${list.length - 2}` : "")
      }
      setOrderSummary(summary)
      setFrequent(
        frequentProducts(
          rows.map((r) => ({
            order_id: r.order_id,
            product_id: r.product_id,
            product_name: r.product?.name ?? null,
          })),
          5
        )
      )
    } else {
      setOrderLineCount({})
      setOrderSummary({})
      setFrequent([])
    }

    // Tên tuyến bán — cột `channel` lưu MÃ tuyến (mig 073).
    const routeCode = (custRes.data as { channel?: string | null } | null)?.channel
    if (routeCode) {
      const { data: rt, error: rtErr } = await supabase
        .from("sales_routes")
        .select("name")
        .eq("code", routeCode)
        .maybeSingle()
      if (rtErr) console.error("[customers/id] truy vấn tuyến lỗi:", rtErr.message)
      // ⚠ Không tra ra thì in NGUYÊN MÃ, đừng in "—". Mã lạ là manh mối.
      setRouteLabel((rt as { name?: string } | null)?.name || routeCode)
    } else {
      setRouteLabel(null)
    }

    // Price list
    const groupId = custRes.data?.group_id
    let priceQuery = supabase
      .from("price_lists")
      .select("id, product_id, group_id, unit_name, price, effective_from, effective_to, product:products(name, sku, base_unit), group:customer_groups(name)")
      .order("product_id")
    if (groupId) {
      priceQuery = priceQuery.or(`group_id.eq.${groupId},group_id.is.null`)
    } else {
      priceQuery = priceQuery.is("group_id", null)
    }
    const priceRes = await priceQuery
    if (priceRes.error) console.error("[customers/id] truy vấn bảng giá lỗi:", priceRes.error.message)
    setPriceRows((priceRes.data || []) as unknown as PriceRow[])

    // Visit history
    const { data: visitData, error: visitDataErr } = await supabase
      .from("visit_logs")
      .select(
        "id, visit_date, check_in_at, check_out_at, check_in_lat, check_in_lng, result, notes, photo_url, sales_user:users!visit_logs_sales_user_id_fkey(full_name)"
      )
      .eq("customer_id", id)
      .order("visit_date", { ascending: false })
      .order("check_in_at", { ascending: false })
    if (visitDataErr) console.error("[customers/id] truy vấn lỗi:", visitDataErr.message)
    setVisits(((visitData as unknown) as VisitRow[]) || [])

    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const currentDebt = useMemo(
    () =>
      /* Dòng âm (hàng trả > hàng xuất, mig 186) trừ vào nợ — không kẹp về 0. */
      receivables.reduce((s, r) => s + (Number(r.amount || 0) - Number(r.paid || 0)), 0),
    [receivables]
  )
  const buckets = useMemo(() => debtBuckets(receivables), [receivables])
  const overdueAmount = buckets[1].amount + buckets[2].amount

  const todayVisit = useMemo(() => {
    const t = todayVN()
    return visits.find((v) => v.visit_date.slice(0, 10) === t) || null
  }, [visits])

  /** Bốn ô thống kê ghé thăm — mọi con số đều đọc từ `visit_logs`. */
  const visitStats = useMemo(() => {
    const in30 = visits.filter((v) => daysSinceVN(v.visit_date) <= 30)
    const withOrder = in30.filter((v) => v.result === "order_placed").length
    const durations = visits
      .filter((v) => v.check_in_at && v.check_out_at)
      .map((v) => (new Date(v.check_out_at as string).getTime() - new Date(v.check_in_at as string).getTime()) / 60000)
      .filter((m) => m > 0)
    const avg = durations.length
      ? Math.round(durations.reduce((s, m) => s + m, 0) / durations.length)
      : null
    return [
      { label: "Ghé 30 ngày", value: `${in30.length} lần` },
      {
        label: "Tỉ lệ có đơn",
        // ⚠ Chưa ghé lần nào thì KHÔNG in "0%" — chia cho 0 và câu trả
        //   lời "0% có đơn" là lời buộc tội sai cho nhân viên.
        value: in30.length ? `${Math.round((withOrder / in30.length) * 100)}%` : "—",
      },
      { label: "Thời gian TB", value: avg === null ? "—" : `${avg} phút` },
      { label: "Ghé gần nhất", value: visits[0] ? formatDate(visits[0].visit_date) : "—" },
    ]
  }, [visits])

  /** Dòng thời gian bên phải — ghép từ ghé thăm, đơn hàng và tiền đã thu. */
  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [
      ...visits.slice(0, 8).map((v) => ({
        id: `v-${v.id}`,
        kind: "visit" as const,
        label: `Ghé thăm${v.result ? ` · ${VISIT_RESULT[v.result]?.label || v.result}` : ""}`,
        at: v.check_in_at || `${v.visit_date}T00:00:00`,
        who: v.sales_user?.full_name || null,
      })),
      ...allOrders.slice(0, 8).map((o) => ({
        id: `o-${o.id}`,
        kind: "order" as const,
        label: `Đơn ${o.order_code} · ${formatCurrency(o.total)}`,
        at: `${o.order_date.slice(0, 10)}T00:00:00`,
        who: null,
      })),
      ...allPayments.slice(0, 8).map((p) => ({
        id: `p-${p.id}`,
        kind: "payment" as const,
        label: `Thu tiền ${formatCurrency(p.amount)} · ${PAYMENT_METHOD_LABEL[p.method] || p.method}`,
        at: p.collected_at,
        who: null,
      })),
    ]
    return mergeActivity(items, 6)
  }, [visits, allOrders, allPayments])

  const todos = useMemo(
    () =>
      customer
        ? customerTodos({
            photoCount,
            maxPhotos: MAX_PHOTOS,
            taxCode: customer.tax_code,
            hasGps: customer.gps_lat != null && customer.gps_lng != null,
            overdueAmount,
            assigneeCount: managers.length,
          })
        : [],
    [customer, photoCount, overdueAmount, managers.length]
  )

  const handleDelete = async () => {
    if (!customer) return
    setDeleting(true)
    try {
      await ghiPhaiTrungDong(supabase.from("customers").delete().eq("id", customer.id))
      toast({ title: "Đã xóa khách hàng" })
      router.push("/customers")
    } catch (err) {
      toast({
        title: "Lỗi",
        description: errorMessage(err),
        variant: "destructive",
      })
      setDeleting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!customer) return <div>Không tìm thấy khách hàng</div>

  const canDelete = user && hasPermission(user.role, "customers", "delete")
  const canUpdate = !!user && hasPermission(user.role, "customers", "update")
  const canCollect = !!user && hasPermission(user.role, "receivables", "create")
  const canOrder = !!user && hasPermission(user.role, "orders", "create")
  const limit = Number(customer.credit_limit || 0)
  const usedPct = limit > 0 ? Math.min(100, Math.max(0, Math.round((currentDebt / limit) * 100))) : 0
  const mapsUrl =
    customer.gps_lat != null && customer.gps_lng != null
      ? `https://www.google.com/maps?q=${customer.gps_lat},${customer.gps_lng}`
      : null
  const lastOrderDate = allOrders[0]?.order_date ?? null

  const goEdit = () => {
    setActiveTab("info")
    if (typeof window !== "undefined") {
      requestAnimationFrame(() =>
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
      )
    }
  }

  return (
    /* ⚠ `pb-nav-action` LÀ BẮT BUỘC khi có `StickyActionBar` — thiếu nó
       thì thanh dính đáy che mất phần cuối trang, đúng chỗ có Vùng nguy
       hiểm và nút xoá. */
    <div className="space-y-4 pb-nav-action lg:pb-0">
      {/* Lỗi tải / số thiếu — nói ra, không để số đơn / công nợ trông như đúng. */}
      {statsError && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải đủ đơn hàng / công nợ của khách</p>
          <p className="mt-0.5 break-words">{statsError}</p>
        </div>
      )}
      {statsTruncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Số liệu chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}
      {/* ===== Thẻ danh tính ===== */}
      <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-card">
        <div className="flex items-start gap-3">
          <Link
            href="/customers"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-container lg:hidden"
            aria-label="Quay lại danh sách khách"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
          </Link>
          <span
            aria-hidden
            className="hidden h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary-fixed text-xl font-black text-on-primary-fixed-variant lg:grid"
          >
            {customerInitial(customer.store_name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-on-surface lg:text-2xl">
                {customer.store_name}
              </h1>
              <StatusBadge status={customer.status} type="customer" />
              {overdueAmount > 0 && <Badge variant="danger">Nợ quá hạn</Badge>}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-on-surface-variant">
              <span className="text-on-surface">{fullCustomerAddress(customer) || "—"}</span>
              {customer.phone && (
                <>
                  <span className="text-outline-variant">·</span>
                  <a href={`tel:${customer.phone}`} className="font-bold text-primary hover:underline">
                    {customer.phone}
                  </a>
                </>
              )}
              {customer.owner_name && (
                <>
                  <span className="text-outline-variant">·</span>
                  <span>Chủ quán: {customer.owner_name}</span>
                </>
              )}
              {routeLabel && (
                <>
                  <span className="text-outline-variant">·</span>
                  <span>{routeLabel}</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Hành động — Gọi và Chỉ đường là hai việc làm ngay khi đứng
            trước cửa hàng, nên đứng trước trên điện thoại. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {customer.phone ? (
            <Button variant="outline" size="sm" className="lg:hidden" asChild>
              <a href={`tel:${customer.phone}`}>
                <Phone className="mr-1.5 h-4 w-4" />
                Gọi {customer.owner_name || "chủ quán"}
              </a>
            </Button>
          ) : (
            <span className="inline-flex h-9 items-center rounded-lg border border-dashed border-outline-variant px-3 text-[13px] text-on-surface-variant lg:hidden">
              Chưa có SĐT
            </span>
          )}
          {mapsUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                <MapPin className="mr-1.5 h-4 w-4" /> Chỉ đường
              </a>
            </Button>
          )}
          {canUpdate && (
            <>
              <Button variant="outline" size="sm" onClick={() => setVisitDialogOpen(true)}>
                <Navigation className="mr-1.5 h-4 w-4" /> Ghé thăm
              </Button>
              <Button variant="outline" size="sm" onClick={goEdit}>
                <Pencil className="mr-1.5 h-4 w-4" /> Sửa thông tin
              </Button>
            </>
          )}
          {canOrder && (
            <Button size="sm" className="hidden lg:inline-flex" onClick={() => router.push(newOrderHref(customer.id))}>
              <FilePlus2 className="mr-1.5 h-4 w-4" /> Tạo đơn
            </Button>
          )}
          {currentDebt > 0 && canCollect && (
            <Button
              size="sm"
              variant="outline"
              className="hidden text-error border-error/40 hover:bg-error-container lg:inline-flex"
              onClick={() => router.push(`/receivables/collect?customerId=${customer.id}`)}
            >
              <Banknote className="mr-1.5 h-4 w-4" /> Thu tiền
            </Button>
          )}
        </div>
      </div>

      {/* ===== Bốn ô KPI ===== */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Doanh thu tháng này"
          value={formatCurrency(monthRevenue)}
          sub={revenueCompareText(monthRevenue, lastMonthRevenue)}
        />
        <KpiCard
          label="Công nợ hiện tại"
          value={formatCurrency(currentDebt)}
          tone={overdueAmount > 0 ? "danger" : "default"}
          sub={
            limit > 0
              ? `Hạn mức ${formatCurrency(limit)} · dùng ${usedPct}%`
              : "Chưa đặt hạn mức công nợ"
          }
          bar={limit > 0 ? usedPct : null}
        />
        <KpiCard
          label="Tổng đơn hàng"
          value={String(totalOrders)}
          unit="đơn"
          sub={
            totalOrders > 0
              ? `TB ${formatCurrency(allOrders.reduce((s, o) => s + (o.total || 0), 0) / totalOrders)}/đơn`
              : "Chưa có đơn nào"
          }
        />
        <KpiCard
          label="Tần suất mua"
          value={String(orderFrequency)}
          unit="đơn/tháng"
          sub={
            lastOrderDate
              ? `Mua gần nhất ${formatDate(lastOrderDate)}`
              : "Chưa từng đặt đơn"
          }
        />
      </div>

      {/* ===== Nội dung chính + cột phải ===== */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="overview">Tổng quan</TabsTrigger>
              <TabsTrigger value="orders">Lịch sử giao dịch</TabsTrigger>
              <TabsTrigger value="visits">Ghé thăm ({visits.length})</TabsTrigger>
              <TabsTrigger value="assignments">Phân công ({assignments.length})</TabsTrigger>
              <TabsTrigger value="prices">Bảng giá áp dụng</TabsTrigger>
              <TabsTrigger value="info">Sửa thông tin</TabsTrigger>
            </TabsList>

            {/* ===== Tab: Tổng quan ===== */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              {/* ⚠ HỒ SƠ ĐIỂM BÁN ĐỨNG ĐẦU TAB TỔNG QUAN.
                  Trước đây nó nằm trong tab "Sửa thông tin", nên mở một
                  điểm bán ra là KHÔNG thấy số điện thoại, địa chỉ, hạn mức
                  hay ai phụ trách — muốn xem thì phải bấm sang một tab tên
                  là "Sửa", tức là phải vào màn SỬA để ĐỌC. */}
              <CustomerProfileCard
                customer={customer}
                creatorName={creatorName}
                managerNames={managers.map((m) => m.fullName)}
                actions={
                  canUpdate ? (
                    <Button variant="ghost" size="sm" onClick={goEdit}>
                      Sửa thông tin
                    </Button>
                  ) : null
                }
              />

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Ảnh điểm bán</CardTitle>
                    <Badge variant={photoCount >= MAX_PHOTOS ? "success" : "warning"}>
                      {photoCount}/{MAX_PHOTOS} ảnh
                    </Badge>
                  </div>
                  {/* ⚠ CHỈ NÓI SAI SỐ KHI CÓ SỐ. Máy từ chối quyền định vị
                      thì `gps_accuracy` là NULL — in "±0 m" là bịa ra một
                      phép đo chính xác tuyệt đối chưa từng xảy ra. */}
                  <span className="text-xs font-semibold text-on-surface-variant">
                    {gpsAccuracy != null
                      ? `Sai số GPS ±${Math.round(gpsAccuracy)} m`
                      : "Chưa có sai số GPS"}
                  </span>
                </CardHeader>
                <CardContent>
                  <CustomerPhotoCapture
                    customerId={customer.id}
                    customerName={customer.store_name}
                    storeGps={{
                      lat: customer.gps_lat != null ? Number(customer.gps_lat) : null,
                      lng: customer.gps_lng != null ? Number(customer.gps_lng) : null,
                    }}
                    onChanged={fetchData}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Sản phẩm hay lấy</CardTitle>
                  <span className="text-xs font-semibold text-on-surface-variant">
                    {/* ⚠ NÓI RÕ PHẠM VI. "Hay lấy" tính trên bấy nhiêu đơn
                        gần nhất, không phải trên toàn bộ lịch sử. */}
                    {allOrders.length > LINE_SCAN_ORDERS
                      ? `Theo ${LINE_SCAN_ORDERS} đơn gần nhất`
                      : `Theo ${allOrders.length} đơn`}
                  </span>
                </CardHeader>
                <CardContent>
                  {frequent.length === 0 ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">
                      Chưa đủ đơn hàng để biết khách hay lấy gì
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {frequent.map((f) => (
                        <div key={f.productId} className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                            {f.name}
                          </span>
                          <span className="hidden h-2 w-32 shrink-0 overflow-hidden rounded-full bg-surface-container sm:block">
                            <span
                              className="block h-2 rounded-full bg-primary"
                              style={{ width: `${f.pct}%` }}
                            />
                          </span>
                          <span className="w-16 shrink-0 text-right text-xs font-bold text-on-surface-variant tabular-data">
                            {f.orders} đơn
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Đơn hàng gần đây</CardTitle>
                  {allOrders.length > 5 && (
                    <button
                      onClick={() => setActiveTab("orders")}
                      className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                    >
                      Xem tất cả <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </CardHeader>
                <CardContent>
                  <OrderList
                    orders={recentOrders}
                    lineCount={orderLineCount}
                    summary={orderSummary}
                    empty="Chưa có đơn hàng nào"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Tab: Giao dịch ===== */}
            <TabsContent value="orders" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Công nợ &amp; thanh toán</CardTitle>
                  {currentDebt > 0 && canCollect && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/receivables/collect?customerId=${customer.id}`}>
                        Ghi nhận thanh toán
                      </Link>
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {buckets.map((b) => (
                      <div
                        key={b.key}
                        className={`rounded-xl p-3 ${
                          b.key === "current"
                            ? "bg-surface-container-low"
                            : b.amount > 0
                              ? "bg-error-container"
                              : "bg-surface-container-low"
                        }`}
                      >
                        <p className="text-xs font-bold text-on-surface-variant">{b.label}</p>
                        <p
                          className={`mt-1 text-lg font-black tabular-data ${
                            b.key !== "current" && b.amount > 0
                              ? "text-on-error-container"
                              : "text-on-surface"
                          }`}
                        >
                          {formatCurrency(b.amount)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Các khoản thanh toán ({allPayments.length})
                    </p>
                    {allPayments.length === 0 ? (
                      <p className="py-3 text-center text-sm text-muted-foreground">
                        Khách hàng này chưa thanh toán khoản nào
                      </p>
                    ) : (
                      <div className="divide-y divide-outline-variant/40">
                        {allPayments.map((pm) => (
                          <div key={pm.id} className="flex items-center gap-3 py-2.5">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-bold">
                                {PAYMENT_METHOD_LABEL[pm.method] || pm.method}
                              </span>
                              <span className="mt-0.5 block text-xs text-on-surface-variant">
                                {formatDate(pm.collected_at)}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-black text-tertiary tabular-data">
                              +{formatCurrency(pm.amount)}
                            </span>
                          </div>
                        ))}
                        {allPayments.length >= 200 && (
                          <p className="pt-2 text-center text-xs text-muted-foreground">
                            Mới hiện 200 khoản thu gần nhất.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Hóa đơn bán ({allInvoices.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {allInvoices.length === 0 ? (
                    <EmptyState
                      title="Chưa có hóa đơn"
                      description="Khách hàng này chưa được xuất hóa đơn nào"
                    />
                  ) : (
                    <div className="space-y-2">
                      {allInvoices.map((v) => {
                        const st = INVOICE_STATUS_MAP[v.status]
                        return (
                          <Link
                            key={v.id}
                            href={`/sales-invoices/${v.id}`}
                            className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3 hover:bg-muted/40"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-xs font-bold text-primary">
                                {v.invoice_code}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {formatDate(v.invoice_date)}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              {/* ⚠ SỐ CÒN LẠI sau hàng trả — khớp công nợ (mig 192). */}
                              <span className="block text-sm font-bold">
                                {formatCurrency(v.total - (traHD.get(v.id) ?? 0))}
                              </span>
                              {(traHD.get(v.id) ?? 0) > 0 && (
                                <span className="block text-[11px] text-muted-foreground">
                                  HĐ {formatCurrency(v.total)} · trả {formatCurrency(traHD.get(v.id) ?? 0)}
                                </span>
                              )}
                              {st && (
                                <Badge variant={st.variant} className="mt-1">
                                  {st.label}
                                </Badge>
                              )}
                            </span>
                          </Link>
                        )
                      })}
                      {/* ⚠ CẮT BỚT THÌ NÓI. Im lặng dừng ở 200 đọc như "chỉ
                          có bấy nhiêu hóa đơn thôi". */}
                      {allInvoices.length >= 200 && (
                        <p className="text-center text-xs text-muted-foreground">
                          Mới hiện 200 hóa đơn gần nhất.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tất cả đơn hàng ({allOrders.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <OrderList
                    orders={allOrders}
                    lineCount={orderLineCount}
                    summary={orderSummary}
                    empty="Khách hàng này chưa có đơn hàng nào"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Tab: Ghé thăm ===== */}
            <TabsContent value="visits" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">Ghé thăm hôm nay</CardTitle>
                    {todayVisit ? (
                      <Badge variant="success">
                        Đã ghé hôm nay
                        {todayVisit.check_in_at
                          ? ` · ${new Date(todayVisit.check_in_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
                          : ""}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Chưa ghé hôm nay</Badge>
                    )}
                  </div>
                  {canUpdate && (
                    <Button size="sm" onClick={() => setVisitDialogOpen(true)}>
                      <Navigation className="mr-1.5 h-3.5 w-3.5" /> Ghi nhận ghé thăm
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {visitStats.map((s) => (
                      <div key={s.label} className="rounded-xl bg-surface-container-low p-3">
                        <p className="text-xs font-bold text-on-surface-variant">{s.label}</p>
                        <p className="mt-1 text-lg font-black tabular-data">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  {visitSchedule.length > 0 && (
                    <p className="text-xs font-semibold text-on-surface-variant">
                      Lịch ghé cố định: {visitSchedule.map((d) => DOW_LABEL[d]).join(", ")} hàng tuần
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Lịch sử ghé thăm ({visits.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {visits.length === 0 ? (
                    <EmptyState title="Chưa có ghé thăm" description="Ghi nhận ghé thăm đầu tiên từ nút phía trên" />
                  ) : (
                    <div className="space-y-3">
                      {visits.map((v) => {
                        const r = v.result ? VISIT_RESULT[v.result] : null
                        const visitMap = v.check_in_lat && v.check_in_lng
                          ? `https://www.google.com/maps?q=${v.check_in_lat},${v.check_in_lng}`
                          : null
                        return (
                          <div key={v.id} className="rounded-xl border bg-muted/10 p-3">
                            <div className="flex justify-between items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold">{formatDate(v.visit_date)}</span>
                                  {v.check_in_at && (
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(v.check_in_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  )}
                                  {r && <Badge variant={r.variant}>{r.label}</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1 truncate">
                                  NV: {v.sales_user?.full_name || "-"}
                                </p>
                                {visitMap && (
                                  <a
                                    href={visitMap}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                                  >
                                    <MapPin className="h-3 w-3" />
                                    {v.check_in_lat?.toFixed(5)}, {v.check_in_lng?.toFixed(5)}
                                  </a>
                                )}
                                {v.notes && (
                                  <p className="text-xs mt-2 text-muted-foreground italic line-clamp-2">
                                    &ldquo;{v.notes}&rdquo;
                                  </p>
                                )}
                              </div>
                              {v.photo_url ? (
                                <a
                                  href={v.photo_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 rounded-lg overflow-hidden border w-20 h-20 bg-muted"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={v.photo_url}
                                    alt="Ảnh cửa hàng"
                                    className="w-full h-full object-cover"
                                  />
                                </a>
                              ) : (
                                <div className="shrink-0 w-20 h-20 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
                                  <Camera className="h-5 w-5" />
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Tab: Phân công ===== */}
            <TabsContent value="assignments" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Phụ trách điểm bán</CardTitle>
                </CardHeader>
                <CardContent>
                  <CustomerManagers managers={managers} />
                </CardContent>
              </Card>
              <AssignmentManager customerId={customer.id} assignments={assignments} onUpdate={fetchData} />
            </TabsContent>

            {/* ===== Tab: Bảng giá áp dụng ===== */}
            <TabsContent value="prices" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bảng giá áp dụng</CardTitle>
                </CardHeader>
                <CardContent>
                  {priceRows.length === 0 ? (
                    <EmptyState title="Chưa có bảng giá" description="Chưa có giá nào được thiết lập cho nhóm khách hàng này" />
                  ) : (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Sản phẩm</TableHead>
                              <TableHead>SKU</TableHead>
                              <TableHead>ĐVT</TableHead>
                              <TableHead className="text-right">Giá (nhóm KH)</TableHead>
                              <TableHead className="text-right">Giá mặc định</TableHead>
                              <TableHead>Hiệu lực</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {priceRows.map((p) => {
                              const isGroupPrice = !!p.group_id
                              const effectiveRange = p.effective_from || p.effective_to
                                ? `${p.effective_from ? formatDate(p.effective_from) : "..."} - ${p.effective_to ? formatDate(p.effective_to) : "..."}`
                                : "Không giới hạn"
                              return (
                                <TableRow key={p.id}>
                                  <TableCell className="font-medium">{p.product?.name || "—"}</TableCell>
                                  <TableCell className="text-muted-foreground">{p.product?.sku || "—"}</TableCell>
                                  <TableCell>{p.unit_name || p.product?.base_unit || "—"}</TableCell>
                                  <TableCell className="text-right font-semibold">
                                    {isGroupPrice ? formatCurrency(p.price) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {!isGroupPrice ? formatCurrency(p.price) : "—"}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-xs">{effectiveRange}</TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Mobile card list */}
                      <div className="md:hidden space-y-2">
                        {priceRows.map((p) => {
                          const isGroupPrice = !!p.group_id
                          const effectiveRange = p.effective_from || p.effective_to
                            ? `${p.effective_from ? formatDate(p.effective_from) : "..."} - ${p.effective_to ? formatDate(p.effective_to) : "..."}`
                            : "Không giới hạn"
                          return (
                            <div key={p.id} className="rounded-xl border bg-muted/20 p-3">
                              <div className="flex justify-between items-start gap-2 mb-1">
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-sm leading-tight">{p.product?.name || "—"}</p>
                                  <p className="font-mono text-xs text-muted-foreground mt-0.5">
                                    SKU: {p.product?.sku || "—"} • ĐVT: {p.unit_name || p.product?.base_unit || "—"}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="font-bold text-sm">{formatCurrency(p.price)}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {isGroupPrice ? "Giá nhóm" : "Giá mặc định"}
                                  </p>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">Hiệu lực: {effectiveRange}</p>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Thông tin — chỉ còn biểu mẫu SỬA. Bản ĐỌC đã lên đầu
                tab Tổng quan, để hai nơi không kể cùng một chuyện. */}
            <TabsContent value="info" className="space-y-4 mt-4">
              <CustomerForm customer={customer} groups={groups} />
            </TabsContent>
          </Tabs>
        </div>

        {/* ===== Cột phải ===== */}
        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Hoạt động gần đây</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Chưa có hoạt động nào</p>
              ) : (
                <div className="space-y-3">
                  {activity.map((a) => (
                    <div key={a.id} className="flex gap-2.5">
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          a.kind === "payment"
                            ? "bg-tertiary"
                            : a.kind === "order"
                              ? "bg-primary"
                              : "bg-warning"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold leading-snug">
                          {a.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-on-surface-variant">
                          {formatDate(a.at)}
                          {a.who ? ` · ${a.who}` : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* ⚠ NÓI RÕ ĐÂY KHÔNG PHẢI NHẬT KÝ ĐẦY ĐỦ. Hệ thống không có
                  bảng ghi nhật ký; khối này ghép từ ba nguồn có thật, nên
                  không được để người đọc tin là nó kể hết mọi thay đổi. */}
              <p className="mt-3 border-t border-outline-variant/40 pt-2 text-[11px] text-on-surface-variant">
                Chỉ gồm ghé thăm, đơn hàng và tiền đã thu.
              </p>
            </CardContent>
          </Card>

          {todos.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <CardTitle className="text-sm">Cần hoàn thiện</CardTitle>
                <Badge variant="warning">{todos.length} việc</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {todos.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() =>
                      setActiveTab(
                        t.key === "overdue"
                          ? "orders"
                          : t.key === "no_assignee"
                            ? "assignments"
                            : t.key === "tax_code"
                              ? "info"
                              : "overview"
                      )
                    }
                    className="flex w-full items-start gap-2 rounded-xl bg-surface-container-low p-2.5 text-left"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        t.tone === "danger" ? "bg-error" : "bg-warning"
                      }`}
                    />
                    <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">
                      {t.label}
                    </span>
                    <span className="shrink-0 text-xs font-bold text-primary">{t.action}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {canDelete && (
            <Card className="border-error/30">
              <CardHeader>
                <CardTitle className="text-sm text-error">Vùng nguy hiểm</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Xóa khách hàng vĩnh viễn. Thao tác này cũng sẽ xóa các phân công nhân viên và có thể thất bại nếu khách hàng có đơn hàng.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa khách hàng
                </Button>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      {/* ===== Thanh hành động dính đáy — chỉ trên điện thoại =====
          ⚠ DÙNG `StickyActionBar`, ĐỪNG TỰ ĐẶT `bottom-16`. Chiều cao
          thanh nav nằm trong biến `--bottom-nav-h` và còn cộng thêm phần
          an toàn dưới màn hình iPhone; ghim một con số là thanh này đè
          lên thanh nav trên đúng những máy đó. */}
      <StickyActionBar>
        {canCollect && (
          <Button
            variant="outline"
            className="h-12 flex-1 disabled:opacity-40"
            disabled={currentDebt <= 0}
            asChild={currentDebt > 0}
          >
            {currentDebt > 0 ? (
              <Link href={`/receivables/collect?customerId=${customer.id}`}>
                <Banknote className="mr-1.5 h-4 w-4" /> Ghi thu tiền
              </Link>
            ) : (
              <span>
                <Banknote className="mr-1.5 h-4 w-4" /> Không còn nợ
              </span>
            )}
          </Button>
        )}
        {canOrder && (
          <Button className="h-12 flex-1" asChild>
            <Link href={newOrderHref(customer.id)}>
              <FilePlus2 className="mr-1.5 h-4 w-4" /> Tạo đơn
            </Link>
          </Button>
        )}
      </StickyActionBar>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn khách hàng?"
        description={`Khách hàng "${customer.store_name}" sẽ bị xóa cùng các phân công nhân viên. Thao tác có thể thất bại nếu khách hàng có đơn hàng. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />

      <VisitCheckinDialog
        open={visitDialogOpen}
        onOpenChange={setVisitDialogOpen}
        customerId={customer.id}
        customerName={customer.store_name}
        onSuccess={fetchData}
      />
    </div>
  )
}

/** Một ô KPI: nhãn, số lớn, dòng so sánh, và thanh tỉ lệ tuỳ chọn. */
function KpiCard({
  label,
  value,
  unit,
  sub,
  tone = "default",
  bar = null,
}: {
  label: string
  value: string
  unit?: string
  sub: string
  tone?: "default" | "danger"
  bar?: number | null
}) {
  return (
    <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 shadow-card lg:p-4">
      <p className="truncate text-xs font-bold text-on-surface-variant">{label}</p>
      <p
        className={`mt-1 text-lg font-black tabular-data tabular-nums [overflow-wrap:anywhere] sm:text-xl lg:text-2xl ${
          tone === "danger" ? "text-error" : "text-on-surface"
        }`}
      >
        {value}
        {unit && <span className="ml-1 text-xs font-bold text-on-surface-variant">{unit}</span>}
      </p>
      {bar !== null && (
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-container">
          <span
            className={`block h-1.5 rounded-full ${tone === "danger" ? "bg-error" : "bg-primary"}`}
            style={{ width: `${bar}%` }}
          />
        </span>
      )}
      <p className="mt-1 truncate text-[11px] font-semibold text-on-surface-variant">{sub}</p>
    </div>
  )
}

/**
 * Danh sách đơn — một khuôn cho cả "gần đây" lẫn "tất cả".
 *
 * ⚠ SỐ MẶT HÀNG CHỈ HIỆN KHI ĐÃ ĐỌC ĐƯỢC. Đơn nằm ngoài phạm vi quét
 * dòng hàng thì KHÔNG in "0 mặt hàng" — một đơn không có mặt hàng nào là
 * chuyện khác hẳn với một đơn chưa đọc tới.
 */
function OrderList({
  orders,
  lineCount,
  summary,
  empty,
}: {
  orders: OrderRow[]
  lineCount: Record<string, number>
  summary: Record<string, string>
  empty: string
}) {
  if (orders.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <div className="divide-y divide-outline-variant/40">
      {orders.map((o) => {
        const st = ORDER_STATUS_MAP[o.status]
        const n = lineCount[o.id]
        return (
          <Link
            key={o.id}
            href={`/orders/${o.id}`}
            className="flex items-center gap-3 py-2.5 hover:bg-muted/30"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[13px] font-bold text-primary">
                {o.order_code}
              </span>
              <span className="mt-0.5 block truncate text-xs text-on-surface-variant">
                {formatDate(o.order_date)}
                {n !== undefined ? ` · ${n} mặt hàng` : ""}
                {summary[o.id] ? ` · ${summary[o.id]}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-bold tabular-data">{formatCurrency(o.total)}</span>
              {st && <Badge variant={st.variant} className="mt-1">{st.label}</Badge>}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
