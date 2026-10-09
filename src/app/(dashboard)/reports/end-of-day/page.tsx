"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useLuotNap } from "@/hooks/use-luot-nap"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame } from "@/components/analytics/report-frame"
import {
  FilterField,
  FilterMultiSelect,
  FilterSearchSelect,
  FilterSelect,
} from "@/components/analytics/report-shell"
import {
  useFilterCatalogs,
} from "@/lib/analytics/filter-catalogs"
import { formatCurrency, formatDate } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"
import { quaLocCuoiNgay, type ChungTuCuoiNgay } from "@/lib/analytics/loc-cuoi-ngay"
import {
  fetchAllOrdersDu,
  fetchRevenueInvoicesDu,
  fetchReturnsRowsDu,
  fetchReturnCosts,
  fetchCogsForRange,
  fetchStockEntryLines,
  giaTriDongKho,
  type SalesOrderRow,
  type RevenueInvoiceRow,
} from "@/lib/analytics/sales"
import { docDuHoacNem, docTheoLoId } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { ReportLoadNotice } from "../_components/report-load-notice"
import { type DateRange, rangeFromPreset } from "@/lib/analytics/period"

interface CashReceiptRow {
  id: string
  receipt_code: string
  submitted_amount: number
  expected_amount: number
  status: string
  received_at: string | null
  source_type: string
}

/**
 * Một phiếu trả TRỪ DOANH SỐ trong ngày, mang đủ cột để qua CÙNG bộ lọc với
 * hóa đơn (`quaLocCuoiNgay`):
 * · khách → `customer_id` của phiếu;
 * · nhân viên → NV của phiếu (mig 160), chưa gán thì NV của hóa đơn gắn phiếu;
 * · người tạo → `requested_by` (người lập phiếu);
 * · hình thức thanh toán → của hóa đơn gắn phiếu (phiếu độc lập không có).
 */
interface ReturnCuoiNgay extends ChungTuCuoiNgay {
  id: string
  amount: number
  /** Giá vốn hàng trả ĐÃ nhập lại kho — trừ vào giá vốn. */
  cost: number
}

interface ExpenseRow {
  amount: number
  description: string | null
  expense_date: string
}

