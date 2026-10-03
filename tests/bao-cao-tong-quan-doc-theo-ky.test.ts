import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { vnDateKey } from "../src/lib/orders/status-tone"
import type { ReturnSummaryRow } from "../src/lib/analytics/sales"
import {
  cuaSoKy,
  gopCongNo,
  hoaDonCanTraNv,
  mocDoc,
  tinhTongQuan,
  type CongNoTongQuan,
  type CuaSoKy,
  type DonTongQuan,
  type HoaDonTongQuan,
  type Period,
} from "../src/app/(dashboard)/reports/_lib/tong-quan"

/**
 * TRANG `/reports` ĐỌC THEO KỲ, SỐ KHÔNG ĐỔI (03/10/2026).
 *
 * ⚠ Bản cũ tải CẢ SỔ (mọi đơn, mọi hóa đơn, phiếu trả 2000–2999, mọi phiếu công nợ)
 *   rồi lọc kỳ ở trình duyệt. Nay mỗi bảng đọc từ mốc `mocDoc` (đầu kỳ trước), công nợ
 *   đang mở đọc riêng. Phép thử: dựng một sổ giả trải nhiều năm (cả ngày tương lai,
 *   cả mốc nửa đêm giờ VN), chạy LUẬT CŨ (chép nguyên văn bên dưới) trên CẢ SỔ, chạy
 *   `tinhTongQuan` trên PHẦN ĐỌC THEO KỲ (mô phỏng đúng các câu `.gte(...)` của trang)
 *   — mọi con số phải bằng nhau.
 */

/* ───── Luật CŨ của trang (chép từ bản trước 03/10/2026), chạy trên CẢ SỔ ───── */
interface SoCu {
  salesOrders: DonTongQuan[]
  invoices: HoaDonTongQuan[]
  returns: ReturnSummaryRow[]
  receivables: CongNoTongQuan[]
}
function luatCu(data: SoCu, periodWindows: CuaSoKy) {
  const filteredOrders = data.salesOrders.filter((o) => new Date(o.order_date) >= periodWindows.start)
  const prevPeriodOrders = data.salesOrders.filter((o) => {
    const t = new Date(o.order_date).getTime()
    return t >= periodWindows.prevStart.getTime() && t < periodWindows.prevEnd.getTime()
  })
  const filteredInvoices = (() => {
    const tu = vnDateKey(periodWindows.start)
    return data.invoices.filter((i) => String(i.invoice_date).slice(0, 10) >= tu)
  })()
  const prevPeriodInvoices = (() => {
    const tu = vnDateKey(periodWindows.prevStart)
    const den = vnDateKey(periodWindows.prevEnd)
    return data.invoices.filter((i) => {
      const d = String(i.invoice_date).slice(0, 10)
      return d >= tu && d < den
    })
  })()
  const filteredReturns = (() => {
    const tu = vnDateKey(periodWindows.start)
    return data.returns.filter((r) => String(r.created_at).slice(0, 10) >= tu)
  })()
  const prevPeriodReturns = (() => {
    const tu = vnDateKey(periodWindows.prevStart)
    const den = vnDateKey(periodWindows.prevEnd)
    return data.returns.filter((r) => {
      const d = String(r.created_at).slice(0, 10)
      return d >= tu && d < den
    })
  })()
  const momPct = (curr: number, prev: number): number | null => {
    if (!Number.isFinite(prev) || prev === 0) return null
    return ((curr - prev) / prev) * 100
  }
  const sumInvoices = (rows: HoaDonTongQuan[]) => rows.reduce((sum, i) => sum + Number(i.total || 0), 0)
  const sumReturns = (rows: ReturnSummaryRow[]) => rows.reduce((sum, r) => sum + Number(r.credit_note_amount || 0), 0)
  const countInvoicedOrders = (rows: HoaDonTongQuan[]) => new Set(rows.map((i) => i.order_id)).size
  const totalRevenue = sumInvoices(filteredInvoices) - sumReturns(filteredReturns)
  const totalOrders = filteredOrders.length
  const completedOrders = countInvoicedOrders(filteredInvoices)
  const aov = completedOrders > 0 ? totalRevenue / completedOrders : 0
  const prevRevenue = sumInvoices(prevPeriodInvoices) - sumReturns(prevPeriodReturns)
  const prevTotalOrders = prevPeriodOrders.length
  const prevCompletedOrders = countInvoicedOrders(prevPeriodInvoices)
  const prevAov = prevCompletedOrders > 0 ? prevRevenue / prevCompletedOrders : 0
  const openReceivables = data.receivables
    .filter((r) => r.status === "open" || r.status === "overdue" || r.status === "partial")
    .reduce((s, r) => s + (r.amount - r.paid), 0)
  const overdueCount = data.receivables.filter((r) => r.status === "overdue").length
  const inWindow = (s: string | null | undefined, lo: Date, hi: Date) => {
    if (!s) return false
    const t = new Date(s).getTime()
    return t >= lo.getTime() && t < hi.getTime()
  }
  const recvCurrent = data.receivables.filter((r) => inWindow(r.created_at, periodWindows.start, periodWindows.end))
  const recvPrev = data.receivables.filter((r) => inWindow(r.created_at, periodWindows.prevStart, periodWindows.prevEnd))
  const mo = (rows: CongNoTongQuan[]) =>
    rows
      .filter((r) => r.status === "open" || r.status === "overdue" || r.status === "partial")
      .reduce((s, r) => s + (r.amount - r.paid), 0)
  const currPaid = recvCurrent.reduce((s, r) => s + r.paid, 0)
  const prevPaid = recvPrev.reduce((s, r) => s + r.paid, 0)
  const salesByUser = new Map<string, number>()
  filteredInvoices.forEach((i) => {
    const uid = i.sales_user_id ?? ""
    salesByUser.set(uid, (salesByUser.get(uid) || 0) + Number(i.total || 0))
  })
  const nvCuaHoaDon = new Map(data.invoices.map((i) => [i.id, i.sales_user_id ?? ""]))
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
    momOrders: momPct(totalOrders, prevTotalOrders),
    momAov: momPct(aov, prevAov),
    openReceivables,
    overdueCount,
    receivableCount: data.receivables.length,
    /** Số "Đã thanh toán" của bản cũ — Σ paid CẢ SỔ. */
    paidAllTime: data.receivables.reduce((s, r) => s + r.paid, 0),
    paidInPeriod: currPaid,
    momOpenRecv: momPct(mo(recvCurrent), mo(recvPrev)),
    momPaid: momPct(currPaid, prevPaid),
    momRecvCount: momPct(recvCurrent.length, recvPrev.length),
    salesByUser,
  }
}

