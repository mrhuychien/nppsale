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
