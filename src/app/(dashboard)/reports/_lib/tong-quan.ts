import { vnDateKey } from "@/lib/orders/status-tone"
import type { ReturnSummaryRow } from "@/lib/analytics/sales"

/**
 * Phần TÍNH của trang Tổng quan báo cáo (`/reports`) — tách khỏi trang để thử được.
 *
 * ⚠ VÌ SAO CÓ TỆP NÀY (03/10/2026). Bản cũ đọc CẢ SỔ (mọi đơn, mọi hóa đơn đã ghi
 *   sổ, phiếu trả 2000–2999, mọi phiếu công nợ kể cả đã thu xong) rồi lọc kỳ ở trình
 *   duyệt — sổ lớn dần thì trang chậm dần, quá 20.000 dòng thì số THIẾU. Nay đọc theo
 *   KỲ (`mocDoc`) và phần tính giữ NGUYÊN luật cũ — thử ở
 *   `tests/bao-cao-tong-quan-doc-theo-ky.test.ts`: cùng một sổ, số tính trên phần đọc
 *   theo kỳ phải bằng số tính trên cả sổ.
 */

export type Period = "today" | "week" | "month" | "quarter" | "custom"

/** Hóa đơn đã ghi sổ — nguồn DOANH THU. `invoice_date` là DATE. */
export interface HoaDonTongQuan {
  id: string
  order_id: string
  invoice_date: string
  total: number
  sales_user_id: string | null
}

export interface DonTongQuan {
  id: string
  order_date: string
  status: string
}

export interface CongNoTongQuan {
  id: string
  status: string
  amount: number
  paid: number
  created_at: string
}

export interface CuaSoKy {
  start: Date
  end: Date
  prevStart: Date
  prevEnd: Date
}

/** Kỳ đang xem + kỳ liền trước cùng độ dài (để so %). Như bản cũ, từng dòng. */
export function cuaSoKy(period: Period, now: Date = new Date()): CuaSoKy {
  const end = new Date(now)
  const start = new Date(now)
  switch (period) {
    case "today":
      start.setHours(0, 0, 0, 0)
      break
    case "week":
      start.setDate(now.getDate() - 7)
      break
    case "month":
      start.setMonth(now.getMonth() - 1)
      break
    case "quarter":
      start.setMonth(now.getMonth() - 3)
      break
    default:
      // "Tùy chỉnh" = cả sổ (từ năm 2000) — đọc cả sổ là ĐÚNG Ý, dải chạm trần nói ra.
      start.setFullYear(2000)
  }
  const prevEnd = new Date(start)
  const span = end.getTime() - start.getTime()
  const prevStart = new Date(start.getTime() - span)
  return { start, end, prevStart, prevEnd }
}

/**
 * Mốc ĐỌC của từng bảng — mốc dưới của KỲ TRƯỚC (kỳ trước liền trước kỳ này nên
 * hai kỳ là một dải liền). Không có mốc trên: bản cũ không chặn trên (đơn / hóa
 * đơn đề ngày tới vẫn vào kỳ này), đọc theo kỳ cũng không được chặn.
 *
 * ⚠ ĐƠN so `new Date(order_date)` (nửa đêm UTC của cột DATE) với `prevStart` →
 *   mốc là ngày UTC của `prevStart`, không phải ngày VN (ngày VN có thể sớm hơn một
 *   ngày → sót đơn của ngày đầu kỳ trước).
 * ⚠ HÓA ĐƠN / PHIẾU TRẢ so ngày VN (`vnDateKey`) — cùng mốc với phần lọc.
 * ⚠ CÔNG NỢ lập trong hai kỳ (để so %) đọc theo `created_at`; phần "đang mở" đọc
 *   riêng (`status <> 'paid'`), KHÔNG theo kỳ.
 */
export function mocDoc(w: CuaSoKy): { donTu: string; ngayTu: string; congNoTuIso: string } {
  return {
    donTu: w.prevStart.toISOString().slice(0, 10),
    ngayTu: vnDateKey(w.prevStart),
    congNoTuIso: w.prevStart.toISOString(),
  }
}

/** Gộp hai lượt đọc công nợ (đang mở + lập trong kỳ) — một phiếu một dòng. */
export function gopCongNo<T extends { id: string }>(...lists: T[][]): T[] {
  const m = new Map<string, T>()
  for (const l of lists) for (const r of l) if (!m.has(r.id)) m.set(r.id, r)
  return Array.from(m.values())
}

