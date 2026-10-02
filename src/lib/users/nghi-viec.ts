/**
 * NHÂN VIÊN NGHỈ VIỆC — chủ nhà 02/10/2026: chưa có chứng từ thì xoá hẳn; đã có thì "Cho nghỉ việc" (khoá,
 * ẩn khỏi ô chọn, giữ tên trên chứng từ cũ); "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân
 * phối lại sau". Máy chủ: mig 223 (`so_chung_tu_nhan_vien`, `cho_nhan_vien_nghi`, `giao_cong_no_npp`).
 */

export interface ChungTuNv {
  tong: number
  chi_tiet: Array<{ bang: string; cot: string; so: number }>
  khach: number
  lich_tuyen: number
  so_khoan_no: number
  tien_no: number
}

export interface NvTrangThai {
  is_active?: boolean | null
  left_at?: string | null
}

export type TrangThaiNv = "active" | "locked" | "left"

/** `is_active` NULL = chưa ai khoá (như `user_org_id()` ở máy chủ). Đã nghỉ đứng trước tạm khoá. */
export function trangThaiNv(u: NvTrangThai): TrangThaiNv {
  if (u.left_at) return "left"
  return u.is_active === false ? "locked" : "active"
}

export const NHAN_TRANG_THAI_NV: Record<TrangThaiNv, string> = {
  active: "Đang hoạt động",
  locked: "Tạm khóa",
  left: "Đã nghỉ",
}

/** Còn được chọn ở ô gán người (đơn, HĐ, phiếu trả, khách, tuyến). */
export const chonDuocNv = (u: NvTrangThai) => trangThaiNv(u) === "active"

const TEN_BANG: Record<string, string> = {
  sales_orders: "đơn hàng",
  sales_invoices: "hóa đơn",
  receivables: "công nợ",
  returns: "phiếu trả",
  cash_receipts: "phiếu thu",
  payments: "khoản thu",
  stock_entries: "phiếu kho",
  purchase_invoices: "phiếu nhập NCC",
  purchase_orders: "đơn mua",
  supplier_returns: "phiếu trả NCC",
  expenses: "phiếu chi",
  visit_logs: "lượt viếng thăm",
  payroll_run_items: "dòng bảng lương",
  order_status_history: "lịch sử đơn",
  order_activity_log: "nhật ký đơn",
}

/** "6 đơn hàng · 3 hóa đơn · 3 phiếu trả…" — gộp theo bảng (một bảng nhiều cột người), nhiều nhất `toiDa` mục. */
export function tomTatChungTu(ct: Pick<ChungTuNv, "chi_tiet">, toiDa = 4): string {
  const theoBang = new Map<string, number>()
  for (const d of ct.chi_tiet ?? []) {
    const ten = TEN_BANG[d.bang] ?? "chứng từ khác"
    theoBang.set(ten, Math.max(theoBang.get(ten) ?? 0, Number(d.so) || 0))
  }
  const ds = Array.from(theoBang, ([ten, so]) => ({ ten, so })).sort((a, b) => b.so - a.so)
  const dau = ds.slice(0, toiDa).map((d) => `${d.so} ${d.ten}`)
  return dau.join(" · ") + (ds.length > toiDa ? "…" : "")
}

/** Xoá hẳn chỉ khi không còn chứng từ nào chặn. */
export const xoaHanDuoc = (ct: Pick<ChungTuNv, "tong">) => Number(ct.tong) === 0

/** Câu lỗi tiếng Việt cho mã lỗi của mig 223. */
export function loiNhanVien(msg: string | null | undefined): string {
  const m = String(msg ?? "")
  if (m.includes("KHONG_DU_QUYEN")) return "Chỉ Chủ NPP được làm việc này."
  if (m.includes("TU_NGHI")) return "Không tự cho mình nghỉ việc được."
  if (m.includes("NGHI_CHU_NPP")) return "Không cho Chủ NPP nghỉ việc."
  if (m.includes("KHONG_TIM_THAY_NV")) return "Không tìm thấy nhân viên trong NPP."
  if (m.includes("NV_KHONG_HOP_LE")) return "Nhân viên này đã nghỉ hoặc đang tạm khoá — chọn người khác."
  if (/so_chung_tu_nhan_vien|cho_nhan_vien_nghi|giao_cong_no_npp|ve_npp_luc|left_at/.test(m) && /exist|schema cache|PGRST20/i.test(m))
    return "Máy chủ chưa chạy migration 223 (nhân viên nghỉ việc)."
  return m || "Lỗi không xác định"
}
