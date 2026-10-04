import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ĐỘI TEST "BÁN HÀNG / ĐƠN HÀNG" — LỖI ĐÃ XÁC MINH (đang ĐỎ, giữ tới khi sửa).
 *
 * L-TS1 trên màn thật: đơn có GIẢM GIÁ DÒNG (sổ giữ đơn giá 18.000 sau giảm, giá
 * bảng 20.000, line_discount 4.000) — chủ NPP mở "Sửa đơn" trên điện thoại, KHÔNG
 * đổi gì, nút gửi đã thành "Giá ngoài hạn mức" và bị khoá. Nguyên nhân:
 * `orderLinesToCart` (src/lib/sell/order-edit.ts:43) nạp price = 18.000, listPrice
 * = 20.000, không có `discount` → `priceViolation` = below_list
 * (src/app/(dashboard)/sell/cart/page.tsx:253, nút :834/:842).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const SUA = "00000000-0000-4000-8000-0000000000d1"
const DON = "00000000-0000-4000-8000-00000000ab01"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeEach(async () => {
  await api("sales_orders", "POST", {
    id: DON, org_id: ORG, order_code: "DH-0901", customer_id: KHACH, sales_user_id: OWNER, status: "submitted",
    subtotal: 36_000, vat: 0, total: 36_000, discount: 4_000, order_date: "2026-09-30", created_at: "2026-09-30T02:00:00Z",
    payment_terms: "COD", notes: null, expected_delivery: null, current_workflow_stage: null,
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi", route_code: null },
    sales_user: { full_name: "Chủ NPP" },
  })
  await api("sales_order_lines", "POST", {
    id: "sol-ab01", order_id: DON, product_id: SUA, unit_name: "hộp", quantity: 2, unit_price: 18_000,
    line_discount: 4_000, line_total: 36_000, conversion_factor: 1, vat_rate: 0, note: null, invoiced_qty: 0,
    product: { name: "Sữa hộp" },
  })
})
test.afterEach(async () => {
  await api(`sales_order_lines?order_id=eq.${DON}`, "DELETE")
  await api(`sales_orders?id=eq.${DON}`, "DELETE")
})

test("L-TS1: mở sửa đơn có giảm giá dòng, không đổi gì → vẫn lưu được (không 'Giá ngoài hạn mức')", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/sell/edit/${DON}`)
  await expect(page).toHaveURL(/\/sell\/cart/)
  await expect(page.getByRole("button", { name: /Tổng tiền/ })).toContainText("36.000")
  await expect(page.getByText("Giá ngoài hạn mức").first(), "đơn chưa sửa gì mà đã bị coi là giá xấu").toHaveCount(0)
  await expect(page.getByRole("button", { name: "Lưu thay đổi", exact: true })).toBeEnabled()
})