/* ───── Sổ giả ───── */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const NV = ["nv1", "nv2", "nv3", ""]
const TT_NO = ["open", "partial", "paid", "overdue"]

function soGia(seed: number, now: Date): SoCu {
  const r = rng(seed)
  const nowMs = now.getTime()
  /* Rải dày quanh "bây giờ" (để mọi kỳ có số), thưa hơn về xa (tới ~8 năm trước), và
     một ít ngày TƯƠNG LAI. Thêm các mốc đúng nửa đêm giờ VN (17:00Z) để soi lệch ngày. */
  const moc = () => {
    const x = r()
    let ms: number
    if (x < 0.6) ms = nowMs - r() * 200 * 86400000
    else if (x < 0.92) ms = nowMs - r() * 3000 * 86400000
    else ms = nowMs + r() * 20 * 86400000
    if (r() < 0.2) {
      const d = new Date(ms)
      d.setUTCHours(r() < 0.5 ? 17 : 16, r() < 0.5 ? 0 : 59, 59, 999)
      ms = d.getTime()
    }
    return new Date(ms)
  }
  const invoices: HoaDonTongQuan[] = []
  const salesOrders: DonTongQuan[] = []
  for (let i = 0; i < 900; i++) {
    const d = moc()
    salesOrders.push({ id: `o${i}`, order_date: d.toISOString().slice(0, 10), status: "completed" })
    if (r() < 0.8) {
      invoices.push({
        id: `i${i}`,
        order_id: `o${i}`,
        invoice_date: vnDateKey(d),
        total: Math.round(r() * 5_000_000),
        sales_user_id: r() < 0.1 ? null : NV[Math.floor(r() * NV.length)],
      })
    }
  }
  const returns: ReturnSummaryRow[] = []
  for (let i = 0; i < 300; i++) {
    const d = moc()
    /* Phiếu gắn HĐ bất kỳ — có khi HĐ cũ hơn nhiều năm, ngoài phần đọc theo kỳ. */
    const hd = r() < 0.7 ? invoices[Math.floor(r() * invoices.length)]?.id ?? null : null
    returns.push({
      id: `r${i}`,
      status: "completed",
      customer_id: "c",
      credit_note_amount: Math.round(r() * 800_000),
      created_at: vnDateKey(d),
      sales_user_id: r() < 0.5 ? null : NV[Math.floor(r() * NV.length)],
      invoice_id: r() < 0.05 ? "hd-khong-ghi-so" : hd,
    })
  }
  const receivables: CongNoTongQuan[] = []
  for (let i = 0; i < 700; i++) {
    const amount = Math.round((r() - 0.1) * 3_000_000)
    const status = TT_NO[Math.floor(r() * TT_NO.length)]
    receivables.push({
      id: `n${i}`,
      status,
      amount,
      paid: status === "paid" ? amount : Math.round(r() * Math.max(0, amount)),
      created_at: moc().toISOString(),
    })
  }
  return { salesOrders, invoices, returns, receivables }
}

