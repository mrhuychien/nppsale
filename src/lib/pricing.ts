// =====================================================================
// Per-USER price-edit rules (migration 027 — Update #2 v2 §4.6)
// =====================================================================
//
// File này CHỈ còn đọc quyền của người dùng ra thành luật. Phép KIỂM giá
// không ở đây:
//   • Dòng bán  → `priceViolation` trong `@/lib/sell/cart`
//     (sàn = giá bảng, trần = giá bảng + max_increase_pct).
//   • Dòng trả  → `returnPriceViolation` trong `@/lib/sell/returns`
//     (không có sàn, trần = giá tham chiếu + CÙNG max_increase_pct).
//
// ⚠ Ở đây từng có ba hàm kiểm giá nữa — `validateUserSalesPrice`,
// `userSalesCeiling`, `validateUserReturnPrice`. Không màn nào gọi tới
// chúng, nhưng chúng vẫn có chốt kiểm thử xanh, nên đọc code là tưởng
// luật giá nằm ở đây. Tệ hơn: `validateUserReturnPrice` ghi "đơn trả:
// giá ≤ giá đã bán" — KHÔNG có biên độ — trong khi luật đang chạy cho
// phép nâng đúng bằng biên độ của giá bán. Hai câu trả lời khác nhau cho
// cùng một câu hỏi thì sớm muộn có người đọc nhầm câu chết. Đã xoá.
//
// Owner & accountant có flag free → bỏ qua check (UI cho nhập tự do).

import { discountAmount, type DiscountInput } from "@/lib/pos/discount"

export interface UserPriceEditRules {
  allow_price_edit: boolean
  /** % cap tăng giá tối đa khi bán. 0 = không được tăng (chỉ bằng list). */
  price_edit_max_increase_pct: number
  /** True khi user là owner/accountant — bỏ qua mọi check (free). */
  free: boolean
}

export function userPriceRulesFrom(
  user:
    | {
        role?: string | null
        allow_price_edit?: boolean
        price_edit_max_increase_pct?: number
      }
    | null
    | undefined
): UserPriceEditRules {
  const free = user?.role === "owner" || user?.role === "accountant"
  return {
    allow_price_edit: free || !!user?.allow_price_edit,
    price_edit_max_increase_pct: Math.max(
      0,
      Number(user?.price_edit_max_increase_pct ?? 0)
    ),
    free,
  }
}

// =====================================================================
// Quyền GIẢM GIÁ theo từng nhân viên (migration 185)
// =====================================================================

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Cho phép giảm giá, set tối đa theo % hoặc giá trị
 *   (nếu để trống, ko giới hạn) … bật/tắt cho từng nhân viên bán hàng … Mặc
 *   định là tắt, khi tắt, phần giảm giá ở từng dòng và cả đơn ẩn đi với nhân
 *   viên bán hàng. Nhà phân phối thì toàn quyền giảm giá dòng và giảm giá đơn."
 *
 * ⚠ TOÀN QUYỀN = cùng nhóm `free` với quyền sửa giá (chủ NPP, kế toán).
 * ⚠ TRẦN ÁP RIÊNG cho mỗi dòng (so với tiền hàng dòng) và cho cả đơn (so với
 *   tiền hàng đơn). `maxValue = null` là không giới hạn.
 */
export interface UserDiscountRules {
  /** Thấy và dùng được ô giảm giá dòng / giảm giá đơn. */
  allowed: boolean
  maxType: "pct" | "vnd"
  maxValue: number | null
  free: boolean
}

export function userDiscountRulesFrom(
  user:
    | {
        role?: string | null
        allow_discount?: boolean
        discount_max_type?: string | null
        discount_max_value?: number | string | null
      }
    | null
    | undefined
): UserDiscountRules {
  const free = user?.role === "owner" || user?.role === "accountant"
  const raw = user?.discount_max_value
  const v = raw === null || raw === undefined || raw === "" ? null : Number(raw)
  return {
    allowed: free || !!user?.allow_discount,
    maxType: user?.discount_max_type === "vnd" ? "vnd" : "pct",
    maxValue: free || v === null || !Number.isFinite(v) || v < 0 ? null : v,
    free,
  }
}

/**
 * Khoản giảm TỐI ĐA (đồng) được phép trên một tiền hàng. `Infinity` = không
 * giới hạn; không có quyền thì 0.
 */
export function tranGiamGia(rules: UserDiscountRules, tienHang: number): number {
  if (!rules.allowed) return 0
  if (rules.maxValue === null) return Infinity
  const g = Math.max(0, Number(tienHang) || 0)
  return rules.maxType === "pct" ? Math.floor((g * Math.min(100, rules.maxValue)) / 100) : rules.maxValue
}

/** Câu nói ra mức trần cho người dùng — rỗng khi không giới hạn. */
export function nhanTranGiamGia(rules: UserDiscountRules): string {
  if (!rules.allowed || rules.maxValue === null) return ""
  return rules.maxType === "pct"
    ? `Tối đa ${String(rules.maxValue).replace(".", ",")}%`
    : `Tối đa ${Math.round(rules.maxValue).toLocaleString("vi-VN")}đ`
}

/**
 * Kẹp một ô giảm giá vào trần của người dùng — gõ quá thì ô tự về đúng mức
 * trần (giữ cách nhập ₫ / % người dùng đang chọn), không lặng lẽ bỏ.
 */
export function kepGiamGia(d: DiscountInput, tienHang: number, rules: UserDiscountRules): DiscountInput {
  if (!rules.allowed) return { value: 0, unit: d.unit }
  const tran = tranGiamGia(rules, tienHang)
  if (!Number.isFinite(tran)) return d
  if (discountAmount(d, tienHang) <= tran) return d
  if (d.unit === "vnd") return { value: tran, unit: "vnd" }
  const g = Math.max(0, Number(tienHang) || 0)
  /* Làm tròn XUỐNG 4 chữ số — làm tròn lên là vượt trần một đồng. */
  return { value: g > 0 ? Math.floor((tran / g) * 1_000_000) / 10_000 : 0, unit: "pct" }
}

/** Khoản giảm (đồng) có vượt trần không — chốt lúc gửi đơn. */
export function vuotTranGiam(giam: number, tienHang: number, rules: UserDiscountRules): boolean {
  return giam > 0 && giam > tranGiamGia(rules, tienHang)
}

/**
 * Chốt quyền giảm giá dùng chung cho /sell và POS — mỗi dòng và cả đơn theo
 * tiền hàng của chính nó. `giamDonGoc`: khoản giảm đơn đã có sẵn (NPP đặt) —
 * giữ nguyên thì không bị chặn. Trả câu lỗi hoặc `null`.
 */
export function kiemGiamGia(
  dong: ReadonlyArray<{ giam: number; tienHang: number }>,
  don: { giam: number; tienHang: number },
  rules: UserDiscountRules,
  giamDonGoc = 0
): string | null {
  if (rules.free) return null
  for (const d of dong) {
    if (d.giam <= 0) continue
    if (!rules.allowed) return "Bạn không có quyền giảm giá dòng — bỏ giảm giá ở các dòng rồi gửi lại."
    if (vuotTranGiam(d.giam, d.tienHang, rules)) return `Giảm giá dòng vượt mức cho phép (${nhanTranGiamGia(rules)}).`
  }
  if (don.giam > Math.max(0, giamDonGoc)) {
    if (!rules.allowed) return "Bạn không có quyền giảm giá đơn."
    if (vuotTranGiam(don.giam, don.tienHang, rules)) return `Giảm giá đơn vượt mức cho phép (${nhanTranGiamGia(rules)}).`
  }
  return null
}
