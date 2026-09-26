/**
 * TIỀN cho Báo cáo tổng hợp: khoản thu, phiếu chi, trả NCC, tồn quỹ, kết quả kinh doanh.
 *
 * ⚠ TỒN QUỸ / DÒNG TIỀN / LÃI LỖ đi qua đúng các hàm cộng sổ ở database đang dùng cho báo cáo
 *   Tài chính (`finance_pnl`, `finance_cash_flow`, `finance_balance_sheet`) — một con số, một chỗ
 *   tính. Khoản thu `return_credit` / `credit_applied` không phải tiền vào quỹ (mig 121).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { vnDateOf } from "@/lib/analytics/sales"
import { fetchPnl, fetchCashFlow, fetchBalanceSheet } from "@/lib/finance"
import { congNgay } from "./ky"

type Trang = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>

export const HINH_THUC: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", ewallet: "Ví điện tử" }
export const KHONG_PHAI_TIEN = ["return_credit", "credit_applied"]

export interface KhoanThu {
  id: string
  ngay: string
  tien: number
  hinhThuc: string
  kh: string
  nv: string
  nguoiThu: string
  hd: string
  maHd: string
}

export interface PhieuChi {
  id: string
  ngay: string
  tien: number
  nhom: string
  dien: string
  ma: string
  loai: "chi" | "ncc"
}

const vnTu = (d: string) => `${d}T00:00:00+07:00`
const vnDen = (d: string) => `${d}T23:59:59.999+07:00`

export async function napKhoanThu(sb: SupabaseClient, a: string, b: string): Promise<{ ds: KhoanThu[]; thieu: boolean }> {
  const r = await docDuHoacNem<{
    id: string
    amount: number
    method: string | null
    collected_at: string
    collected_by: string | null
    receivable: { customer_id: string; sales_user_id: string | null; invoice_id: string | null; invoice?: { invoice_code: string | null } | null } | null
  }>(
    (from, to): Trang =>
      sb
        .from("payments")
        .select("id, amount, method, collected_at, collected_by, receivable:receivables(customer_id, sales_user_id, invoice_id, invoice:sales_invoices(invoice_code))", { count: "exact" })
        .gte("collected_at", vnTu(a))
        .lte("collected_at", vnDen(b))
        .order("id")
        .range(from, to) as unknown as Trang,
    "đọc khoản thu"
  )
  const ds = r.rows
    .filter((p) => !KHONG_PHAI_TIEN.includes(p.method || ""))
    .map((p) => ({
      id: p.id,
      ngay: vnDateOf(p.collected_at),
      tien: Number(p.amount || 0),
      hinhThuc: HINH_THUC[p.method || ""] || p.method || "Khác",
      kh: p.receivable?.customer_id || "",
      nv: p.receivable?.sales_user_id || "",
      nguoiThu: p.collected_by || "",
      hd: p.receivable?.invoice_id || "",
      maHd: p.receivable?.invoice?.invoice_code || "",
    }))
  return { ds, thieu: r.truncated }
}

export async function napPhieuChi(sb: SupabaseClient, orgId: string, a: string, b: string, chiDaTra = true): Promise<{ ds: PhieuChi[]; thieu: boolean }> {
  const [cp, ncc] = await Promise.all([
    docDuHoacNem<{ id: string; expense_date: string; amount: number; description: string | null; reference_code: string | null; is_paid: boolean; category: { name: string | null; bucket: string | null } | null }>(
      (from, to): Trang => {
        let q = sb
          .from("expenses")
          .select("id, expense_date, amount, description, reference_code, is_paid, category:expense_categories(name, bucket)", { count: "exact" })
          .eq("org_id", orgId)
          .gte("expense_date", a)
          .lte("expense_date", b)
        if (chiDaTra) q = q.eq("is_paid", true)
        return q.order("id").range(from, to) as unknown as Trang
      },
      "đọc phiếu chi"
    ),
    docDuHoacNem<{ id: string; amount: number; paid_at: string; notes: string | null; payable: { invoice_number: string | null; supplier: { name: string | null } | null } | null }>(
      (from, to): Trang =>
        sb
          .from("payable_payments")
          .select("id, amount, paid_at, notes, payable:payables(invoice_number, supplier:suppliers(name))", { count: "exact" })
          .gte("paid_at", vnTu(a))
          .lte("paid_at", vnDen(b))
          .order("id")
          .range(from, to) as unknown as Trang,
      "đọc khoản trả nhà cung cấp"
    ),
  ])
  const ds: PhieuChi[] = [
    ...cp.rows
      .filter((e) => e.category?.bucket !== "cogs")
      .map((e) => ({ id: e.id, ngay: String(e.expense_date).slice(0, 10), tien: Number(e.amount || 0), nhom: e.category?.name || "Khác", dien: e.description || "", ma: e.reference_code || "", loai: "chi" as const })),
    ...ncc.rows.map((p) => ({
      id: p.id,
      ngay: vnDateOf(p.paid_at),
      tien: Number(p.amount || 0),
      nhom: p.payable?.supplier?.name || "Nhà cung cấp",
      dien: `Trả NCC${p.payable?.invoice_number ? " · HĐ " + p.payable.invoice_number : ""}`,
      ma: "",
      loai: "ncc" as const,
    })),
  ]
  return { ds, thieu: cp.truncated || ncc.truncated }
}

/** Tồn quỹ cuối ngày `d` (tiền mặt + tiền gửi). */
export async function tonQuy(sb: SupabaseClient, orgId: string, d: string): Promise<number> {
  return (await fetchBalanceSheet(sb, orgId, d)).assets.cash
}

export interface KetQuaKd {
  rev: number
  ret: number
  net: number
  cogs: number
  gp: number
  /** Chi phí theo nhóm (danh mục chi phí), không gồm nhóm tính vào giá vốn. */
  chi: Map<string, number>
  tongChi: number
  lai: number
}

export async function napKetQuaKd(sb: SupabaseClient, orgId: string, a: string, b: string): Promise<KetQuaKd> {
  const [p, chi] = await Promise.all([fetchPnl(sb, orgId, { from: a, to: b }), napPhieuChi(sb, orgId, a, b, false)])
  const m = new Map<string, number>()
  for (const x of chi.ds) if (x.loai === "chi") m.set(x.nhom, (m.get(x.nhom) || 0) + x.tien)
  const tongChi = p.expensesByBucket.operating + p.expensesByBucket.hr + p.expensesByBucket.financial + p.expensesByBucket.tax + p.expensesByBucket.other
  return { rev: p.revenueGross, ret: p.returnsValue, net: p.revenue, cogs: p.cogs, gp: p.grossProfit, chi: m, tongChi, lai: p.netProfit }
}

export interface DongTien {
  dau: number
  thuTm: number
  thuCk: number
  ncc: number
  chi: number
  cuoi: number
}

export async function napDongTien(sb: SupabaseClient, orgId: string, a: string, b: string): Promise<DongTien> {
  const [dau, cuoi, cf, thu] = await Promise.all([
    tonQuy(sb, orgId, congNgay(a, -1)),
    tonQuy(sb, orgId, b),
    fetchCashFlow(sb, orgId, { from: a, to: b }),
    napKhoanThu(sb, a, b),
  ])
  const tm = thu.ds.filter((x) => x.hinhThuc === "Tiền mặt").reduce((s, x) => s + x.tien, 0)
  const thuKhach = cf.operating.cashFromCustomers
  return { dau, thuTm: tm, thuCk: thuKhach - tm, ncc: cf.operating.cashToSuppliers, chi: cf.operating.cashToExpenses, cuoi }
}
