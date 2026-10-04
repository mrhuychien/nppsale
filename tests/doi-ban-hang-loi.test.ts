/**
 * ĐỘI TEST "BÁN HÀNG / ĐƠN HÀNG" — LỖI ĐÃ XÁC MINH (đang ĐỎ, giữ nguyên tới khi sửa).
 *
 *   npx vitest run tests/doi-ban-hang-loi.test.ts
 *
 * L-TS1  Mở lại một đơn có GIẢM GIÁ DÒNG để sửa → dòng bị coi là "Giá ngoài hạn mức"
 *        (below_list) với mọi người có quyền sửa giá (chủ NPP, quản lý, kế toán,
 *        NVBH bật allow_price_edit) — nút Gửi / Lưu bị khoá dù không đổi gì.
 *        Sổ chỉ giữ đơn giá SAU giảm (`toOrderLine` → `netPriceOf`), còn
 *        `orderLinesToCart` (src/lib/sell/order-edit.ts:43-62) nạp lại price = giá đã
 *        giảm, listPrice = giá bảng, KHÔNG có `discount` → `priceViolation` trả
 *        "below_list" (src/app/(dashboard)/sell/cart/page.tsx:253, nút ở :834/842).
 *        POS nạp lại cùng kiểu (src/components/pos/order-screen.tsx:552-565 → xauGia :331).
 * L-TS2  Giảm giá ĐƠN theo % ra hai số khác nhau giữa POS và /sell cho cùng một giỏ:
 *        POS (`posTotals`, src/lib/pos/totals.ts:107) tính % trên TIỀN GỘP (spec §6),
 *        /sell (`cartTotals`, src/lib/sell/cart.ts:213) tính trên tiền SAU giảm dòng —
 *        trong khi chú thích của chính cartTotals ghi "GIẢM GIÁ ĐƠN NHƯ POS".
 *        Trần quyền giảm đơn (mig 185) cũng so trên hai nền khác nhau.
 * L-TS3  Lệch giờ VN/UTC: `loadApprovalContext` (src/lib/sell/approval-context.ts:83-85)
 *        coi phiếu nợ ĐẾN HẠN HÔM NAY là QUÁ HẠN từ 07:00 sáng (new Date('YYYY-MM-DD')
 *        là 00:00 UTC = 07:00 VN). Luật dự án: đến hạn hôm nay = chưa quá hạn
 *        (`daysOverdueOf` / `getAgingStatus` src/lib/utils.ts:131, mig 140 vn_today()).
 */
import { describe, it, expect } from "vitest"
import { cartTotals, priceViolation, type CartLine } from "@/lib/sell/cart"
import { toOrderLine } from "@/lib/sell/create-order"
import { orderLinesToCart } from "@/lib/sell/order-edit"
import { posTotals } from "@/lib/pos/totals"
import { loadApprovalContext } from "@/lib/sell/approval-context"
import { getAgingStatus } from "@/lib/utils"
import type { SellProduct } from "@/lib/sell/ref-data"

const sp = {
  id: "p1", name: "Coca", sku: "SNP-001", base_unit: "lon", sell_price: 10_000, vat_rate: 0,
  price_lists: [], units: [{ unit_name: "Thung 24", conversion: 24 }],
} as unknown as SellProduct

const line = (o: Partial<CartLine> = {}): CartLine => ({
  productId: "p1", unit: "lon", qty: 10, price: 10_000, listPrice: 10_000, note: "", conversion: 1, vatRate: 0, ...o,
})

describe("L-TS1 — sửa lại đơn có giảm giá dòng bị khoá 'Giá ngoài hạn mức'", () => {
  it("lưu đơn 10 lon giảm 10% rồi mở lại để sửa (không đổi gì) → không được coi là giá xấu", () => {
    const daLuu = toOrderLine(line({ discount: { value: 10, unit: "pct" } }))
    // Sổ ghi đơn giá 9.000, line_discount 10.000 (so giá bảng)
    expect(daLuu.unit_price).toBe(9_000)
    const moLai = orderLinesToCart(
      [{ product_id: daLuu.product_id, unit_name: daLuu.unit_name, quantity: daLuu.quantity, unit_price: daLuu.unit_price,
         line_discount: daLuu.line_discount, conversion_factor: daLuu.conversion_factor, note: null, vat_rate: 0 }] as never,
      [sp],
      null
    )
    // Chủ NPP / quản lý / kế toán: canEditPrice = !isSales = true (sell/cart/page.tsx:205)
    expect(priceViolation(moLai[0], { canEditPrice: true, maxIncreasePct: 0 })).toBeNull()
  })
})

describe("L-TS2 — giảm giá ĐƠN theo % cùng một luật ở POS và /sell", () => {
  it("1.000.000 hàng, giảm dòng 10%, giảm đơn 10% → hai màn ra CÙNG khoản giảm đơn", () => {
    const pos = posTotals({
      lines: [{ qty: 100, price: 10_000, discount: { value: 10, unit: "pct" } }],
      docDiscount: { value: 10, unit: "pct" },
    })
    const sell = cartTotals([line({ qty: 100, discount: { value: 10, unit: "pct" } })], 0, { value: 10, unit: "pct" })
    expect({ pos: pos.docDiscount, sell: sell.docDiscount }).toEqual({ pos: pos.docDiscount, sell: pos.docDiscount })
  })
  it("khách cần trả giống nhau ở hai màn cho cùng giỏ", () => {
    const pos = posTotals({
      lines: [{ qty: 100, price: 10_000, discount: { value: 10, unit: "pct" } }],
      docDiscount: { value: 10, unit: "pct" },
    })
    const sell = cartTotals([line({ qty: 100, discount: { value: 10, unit: "pct" } })], 0, { value: 10, unit: "pct" })
    expect(sell.grandTotal).toBe(pos.due)
  })
})

describe("L-TS3 — nợ đến hạn HÔM NAY không phải quá hạn (giờ VN)", () => {
  /** Supabase giả: chỉ đủ cho ba câu đọc của loadApprovalContext. */
  function sb(receivables: Array<{ amount: number; paid: number; due_date: string | null }>) {
    const q = (rows: unknown[]) => {
      const b: Record<string, unknown> = {}
      for (const m of ["select", "eq", "neq", "order"]) b[m] = () => b
      b.range = async () => ({ data: rows, error: null, count: rows.length })
      b.maybeSingle = async () => ({ data: null, error: null })
      return b
    }
    return { from: (t: string) => q(t === "receivables" ? receivables : []) }
  }
  it("10:00 sáng 04/10/2026 giờ VN, phiếu đến hạn 04/10 → customerOverdue = 0", async () => {
    const now = Date.parse("2026-10-04T10:00:00+07:00")
    const ctx = await loadApprovalContext(sb([{ amount: 500_000, paid: 0, due_date: "2026-10-04" }]), {
      orgId: "o", customerId: "k", salesUserId: "u", now,
    })
    expect(ctx.customerDebt).toBe(500_000)
    expect(ctx.customerOverdue).toBe(0)
  })
  it("đối chứng: luật tuổi nợ của dự án coi đến hạn hôm nay là 'current'", () => {
    const homNay = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
    expect(getAgingStatus(homNay)).toBe("current")
  })
})
