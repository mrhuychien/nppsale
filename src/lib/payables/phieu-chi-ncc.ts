import type { SupabaseClient } from "@supabase/supabase-js"
import type { Expense } from "@/types"
import type { CoRpc } from "@/lib/db/co-rpc"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { homNayVNKey } from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"

/**
 * PHIẾU CHI TRẢ NHÀ CUNG CẤP (mig 242).
 *
 * ⚠ CHỦ NHÀ 09/10/2026: "Trong quỹ tiền mặt có phiếu thu và phiếu chi, phiếu chi thêm phần chi cho ncc và chọn NCC là
 *   xong, phiếu chi xuất hiện xong giao dịch NCC là xong, ko nhất thiết phiếu chi phải chi trả đúng hóa đơn nào đó, có
 *   thể chi trả ncc 1 cục 200 triệu, nhiều hóa đơn nợ ...".
 * ⚠ MÁY CHỦ chia tiền vào các khoản nợ cũ nhất của NCC (nợ đầu kỳ trước, rồi theo ngày ghi nợ); trả dư thành tiền trả
 *   trước, tự trừ vào phiếu nhập sau. Màn hình không tự chia, không tự ghi bảng nào — chỉ gọi RPC.
 * ⚠ Trả NCC là TRẢ NỢ, không phải chi phí: không vào lãi lỗ; dòng tiền cộng qua `payable_payments` như trước.
 * ⚠ Bảng / cột mới (supplier_payments, payable_payments.supplier_payment_id) đọc RIÊNG và nuốt lỗi "chưa có bảng":
 *   sổ chưa chạy 242 thì chỉ không thấy phiếu chi NCC, các màn khác không vỡ.
 */

export type HinhThucChiNcc = "cash" | "transfer"

export const HINH_THUC_CHI_NCC: ReadonlyArray<{ value: HinhThucChiNcc; label: string }> = [
  { value: "cash", label: "Tiền mặt" },
  { value: "transfer", label: "Chuyển khoản" },
]

export const nhanHinhThucChiNcc = (m: string | null | undefined): string =>
  HINH_THUC_CHI_NCC.find((h) => h.value === m)?.label ?? (m || "—")

/** Vai được lập / huỷ phiếu chi trả NCC — như `record_payable_payment` (mig 167) và RPC mig 242. */
export const VAI_CHI_TRA_NCC = ["owner", "accountant"] as const
export const duocChiTraNcc = (role: string | null | undefined): boolean =>
  !!role && (VAI_CHI_TRA_NCC as readonly string[]).includes(role)

/** Giá trị các ô của phiếu chi trả NCC trên màn hình. */
export interface GiaTriChiNcc {
  supplierId: string
  amount: number
  date: string
  method: HinhThucChiNcc
  reference: string
  notes: string
}

export const giaTriChiNccMoi = (supplierId = "", homNay: string = homNayVNKey()): GiaTriChiNcc => ({
  supplierId, amount: 0, date: homNay, method: "cash", reference: "", notes: "",
})

/** Lỗi nhập trước khi gửi — `null` là gửi được. Máy chủ vẫn kiểm lại đủ. */
export function kiemPhieuChiNcc(v: GiaTriChiNcc, homNay: string = homNayVNKey()): string | null {
  if (!v.supplierId) return "Chọn nhà cung cấp"
  if (!(v.amount > 0)) return "Nhập số tiền chi lớn hơn 0"
  if (!v.date) return "Chọn ngày chi"
  if (v.date > homNay) return "Ngày chi không được sau hôm nay"
  return null
}

export interface PhieuChiNcc {
  id: string
  code: string
  supplier_id: string
  paid_date: string
  amount: number
  method: HinhThucChiNcc
  reference_code: string | null
  notes: string | null
  status: "posted" | "cancelled"
  prepay_payable_id?: string | null
  created_by: string | null
  created_at: string
  cancelled_at?: string | null
  cancel_reason?: string | null
  supplier?: { name?: string | null; code?: string | null } | null
}

/** Một dòng của danh sách phiếu chi (màn Chi phí): khoản chi phí, hoặc phiếu chi trả NCC (`ncc`). */
export type DongChi = Expense & { ncc?: PhieuChiNcc }

/**
 * Phiếu chi NCC → một dòng của danh sách phiếu chi: đã chi, ngày chi = `paid_date`, mã = PCNCC-…, mô tả = tên NCC (+ ghi
 * chú). Không có danh mục chi phí — màn hiện nhóm riêng "Trả NCC" và không cộng vào nhóm chi phí nào.
 */
export function dongChiCuaPhieuNcc(p: PhieuChiNcc): DongChi {
  return {
    id: p.id,
    org_id: "",
    category_id: null,
    expense_date: p.paid_date,
    amount: Number(p.amount) || 0,
    description: [p.supplier?.name, p.notes].filter(Boolean).join(" — ") || null,
    reference_code: p.code,
    source_type: null,
    source_id: null,
    is_paid: true,
    paid_at: p.created_at,
    payment_method: p.method,
    created_by: p.created_by,
    created_at: p.created_at,
    updated_at: p.created_at,
    ncc: p,
  }
}