/** Mô phỏng đúng các câu đọc của trang `/reports` (cùng mốc `mocDoc`). */
function docTheoKy(so: SoCu, w: CuaSoKy) {
  const moc = mocDoc(w)
  const orders = so.salesOrders.filter((o) => o.order_date >= moc.donTu) // .gte("order_date", moc.donTu)
  const invoices = so.invoices.filter((i) => i.invoice_date >= moc.ngayTu) // .gte("invoice_date", moc.ngayTu)
  // fetchReturnsRowsDu(…, { from: moc.ngayTu, to: "2999-12-31" }) — theo `revenue_date`.
  const returns = so.returns.filter((r) => r.created_at >= moc.ngayTu && r.created_at <= "2999-12-31")
  const dangMo = so.receivables.filter((r) => r.status !== "paid") // .neq("status", "paid")
  const trongKy = so.receivables.filter((r) => Date.parse(r.created_at) >= Date.parse(moc.congNoTuIso)) // .gte("created_at", …)
  const nvCuaHoaDon = new Map(invoices.map((i) => [i.id, i.sales_user_id ?? ""]))
  const can = new Set(hoaDonCanTraNv(returns, nvCuaHoaDon))
  for (const h of so.invoices) if (can.has(h.id)) nvCuaHoaDon.set(h.id, h.sales_user_id ?? "")
  return {
    data: {
      orders,
      invoices,
      returns,
      receivables: gopCongNo(dangMo, trongKy),
      receivableCount: so.receivables.length, // head count ở máy chủ
      nvCuaHoaDon,
    },
    soDong: orders.length + invoices.length + returns.length + dangMo.length + trongKy.length,
  }
}

const KY: Period[] = ["today", "week", "month", "quarter", "custom"]
const NOW = [
  new Date("2026-10-03T03:00:00Z"),
  new Date("2026-10-01T17:30:00Z"), // 00:30 sáng 02/10 giờ VN
  new Date("2026-03-31T16:59:00Z"), // 23:59 ngày 31/03 giờ VN
  new Date("2027-01-01T00:10:00Z"),
]