const dangMo = (s: string) => s === "open" || s === "overdue" || s === "partial"

export interface DuLieuTongQuan {
  orders: DonTongQuan[]
  invoices: HoaDonTongQuan[]
  /** `created_at` = NGÀY TRỪ doanh số (`returns.revenue_date`, mig 192). */
  returns: ReturnSummaryRow[]
  /** Phiếu đang mở (mọi kỳ) ∪ phiếu lập từ đầu kỳ trước. */
  receivables: CongNoTongQuan[]
  /** Tổng số phiếu công nợ của sổ (đếm ở máy chủ). */
  receivableCount: number
  /** NV của hóa đơn gắn phiếu trả (hóa đơn đã ghi sổ, kể cả ngoài hai kỳ). */
  nvCuaHoaDon: Map<string, string>
}

export interface KetQuaTongQuan {
  totalRevenue: number
  totalOrders: number
  completedOrders: number
  aov: number
  momRevenue: number | null
  momOrders: number | null
  momAov: number | null
  openReceivables: number
  overdueCount: number
  receivableCount: number
  /** Đã thu trên các phiếu công nợ lập trong kỳ. */
  paidInPeriod: number
  momOpenRecv: number | null
  momPaid: number | null
  momRecvCount: number | null
  /** Doanh số THUẦN theo NV (bán − trả). Khoá "" = chưa gán. */
  salesByUser: Map<string, number>
}

export const momPct = (curr: number, prev: number): number | null => {
  if (!Number.isFinite(prev) || prev === 0) return null
  return ((curr - prev) / prev) * 100
}