export interface KetQuaChiNcc {
  id: string
  code: string
  so_tien: number
  /** Phần đã trừ vào các khoản nợ. */
  da_tru_no: number
  /** Phần dư — tiền trả trước của NCC. */
  tra_truoc: number
  /** Số khoản nợ được trừ. */
  so_khoan: number
}

/** Bảng chưa có (sổ chưa chạy mig 242): Postgres 42P01 / PostgREST PGRST205 / câu "does not exist". */
export function chuaCoPhieuChiNcc(err: unknown): boolean {
  if (!err) return false
  const e = err as { code?: string; message?: string }
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202") return true
  const m = String(e.message ?? err).toLowerCase()
  return (m.includes("supplier_payments") || m.includes("chi_tra_ncc") || m.includes("supplier_payment_id"))
    && (m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find"))
}

/** Câu lỗi của RPC sang tiếng người: cắt mã ở đầu; máy chủ chưa có hàm thì nói phải chạy migration. */
export function loiPhieuChiNcc(err: unknown): string {
  if (chuaCoPhieuChiNcc(err)) return "Máy chủ chưa có phiếu chi trả NCC — cần chạy migration 242 trên Supabase."
  const msg = String((err as { message?: string } | null)?.message ?? err ?? "").trim()
  // `[\s\S]` chứ không phải cờ `s` (target chưa bật es2018).
  const m = /^[A-Z_]+:\s*([\s\S]+)$/.exec(msg)
  return m ? m[1] : msg
}

export async function lapPhieuChiNcc(
  sb: CoRpc,
  input: { supplierId: string; amount: number; paidDate: string; method: HinhThucChiNcc; notes?: string | null; reference?: string | null }
): Promise<KetQuaChiNcc> {
  const { data, error } = await sb.rpc("chi_tra_ncc", {
    p_supplier_id: input.supplierId,
    p_amount: input.amount,
    p_paid_date: input.paidDate,
    p_method: input.method,
    p_notes: input.notes?.trim() || null,
    p_reference: input.reference?.trim() || null,
  })
  if (error) throw new Error(loiPhieuChiNcc(error))
  const k = (data ?? {}) as Record<string, unknown>
  return {
    id: String(k.id ?? ""),
    code: String(k.code ?? ""),
    so_tien: Number(k.so_tien) || 0,
    da_tru_no: Number(k.da_tru_no) || 0,
    tra_truoc: Number(k.tra_truoc) || 0,
    so_khoan: Number(k.so_khoan) || 0,
  }
}

export async function huyPhieuChiNcc(sb: CoRpc, id: string, lyDo?: string | null): Promise<{ da_huy: boolean; so_tien_go: number }> {
  const { data, error } = await sb.rpc("huy_phieu_chi_ncc", { p_id: id, p_reason: lyDo?.trim() || null })
  if (error) throw new Error(loiPhieuChiNcc(error))
  const k = (data ?? {}) as Record<string, unknown>
  return { da_huy: k.da_huy === true, so_tien_go: Number(k.so_tien_go) || 0 }
}

/** Câu báo sau khi lập phiếu chi — nói rõ tiền đã trừ vào đâu, dư bao nhiêu. */
export function thongBaoChiNcc(k: KetQuaChiNcc): { title: string; description: string } {
  const phan: string[] = []
  if (k.da_tru_no > 0) phan.push(`đã trừ ${formatCurrency(k.da_tru_no)} vào ${k.so_khoan} khoản nợ cũ nhất`)
  if (k.tra_truoc > 0) phan.push(`${formatCurrency(k.tra_truoc)} là tiền trả trước (tự trừ vào phiếu nhập sau)`)
  return {
    title: `Đã lập phiếu chi ${k.code} — ${formatCurrency(k.so_tien)}`,
    description: phan.length ? phan.join("; ") + "." : "Đã ghi phiếu chi.",
  }
}

const SELECT_PHIEU = "id, code, supplier_id, paid_date, amount, method, reference_code, notes, status, prepay_payable_id, created_by, created_at, cancelled_at, cancel_reason, supplier:suppliers(name, code)"

/**
 * Phiếu chi NCC CÒN HIỆU LỰC có ngày chi trong [tu, den] (màn Chi phí). Sổ chưa chạy 242 → rỗng, không báo lỗi.
 */
export async function napPhieuChiNcc(
  sb: SupabaseClient,
  orgId: string,
  tu: string,
  den: string
): Promise<{ ds: PhieuChiNcc[]; loi: string | null; truncated: boolean }> {
  const res = await fetchAllForAggregate<PhieuChiNcc>((from, to) =>
    sb
      .from("supplier_payments")
      .select(SELECT_PHIEU, { count: "exact" })
      .eq("org_id", orgId)
      .eq("status", "posted")
      .gte("paid_date", tu)
      .lte("paid_date", den)
      .order("paid_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  )
  if (res.error) {
    if (chuaCoPhieuChiNcc(res.error)) return { ds: [], loi: null, truncated: false }
    return { ds: [], loi: `Không đọc được phiếu chi trả NCC: ${res.error}`, truncated: false }
  }
  return { ds: res.rows, loi: null, truncated: res.truncated }
}

/** Mọi phiếu chi NCC của một NCC (màn chi tiết NCC). Lỗi / chưa có bảng → rỗng. */
export async function docPhieuChiCuaNcc(sb: SupabaseClient, supplierId: string): Promise<PhieuChiNcc[]> {
  const res = await fetchAllForAggregate<PhieuChiNcc>((from, to) =>
    sb
      .from("supplier_payments")
      .select(SELECT_PHIEU, { count: "exact" })
      .eq("supplier_id", supplierId)
      .order("paid_date", { ascending: false })
      .order("id")
      .range(from, to)
  )
  if (res.error && !chuaCoPhieuChiNcc(res.error)) console.error("[phieu-chi-ncc] đọc phiếu chi của NCC lỗi:", res.error)
  return res.error ? [] : res.rows
}

/** Một phiếu chi NCC (trang chi tiết). `null` = không có / không đọc được (kèm câu lỗi). */
export async function docMotPhieuChiNcc(sb: SupabaseClient, id: string): Promise<{ phieu: PhieuChiNcc | null; loi: string | null }> {
  const { data, error } = await sb.from("supplier_payments").select(SELECT_PHIEU).eq("id", id).maybeSingle()
  if (error) return { phieu: null, loi: loiPhieuChiNcc(error) }
  return { phieu: (data as unknown as PhieuChiNcc) ?? null, loi: null }
}

export interface PhanTruPhieuChi {
  payableId: string
  tien: number
  /** Nhãn khoản nợ: mã phiếu nhập PN- / "Nợ đầu kỳ" / số HĐ / "Trả trước". */
  ma: string
  loai: "phieu-nhap" | "dau-ky" | "lap-tay" | "tra-truoc"
  href: string
}

/**
 * Phiếu chi đã trừ vào những khoản nợ nào (mỗi khoản một dòng, gộp nhiều phần của cùng khoản). Dòng "trả trước" là
 * phần chưa trừ được vào khoản nào. Thứ tự = thứ tự máy chủ trừ: nợ đầu kỳ, rồi khoản ghi nợ trước; trả trước cuối.
 */
export async function docPhanTruPhieuChi(sb: SupabaseClient, phieu: Pick<PhieuChiNcc, "id" | "prepay_payable_id">): Promise<PhanTruPhieuChi[]> {
  const { data, error } = await sb
    .from("payable_payments")
    .select("id, payable_id, amount, payable:payables(id, invoice_number, opening_balance, created_at)")
    .eq("supplier_payment_id", phieu.id)
    .order("id")
  if (error) throw new Error(loiPhieuChiNcc(error))
  type No = { id: string; invoice_number: string | null; opening_balance: boolean | null; created_at?: string | null }
  const rows = (data ?? []) as unknown as Array<{ payable_id: string; amount: number; payable: No | null }>
  const ids = Array.from(new Set(rows.map((r) => r.payable_id)))
  const nhap = new Map<string, { id: string; receipt_code: string | null }>()
  if (ids.length) {
    const pn = await sb.from("purchase_invoices").select("id, payable_id, receipt_code").in("payable_id", ids)
    if (pn.error) throw new Error(pn.error.message)
    for (const p of (pn.data ?? []) as Array<{ id: string; payable_id: string; receipt_code: string | null }>) nhap.set(p.payable_id, p)
  }
  const gop = new Map<string, PhanTruPhieuChi>()
  const no = new Map<string, No | null>()
  for (const r of rows) {
    const cu = gop.get(r.payable_id)
    if (cu) { cu.tien += Number(r.amount) || 0; continue }
    const n = nhap.get(r.payable_id)
    const traTruoc = r.payable_id === phieu.prepay_payable_id
    no.set(r.payable_id, r.payable)
    gop.set(r.payable_id, {
      payableId: r.payable_id,
      tien: Number(r.amount) || 0,
      ma: traTruoc ? "Tiền trả trước" : n?.receipt_code || (r.payable?.opening_balance ? "Nợ đầu kỳ" : r.payable?.invoice_number || "Công nợ"),
      loai: traTruoc ? "tra-truoc" : n ? "phieu-nhap" : r.payable?.opening_balance ? "dau-ky" : "lap-tay",
      href: n ? `/purchasing/receipts/${n.id}` : `/payables/${r.payable_id}`,
    })
  }
  // Như `_don_tra_truoc_ncc`: nợ đầu kỳ trước, rồi theo ngày ghi nợ, rồi id; phần trả trước cuối cùng.
  const khoa = (p: PhanTruPhieuChi) => {
    const r = no.get(p.payableId)
    return [p.loai === "tra-truoc" ? 1 : 0, r?.opening_balance ? 0 : 1, r?.created_at ?? "", p.payableId] as const
  }
  return Array.from(gop.values()).sort((a, b) => {
    const x = khoa(a), y = khoa(b)
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]) || x[3].localeCompare(y[3])
  })
}