describe("reports/page — đọc theo kỳ, số bằng bản đọc cả sổ", () => {
  it.each(NOW.flatMap((n, j) => KY.map((k) => [k, n.toISOString(), j] as const)))(
    "%s @ %s",
    (ky, nowIso, j) => {
      const now = new Date(nowIso)
      const so = soGia(17 + j * 31, now)
      const w = cuaSoKy(ky, now)
      const cu = luatCu(so, w)
      const { data, soDong } = docTheoKy(so, w)
      const moi = tinhTongQuan(data, w)

      expect(moi.totalRevenue).toBeCloseTo(cu.totalRevenue, 6)
      expect(moi.totalOrders).toBe(cu.totalOrders)
      expect(moi.completedOrders).toBe(cu.completedOrders)
      expect(moi.aov).toBeCloseTo(cu.aov, 6)
      expect(moi.momRevenue).toEqual(cu.momRevenue)
      expect(moi.momOrders).toEqual(cu.momOrders)
      expect(moi.momAov).toEqual(cu.momAov)
      expect(moi.openReceivables).toBe(cu.openReceivables)
      expect(moi.overdueCount).toBe(cu.overdueCount)
      expect(moi.receivableCount).toBe(cu.receivableCount)
      expect(moi.paidInPeriod).toBe(cu.paidInPeriod)
      expect(moi.momOpenRecv).toEqual(cu.momOpenRecv)
      expect(moi.momPaid).toEqual(cu.momPaid)
      expect(moi.momRecvCount).toEqual(cu.momRecvCount)
      expect(Object.fromEntries(moi.salesByUser)).toEqual(Object.fromEntries(cu.salesByUser))

      /* Kỳ ngắn thì đọc ÍT hơn cả sổ thật — không phải vẫn tải hết rồi lọc. */
      const caSo = so.salesOrders.length + so.invoices.length + so.returns.length + so.receivables.length
      if (ky !== "custom") expect(soDong).toBeLessThan(caSo)
    }
  )

  it("sổ có số trong kỳ (phép thử không rỗng)", () => {
    const now = NOW[0]
    const so = soGia(17, now)
    const w = cuaSoKy("month", now)
    const cu = luatCu(so, w)
    expect(cu.totalOrders).toBeGreaterThan(10)
    expect(cu.totalRevenue).not.toBe(0)
    expect(cu.momPaid).not.toBeNull()
    /* Có phiếu trả cần tra NV từ HĐ NGOÀI phần đọc theo kỳ — nhánh đọc thêm có việc. */
    const { data } = docTheoKy(so, w)
    const daDoc = new Set(data.invoices.map((i) => i.id))
    expect(data.returns.some((r) => r.sales_user_id == null && r.invoice_id && !daDoc.has(r.invoice_id) && r.invoice_id !== "hd-khong-ghi-so")).toBe(true)
  })

  it('"Đã thanh toán" nay là số đã thu trên phiếu lập trong kỳ; kỳ "Tùy chỉnh" (cả sổ) ra đúng số cả sổ cũ', () => {
    const now = NOW[0]
    const so = soGia(5, now)
    const w = cuaSoKy("custom", now)
    const { data } = docTheoKy(so, w)
    const moi = tinhTongQuan(data, w)
    /* Sổ giả có phiếu ngày tương lai (sau `now`) — bản cũ cộng cả chúng vào số cả sổ. */
    const tuongLai = so.receivables.filter((r) => Date.parse(r.created_at) >= now.getTime()).reduce((s, r) => s + r.paid, 0)
    expect(moi.paidInPeriod).toBe(luatCu(so, w).paidAllTime - tuongLai)
  })
})

describe("mốc đọc", () => {
  it("đơn: ngày UTC của đầu kỳ trước (cột DATE so như nửa đêm UTC)", () => {
    const w = cuaSoKy("month", new Date("2026-10-01T17:30:00Z"))
    const m = mocDoc(w)
    expect(m.donTu).toBe(w.prevStart.toISOString().slice(0, 10))
    expect(m.ngayTu).toBe(vnDateKey(w.prevStart))
    expect(m.congNoTuIso).toBe(w.prevStart.toISOString())
  })

  it("gộp công nợ: một phiếu một dòng", () => {
    const a = { id: "x", status: "open", amount: 1, paid: 0, created_at: "2026-01-01" }
    expect(gopCongNo([a], [a, { ...a, id: "y" }]).map((r) => r.id)).toEqual(["x", "y"])
  })
})

describe("reports/page.tsx — câu đọc có mốc kỳ", () => {
  const ROOT = resolve(__dirname, "..")
  const S = readFileSync(resolve(ROOT, "src/app/(dashboard)/reports/page.tsx"), "utf-8")
  it("không còn đọc phiếu trả 2000–2999 / cả sổ công nợ", () => {
    expect(S).not.toContain('from: "2000-01-01"')
    expect(S).toContain('.gte("order_date", moc.donTu)')
    expect(S).toContain('.gte("invoice_date", moc.ngayTu)')
    expect(S).toContain("fetchReturnsRowsDu(supabase, orgId, { from: moc.ngayTu,")
    expect(S).toContain('.neq("status", "paid")')
    expect(S).toContain('.gte("created_at", moc.congNoTuIso)')
    expect(S).toMatch(/useEffect\([\s\S]*?\}, \[user\?\.org_id, period\]\)/)
  })
})