export default function EndOfDayPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const catalogs = useFilterCatalogs(user?.org_id)
  const [date, setDate] = useState<string>(rangeFromPreset("today").from)
  const [loading, setLoading] = useState(true)
  // Đơn tạo trong ngày — số liệu HOẠT ĐỘNG, không phải doanh thu.
  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  // Hóa đơn ghi sổ trong ngày — DOANH THU tính theo hóa đơn (chủ nhà 24/09/2026).
  const [delivered, setDelivered] = useState<RevenueInvoiceRow[]>([])
  const [returnRows, setReturnRows] = useState<ReturnCuoiNgay[]>([])
  const [cogs, setCogs] = useState(0)
  /** Giá vốn theo phiếu xuất của CHÍNH từng hoá đơn trong ngày — dùng khi đang lọc. */
  const [giaVonHd, setGiaVonHd] = useState<Map<string, number>>(() => new Map())
  const [cashReceipts, setCashReceipts] = useState<CashReceiptRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  // Filters
  const [customerFilter, setCustomerFilter] = useState<string[]>([])
  const [salesUserFilter, setSalesUserFilter] = useState<string[]>([])
  const [creatorFilter, setCreatorFilter] = useState("")
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>("")

  const range: DateRange = useMemo(() => ({ from: date, to: date }), [date])

  const batLuot = useLuotNap()
  const load = useCallback(async () => {
    if (!user?.org_id) return
    const conMoi = batLuot()
    /* ⚠ HỎNG THÌ NÓI, KHÔNG HIỆN 0. Các hàm đọc đơn / trả / giá vốn nay
       NÉM khi truy vấn hỏng; không bắt thì trang treo. Phiếu thu và chi
       phí cũng thôi `console.error` rồi đọc `data || []` — "tiền thu 0đ"
       trên báo cáo cuối ngày là thứ người ta đem đi đối chiếu két. */
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      const [allRes, delivRes, retRes, cogsRes, cashRes, expRes] = await Promise.all([
        fetchAllOrdersDu(supabase, orgId, range),
        fetchRevenueInvoicesDu(supabase, orgId, range),
        fetchReturnsRowsDu(supabase, orgId, range),
        fetchCogsForRange(supabase, orgId, range),
        docDuHoacNem<CashReceiptRow>(
          (from, to) =>
            supabase
              .from("cash_receipts")
              .select("id, receipt_code, submitted_amount, expected_amount, status, received_at, source_type", { count: "exact" })
              .eq("org_id", orgId)
              .eq("receipt_date", date)
              .order("id")
              .range(from, to),
          "đọc phiếu thu"
        ),
        docDuHoacNem<ExpenseRow>(
          (from, to) =>
            supabase
              .from("expenses")
              .select("amount, description, expense_date", { count: "exact" })
              .eq("org_id", orgId)
              .eq("expense_date", date)
              .order("id")
              .range(from, to),
          "đọc chi phí"
        ),
      ])
      /* ⚠ HÀNG TRẢ PHẢI QUA CÙNG BỘ LỌC (chủ nhà 25/09/2026: "Rà soát lại toàn bộ
         doanh số tính bằng số đi - số trả"). Bản cũ trừ TỔNG hàng trả cả ngày vào
         doanh thu ĐÃ LỌC — chọn một khách là trừ cả hàng trả của khách khác, doanh
         thu thuần âm oan. Đọc thêm người lập phiếu và NV / hình thức của hóa đơn
         gắn phiếu (hóa đơn có thể của ngày trước), cùng giá vốn hàng trả. */
      const retIds = retRes.rows.map((r) => r.id)
      const hdTrongNgay = new Map(delivRes.rows.map((i) => [i.id, i]))
      const hdThieu = retRes.rows
        .map((r) => r.invoice_id)
        .filter((id): id is string => !!id && !hdTrongNgay.has(id))
      const [nguoiLap, hdKhac, giaVonTra, phieuHd] = await Promise.all([
        docTheoLoId<{ id: string; requested_by: string | null }>(
          retIds,
          (lo, from, to) =>
            supabase
              .from("returns")
              .select("id, requested_by", { count: "exact" })
              .in("id", lo)
              .order("id")
              .range(from, to),
          "đọc người lập phiếu trả"
        ),
        docTheoLoId<{ id: string; sales_user_id: string | null; payment_terms: string | null }>(
          hdThieu,
          (lo, from, to) =>
            supabase
              .from("sales_invoices")
              .select("id, sales_user_id, payment_terms", { count: "exact" })
              .in("id", lo)
              .order("id")
              .range(from, to),
          "đọc hóa đơn gắn phiếu trả"
        ),
        fetchReturnCosts(supabase, retIds),
        // Phiếu xuất của từng hoá đơn trong ngày — giá vốn của đúng các hoá đơn đang lọc.
        docTheoLoId<{ id: string; stock_entry_id: string | null }>(
          delivRes.rows.map((i) => i.id),
          (lo, from, to) =>
            supabase
              .from("sales_invoices")
              .select("id, stock_entry_id", { count: "exact" })
              .in("id", lo)
              .order("id")
              .range(from, to),
          "đọc phiếu xuất của hoá đơn"
        ),
      ])
      const hdCuaPhieu = new Map<string, string>()
      for (const h of phieuHd) if (h.stock_entry_id) hdCuaPhieu.set(h.stock_entry_id, h.id)
      const gvHd = new Map<string, number>()
      for (const l of await fetchStockEntryLines(supabase, Array.from(hdCuaPhieu.keys()))) {
        const hd = hdCuaPhieu.get(l.entry_id)
        if (hd) gvHd.set(hd, (gvHd.get(hd) || 0) + giaTriDongKho(l))
      }
      const lapBoi = new Map(nguoiLap.map((r) => [r.id, r.requested_by]))
      const hdCua = new Map<string, { sales_user_id: string | null; payment_terms?: string | null }>(
        [...delivRes.rows, ...hdKhac].map((i) => [i.id, i])
      )
      const rows: ReturnCuoiNgay[] = retRes.rows.map((r) => {
        const hd = r.invoice_id ? hdCua.get(r.invoice_id) : undefined
        return {
          id: r.id,
          amount: Number(r.credit_note_amount || 0),
          cost: giaVonTra.get(r.id)?.total ?? 0,
          customer_id: r.customer_id,
          sales_user_id: r.sales_user_id ?? hd?.sales_user_id ?? "",
          created_by: lapBoi.get(r.id) ?? "",
          payment_terms: hd?.payment_terms ?? null,
        }
      })
      if (conMoi()) setTruncated(
        allRes.truncated || delivRes.truncated || retRes.truncated || cogsRes.truncated ||
          cashRes.truncated || expRes.truncated
      )
      if (conMoi()) setOrders(allRes.rows)
      if (conMoi()) setDelivered(delivRes.rows)
      if (conMoi()) setReturnRows(rows)
      if (conMoi()) setCogs(cogsRes.cogs)
      if (conMoi()) setGiaVonHd(gvHd)
      if (conMoi()) setCashReceipts(cashRes.rows)
      if (conMoi()) setExpenses(expRes.rows)
    } catch (err) {
      if (conMoi()) setLoadError(errorMessage(err))
    } finally {
      if (conMoi()) setLoading(false)
    }
  }, [user?.org_id, range, date, supabase, batLuot])

  useEffect(() => {
    load()
  }, [load])

  /* Một luật lọc cho cả đơn lẫn hóa đơn — xem `quaLocCuoiNgay`. */
  const passesFilters = useCallback(
    (o: SalesOrderRow | RevenueInvoiceRow | ReturnCuoiNgay) =>
      quaLocCuoiNgay(o, {
        khach: customerFilter,
        nhanVien: salesUserFilter,
        nguoiTao: creatorFilter,
        hinhThuc: paymentMethodFilter,
      }),
    [customerFilter, salesUserFilter, creatorFilter, paymentMethodFilter]
  )

  const filteredOrders = useMemo(() => orders.filter(passesFilters), [orders, passesFilters])
  const filteredDelivered = useMemo(
    () => delivered.filter(passesFilters),
    [delivered, passesFilters]
  )

  const filteredReturns = useMemo(
    () => returnRows.filter(passesFilters),
    [returnRows, passesFilters]
  )

  const revenue = filteredDelivered.reduce((s, o) => s + Number(o.total || 0), 0)
  // Hàng trả của ĐÚNG những khách / NV / người tạo đang lọc — không phải cả ngày.
  const returnsValue = filteredReturns.reduce((s, r) => s + r.amount, 0)
  const netRevenue = revenue - returnsValue
  /* Lãi gộp = thuần − (giá vốn − giá vốn hàng trả đã nhập lại kho).
     - Không lọc: giá vốn = phiếu xuất của CẢ ngày (khớp Tài chính), giá vốn trả của mọi phiếu trả trong ngày.
     - ⚠ ĐANG LỌC: giá vốn = phiếu xuất của CHÍNH các hoá đơn đã lọc, giá vốn trả của các phiếu trả đã lọc. Bản cũ lấy
       doanh thu ĐÃ LỌC trừ giá vốn CẢ NGÀY → chọn một khách là LN gộp âm vô lý (rà báo cáo 09/10/2026). */
  const dangLoc = customerFilter.length > 0 || salesUserFilter.length > 0 || !!creatorFilter || !!paymentMethodFilter
  const giaVonBan = dangLoc ? filteredDelivered.reduce((s, o) => s + (giaVonHd.get(o.id) || 0), 0) : cogs
  const returnsCost = (dangLoc ? filteredReturns : returnRows).reduce((s, r) => s + r.cost, 0)
  const grossProfit = netRevenue - (giaVonBan - returnsCost)
  const cashIn = cashReceipts
    .filter((r) => r.status === "received")
    .reduce((s, r) => s + Number(r.submitted_amount || 0), 0)
  const cashOut = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const ordersByStatus = filteredOrders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1
    return acc
  }, {})

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo cuối ngày"
      subtitle={`Ngày: ${formatDate(date)}`}
      range={range}
      preset="custom"
      onChangeRange={(_p, r) => setDate(r.from)}
      filters={
        <>
          <FilterField label="Khách hàng">
            <FilterMultiSelect
              value={customerFilter}
              onChange={setCustomerFilter}
              options={catalogs.customers}
              placeholder="Theo mã, tên, số điện thoại"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Nhân viên">
            <FilterMultiSelect
              value={salesUserFilter}
              onChange={setSalesUserFilter}
              options={catalogs.salesUsers}
              placeholder="Chọn nhân viên"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Người tạo">
            <FilterSearchSelect
              value={creatorFilter}
              onChange={setCreatorFilter}
              options={catalogs.allUsers}
              placeholder="Chọn người tạo"
              loading={catalogs.loading}
            />
          </FilterField>
          {/* Đơn / hóa đơn ghi HÌNH THỨC thanh toán (COD, công nợ N ngày) — không ghi
              tiền mặt / chuyển khoản; cái đó nằm ở phiếu thu. */}
          <FilterField label="Hình thức thanh toán">
            <FilterSelect
              value={paymentMethodFilter}
              onChange={(v) => setPaymentMethodFilter(v)}
              options={PAYMENT_TERMS.map((t) => ({ key: t.value, label: t.label }))}
              placeholder="Chọn hình thức thanh toán"
            />
          </FilterField>
        </>
      }
    >
      {!loadError && <ReportLoadNotice truncated={truncated} />}
      {loadError ? (
        <ReportLoadNotice error={loadError} />
      ) : loading ? (
        // Đang tải thì hiện khung chờ — bản cũ hiện 0đ (trông như ngày không bán được gì).
        <Skeleton className="h-72" />
      ) : (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <SmallStat label="Đơn tạo trong ngày" value={String(filteredOrders.length)} />
          <SmallStat label="Hóa đơn đã xuất" value={String(filteredDelivered.length)} />
          <SmallStat label="Doanh thu" value={formatCurrency(revenue)} />
          <SmallStat label="Trả hàng" value={formatCurrency(returnsValue)} />
          <SmallStat label="Doanh thu thuần" value={formatCurrency(netRevenue)} accent />
          <SmallStat label="LN gộp" value={formatCurrency(grossProfit)} accent />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold">Trạng thái đơn hàng</h3>
            <table className="w-full border border-border/40 text-sm">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                  <th className="px-3 py-2 text-right font-semibold">Số đơn</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ordersByStatus).map(([k, v]) => (
                  <tr key={k} className="border-t border-border/30">
                    <td className="px-3 py-2 capitalize">{k}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v}</td>
                  </tr>
                ))}
                {Object.keys(ordersByStatus).length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-muted-foreground">
                      Không có đơn nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">
              Tiền mặt
              {dangLoc && <span className="ml-2 text-xs font-normal text-muted-foreground">(toàn NPP — không theo bộ lọc)</span>}
            </h3>
            <table className="w-full border border-border/40 text-sm">
              <tbody>
                <tr className="border-b border-border/30">
                  <td className="px-3 py-2">Phiếu thu (đã nhận)</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-tertiary">
                    +{formatCurrency(cashIn)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-3 py-2">Chi phí trong ngày</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-error">
                    -{formatCurrency(cashOut)}
                  </td>
                </tr>
                <tr className="border-t-2 border-foreground/40">
                  <td className="px-3 py-2 font-bold">Chênh lệch quỹ</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">
                    {formatCurrency(cashIn - cashOut)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-semibold">Danh sách phiếu thu</h3>
          <table className="w-full border border-border/40 text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Mã phiếu</th>
                <th className="px-3 py-2 text-left font-semibold">Nguồn</th>
                <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                <th className="px-3 py-2 text-right font-semibold">Giá trị</th>
              </tr>
            </thead>
            <tbody>
              {cashReceipts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                    Chưa có phiếu thu trong ngày
                  </td>
                </tr>
              ) : (
                cashReceipts.map((r) => (
                  <tr key={r.id} className="border-t border-border/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.receipt_code}</td>
                    <td className="px-3 py-2">{r.source_type}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(Number(r.submitted_amount || 0))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </ReportFrame>
  )
}

function SmallStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-3 print:bg-transparent">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${accent ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  )
}