export function tinhTongQuan(data: DuLieuTongQuan, periodWindows: CuaSoKy): KetQuaTongQuan {
  const d = data
  const w = periodWindows
  /* Lọc kỳ — GIỮ NGUYÊN từng phép so của bản cũ (trang `/reports` lọc cả sổ ở trình duyệt). */
  const filteredOrders = data.orders.filter((o) => new Date(o.order_date) >= w.start)
  const prevPeriodOrders = data.orders.filter((o) => {
    const t = new Date(o.order_date).getTime()
    return t >= w.prevStart.getTime() && t < w.prevEnd.getTime()
  })

  /* ⚠ `invoice_date` LÀ DATE: so bằng ngày theo giờ VN, không so mốc
     ISO/UTC — hóa đơn 0h–7h sáng không được rơi sang ngày hôm trước. */
  const filteredInvoices = (() => {
    const tu = vnDateKey(periodWindows.start)
    return data.invoices.filter((i) => String(i.invoice_date).slice(0, 10) >= tu)
  })()
  const prevPeriodInvoices = (() => {
    const tu = vnDateKey(periodWindows.prevStart)
    const den = vnDateKey(periodWindows.prevEnd)
    return data.invoices.filter((i) => {
      const x = String(i.invoice_date).slice(0, 10)
      return x >= tu && x < den
    })
  })()

  /* Phiếu trả theo NGÀY TRỪ (DATE, giờ VN) — cùng mốc với hóa đơn ở trên. */
  const filteredReturns = (() => {
    const tu = vnDateKey(periodWindows.start)
    return data.returns.filter((r) => String(r.created_at).slice(0, 10) >= tu)
  })()
  const prevPeriodReturns = (() => {
    const tu = vnDateKey(periodWindows.prevStart)
    const den = vnDateKey(periodWindows.prevEnd)
    return data.returns.filter((r) => {
      const x = String(r.created_at).slice(0, 10)
      return x >= tu && x < den
    })
  })()

  const sumInvoices = (rows: HoaDonTongQuan[]) => rows.reduce((sum, i) => sum + Number(i.total || 0), 0)
  // ⚠ `credit_note_amount` đã bỏ hàng ĐỔI (mig 055) — trừ thẳng, không kẹp.
  const sumReturns = (rows: ReturnSummaryRow[]) => rows.reduce((sum, r) => sum + Number(r.credit_note_amount || 0), 0)
  // "Đơn đã xuất hàng" = số đơn KHÁC NHAU có hóa đơn (như `period_orders` của mig 126).
  const countInvoicedOrders = (rows: HoaDonTongQuan[]) => new Set(rows.map((i) => i.order_id)).size

  /* ⚠ "Doanh thu thuần" THẬT SỰ THUẦN: hóa đơn − hàng trả trong kỳ (chủ nhà
     25/09/2026). AOV / MoM cũng tính trên số thuần. */
  const totalRevenue = sumInvoices(filteredInvoices) - sumReturns(filteredReturns)
  // Tổng đơn hàng là số liệu HOẠT ĐỘNG — vẫn đếm trên đơn.
  const totalOrders = filteredOrders.length
  const completedOrders = countInvoicedOrders(filteredInvoices)
  const aov = completedOrders > 0 ? totalRevenue / completedOrders : 0
  const prevRevenue = sumInvoices(prevPeriodInvoices) - sumReturns(prevPeriodReturns)
  const prevCompletedOrders = countInvoicedOrders(prevPeriodInvoices)
  const prevAov = prevCompletedOrders > 0 ? prevRevenue / prevCompletedOrders : 0

  /* Công nợ ĐANG MỞ: mọi phiếu chưa thu xong, không theo kỳ. ⚠ Không kẹp 0 — dòng âm
     là dư có của khách (mig 186). */
  const conLai = (r: CongNoTongQuan) => Number(r.amount || 0) - Number(r.paid || 0)
  const openReceivables = d.receivables.filter((r) => dangMo(r.status)).reduce((s, r) => s + conLai(r), 0)
  const overdueCount = d.receivables.filter((r) => r.status === "overdue").length

  const inWindow = (s: string | null | undefined, lo: Date, hi: Date) => {
    if (!s) return false
    const t = new Date(s).getTime()
    return t >= lo.getTime() && t < hi.getTime()
  }
  const recvCurrent = d.receivables.filter((r) => inWindow(r.created_at, w.start, w.end))
  const recvPrev = d.receivables.filter((r) => inWindow(r.created_at, w.prevStart, w.prevEnd))
  const moTrong = (rows: CongNoTongQuan[]) => rows.filter((r) => dangMo(r.status)).reduce((s, r) => s + conLai(r), 0)
  const daThu = (rows: CongNoTongQuan[]) => rows.reduce((s, r) => s + Number(r.paid || 0), 0)
  const paidInPeriod = daThu(recvCurrent)

  // Doanh số theo nhân viên: người được gán HÓA ĐƠN (mig 182).
  const salesByUser = new Map<string, number>()
  filteredInvoices.forEach((i) => {
    const uid = i.sales_user_id ?? ""
    salesByUser.set(uid, (salesByUser.get(uid) || 0) + Number(i.total || 0))
  })
  /* ⚠ …TRỪ hàng trả của chính người ấy (số đi − số trả, chủ nhà 25/09/2026).
     NV của phiếu trả (mig 160) trước, chưa gán thì lùi về NV của hóa đơn gắn
     phiếu — cùng thứ tự với `payroll_returns_for` (mig 192). */
  const nvCuaHoaDon = d.nvCuaHoaDon
  filteredReturns.forEach((r) => {
    const uid = r.sales_user_id ?? (r.invoice_id ? nvCuaHoaDon.get(r.invoice_id) : undefined) ?? ""
    salesByUser.set(uid, (salesByUser.get(uid) || 0) - Number(r.credit_note_amount || 0))
  })

  return {
    totalRevenue,
    totalOrders,
    completedOrders,
    aov,
    momRevenue: momPct(totalRevenue, prevRevenue),
    momOrders: momPct(totalOrders, prevPeriodOrders.length),
    momAov: momPct(aov, prevAov),
    openReceivables,
    overdueCount,
    receivableCount: d.receivableCount,
    paidInPeriod,
    momOpenRecv: momPct(moTrong(recvCurrent), moTrong(recvPrev)),
    momPaid: momPct(paidInPeriod, daThu(recvPrev)),
    momRecvCount: momPct(recvCurrent.length, recvPrev.length),
    salesByUser,
  }
}

/**
 * Phiếu trả cần tra NV từ hóa đơn gắn phiếu mà hóa đơn ấy KHÔNG nằm trong phần đã
 * đọc (phiếu tháng này có thể gắn hóa đơn của nhiều tháng trước). Bản cũ tra trên
 * cả sổ hóa đơn; nay đọc thêm đúng các hóa đơn này.
 */
export function hoaDonCanTraNv(returns: ReturnSummaryRow[], daCo: ReadonlyMap<string, string>): string[] {
  const s = new Set<string>()
  for (const r of returns) if (r.sales_user_id == null && r.invoice_id && !daCo.has(r.invoice_id)) s.add(r.invoice_id)
  return Array.from(s)
}
