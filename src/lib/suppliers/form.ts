/**
 * BIỂU MẪU NHÀ CUNG CẤP — trạng thái + tải trọng ghi, dùng chung cho tạo mới (`SupplierForm`) và sửa ở màn chi
 * tiết (`SupplierEditSheet`).
 *
 * ⚠ Cột hồ sơ pháp lý / hạn mức (mig 232) chỉ gửi khi CÓ giá trị hoặc bản gốc đang có giá trị (để xoá được).
 *   Preview và production dùng chung một DB: mã lên trước migration thì tạo / sửa NCC bình thường (không điền
 *   ô mới) vẫn chạy, không vấp "column does not exist".
 */
import type { NccHoSo } from "@/lib/suppliers/chi-tiet"

export interface NccForm {
  name: string
  code: string
  category: string
  contact_name: string
  phone: string
  email: string
  address: string
  tax_code: string
  bank_account: string
  bank_name: string
  payment_terms: string
  notes: string
  is_verified: boolean
  is_active: boolean
  legal_name: string
  business_type: string
  representative: string
  business_license_no: string
  /** "YYYY-MM-DD" hoặc "". */
  business_license_date: string
  registered_address: string
  /** "" = không đặt hạn mức. */
  credit_limit: number | ""
}

export const COT_MIG_232 = [
  "legal_name",
  "business_type",
  "representative",
  "business_license_no",
  "business_license_date",
  "registered_address",
  "credit_limit",
] as const

export function nccFormRong(ten = ""): NccForm {
  return {
    name: ten.trim(),
    code: "",
    category: "",
    contact_name: "",
    phone: "",
    email: "",
    address: "",
    tax_code: "",
    bank_account: "",
    bank_name: "",
    payment_terms: "NET30",
    notes: "",
    is_verified: false,
    is_active: true,
    legal_name: "",
    business_type: "",
    representative: "",
    business_license_no: "",
    business_license_date: "",
    registered_address: "",
    credit_limit: "",
  }
}

const s = (v: unknown) => (v == null ? "" : String(v))

export function nccFormTu(n: NccHoSo & { is_verified?: boolean | null }): NccForm {
  const han = n.credit_limit
  return {
    name: s(n.name),
    code: s(n.code),
    category: s(n.category),
    contact_name: s(n.contact_name),
    phone: s(n.phone),
    email: s(n.email),
    address: s(n.address),
    tax_code: s(n.tax_code),
    bank_account: s(n.bank_account),
    bank_name: s(n.bank_name),
    payment_terms: s(n.payment_terms) || "NET30",
    notes: s(n.notes),
    is_verified: !!n.is_verified,
    is_active: n.is_active !== false,
    legal_name: s(n.legal_name),
    business_type: s(n.business_type),
    representative: s(n.representative),
    business_license_no: s(n.business_license_no),
    business_license_date: s(n.business_license_date).slice(0, 10),
    registered_address: s(n.registered_address),
    credit_limit: han === null || han === undefined || s(han).trim() === "" ? "" : Number(han) || 0,
  }
}

const rongThanhNull = (v: string) => v.trim() || null

/**
 * Tải trọng ghi `suppliers` (chưa gồm `org_id` / `code` tự sinh). `goc` = bản đang sửa; không có = tạo mới.
 * Lỗi nhập (tên trống, hạn mức âm) trả về `loi`.
 */
export function nccPayload(f: NccForm, goc?: NccForm | null): { payload: Record<string, unknown>; loi: string | null } {
  if (!f.name.trim()) return { payload: {}, loi: "Nhập tên nhà cung cấp" }
  if (f.credit_limit !== "" && !(Number(f.credit_limit) >= 0)) return { payload: {}, loi: "Hạn mức công nợ không được âm" }
  if (f.business_license_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.business_license_date)) {
    return { payload: {}, loi: "Ngày cấp giấy phép không hợp lệ" }
  }
  const payload: Record<string, unknown> = {
    name: f.name.trim(),
    category: rongThanhNull(f.category),
    contact_name: rongThanhNull(f.contact_name),
    phone: rongThanhNull(f.phone),
    email: rongThanhNull(f.email),
    address: rongThanhNull(f.address),
    tax_code: rongThanhNull(f.tax_code),
    bank_account: rongThanhNull(f.bank_account),
    bank_name: rongThanhNull(f.bank_name),
    payment_terms: f.payment_terms || "NET30",
    notes: rongThanhNull(f.notes),
    is_verified: f.is_verified,
    is_active: f.is_active,
  }
  if (f.code.trim() || goc) payload.code = f.code.trim() || goc?.code || null
  for (const k of COT_MIG_232) {
    const moi = f[k]
    const cu = goc ? goc[k] : ""
    if (moi === "" && (cu === "" || cu === undefined)) continue
    if (k === "credit_limit") payload[k] = moi === "" ? null : Number(moi)
    else payload[k] = rongThanhNull(String(moi))
  }
  return { payload, loi: null }
}
