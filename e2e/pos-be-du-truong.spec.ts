import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Khi Xuất hàng từ Đơn hàng / Sửa hóa đơn -> Mất ghi
 *   chú cho từng dòng · Bê nguyên các trường từ Đơn hàng sang Hóa đơn, ko được
 *   để sót · Tương tự với phần Trả hàng: các trường từ đơn hàng cũng phải đủ".
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const SUA = "00000000-0000-4000-8000-0000000000d1"
const DON = "00000000-0000-4000-8000-0000000000e7"
const chen = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })
const goiCuoi = async (fn: string) => (await nhatKy()).filter((r) => r.path.endsWith(`/rpc/${fn}`)).at(-1)

async function donCoGiam() {
  /* Đơn 2 × 100.000 = 200.000, giảm cả đơn 30.000 → subtotal 170.000; thuế dòng 8%,
     ghi chú dòng và ghi chú đơn. */
  await chen("sales_orders", [{
    id: DON, org_id: "khong-hien-trong-danh-sach", order_code: "DH-0107", customer_id: KHACH, sales_user_id: OWNER,
    status: "submitted", payment_terms: "COD", notes: "Giao trước 8h", subtotal: 170000, vat: 16000, total: 186000,
    order_date: "2026-09-24", created_at: "2026-09-24T08:00:00Z",
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" },
  }])
  await chen("sales_order_lines", [{
    id: "sol7", order_id: DON, product_id: SUA, unit_name: "hộp", quantity: 2, unit_price: 100000,
    line_total: 200000, conversion_factor: 1, invoiced_qty: 0, vat_rate: 0.08, note: "lấy lô mới",
  }])
}
async function donDep() {
  await xoa("sales_order_lines", "id", "sol7")
  await xoa("sales_orders", "id", DON)
}
const ban = (p: Page) => p.getByRole("button", { name: /Xuất hàng & lập HĐ/ })

test("xuất hàng: ghi chú dòng, thuế dòng, giảm giá đơn, ghi chú đơn đi đủ sang hóa đơn", async ({ page }) => {
  await donCoGiam()
  try {
    await dangNhap(page)
    await page.goto(`/pos/hoa-don/moi?order=${DON}`)
    await expect(page.getByTestId("dong-hoa-don")).toHaveCount(1)
    // Ghi chú dòng của đơn nạp sẵn và sửa được.
    const ghiChuDong = page.getByLabel("Ghi chú dòng 1", { exact: true })
    await expect(ghiChuDong, "mất ghi chú dòng").toHaveValue("lấy lô mới")
    await ghiChuDong.fill("lấy lô mới · giao chiều")
    // Thuế của DÒNG ĐƠN (8%), không phải thuế danh mục.
    await expect(page.locator("#hd-vat")).toHaveValue("8")
    // Giảm giá cả đơn của đơn đi sang (30.000), ghi chú đơn vào ô ghi chú hóa đơn.
    await expect(page.getByLabel("Giảm giá đơn", { exact: true })).toHaveValue("30.000")
    await expect(page.getByLabel("Ghi chú hóa đơn")).toHaveValue("Giao trước 8h")

    const moIn = page.context().waitForEvent("page")
    await ban(page).click()
    await (await moIn).close()
    await expect.poll(async () => !!(await goiCuoi("post_invoice"))).toBe(true)
    const p = ((await goiCuoi("post_invoice"))!.body as { p: Record<string, unknown> }).p as {
      lines: Array<Record<string, unknown>>; discount?: number; notes?: string
    }
    expect(p.lines[0], "dòng hóa đơn thiếu trường của dòng đơn").toMatchObject({
      order_line_id: "sol7", quantity: 2, unit_price: 100000, vat_rate: 0.08, note: "lấy lô mới · giao chiều",
    })
    expect(p.discount, "giảm giá đơn không sang hóa đơn").toBe(30000)
    expect(p.notes).toBe("Giao trước 8h")
  } finally {
    await donDep()
  }
})

test("sửa hóa đơn: lý do + ghi chú dòng trả sửa được và đi lên return_edits", async ({ page }) => {
  const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
  const DON_HD = "00000000-0000-4000-8000-0000000000f9"
  await chen("sales_orders", [{
    id: DON_HD, org_id: "khong-hien-trong-danh-sach", order_code: "DH-0009", customer_id: KHACH, sales_user_id: OWNER,
    status: "completed", payment_terms: "COD", notes: null, customer: { store_name: "Tạp hoá Cô Ba" },
  }])
  await chen("sales_order_lines", [{
    id: "sol9", order_id: DON_HD, product_id: SUA, unit_name: "thùng", quantity: 2, conversion_factor: 24,
    unit_price: 450000, invoiced_qty: 2, line_total: 900000,
  }])
  await chen("returns", [{
    id: "r-bd", org_id: "khong-hien-trong-danh-sach", order_id: DON_HD, invoice_id: HOA_DON, customer_id: KHACH,
    status: "submitted", credit_note_amount: 40000,
    lines: [{ id: "rl-bd1", product_id: SUA, unit_name: "hộp", quantity: 2, unit_price: 20000, vat_rate: 0,
      is_exchange: false, note: "móp", reason: "damaged", product: { name: "Sữa hộp", sku: "SUA1" } }],
  }])
  try {
    await dangNhap(page)
    await page.goto(`/pos/hoa-don/${HOA_DON}/sua`)
    await expect(page.getByTestId("dong-tra-cu")).toHaveCount(1)
    await expect(page.getByLabel("Ghi chú dòng trả 1", { exact: true }), "mất ghi chú dòng trả").toHaveValue("móp")
    await page.getByRole("combobox", { name: "Lý do trả dòng 1" }).click()
    await page.getByRole("option", { name: "Hết hạn sử dụng" }).click()
    await page.getByLabel("Ghi chú dòng trả 1", { exact: true }).fill("móp, hết hạn")
    const moIn = page.context().waitForEvent("page")
    await page.getByRole("button", { name: /Huỷ HĐ & lập lại/ }).click()
    await (await moIn).close()
    await expect.poll(async () => !!(await goiCuoi("reissue_invoice"))).toBe(true)
    const p = ((await goiCuoi("reissue_invoice"))!.body as { p: { return_edits?: unknown[] } }).p
    expect(p.return_edits).toEqual([{ line_id: "rl-bd1", quantity: 2, note: "móp, hết hạn", reason: "expired" }])
  } finally {
    await xoa("returns", "id", "r-bd")
    await xoa("sales_order_lines", "id", "sol9")
    await xoa("sales_orders", "id", DON_HD)
  }
})

test("POS trả hàng: mở lại phiếu giữ lý do dòng, thuế dòng và kho nhận khi lưu", async ({ page }) => {
  await chen("returns", [{
    id: "r-mo", org_id: ORG, customer_id: KHACH, status: "draft", reason: "damaged", notes: null,
    requested_by: OWNER, sales_user_id: OWNER, destination_zone: "sale", invoice_id: null,
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111" },
    lines: [{ id: "rl-mo1", product_id: SUA, unit_name: "hộp", quantity: 3, unit_price: 20000, vat_rate: 0.1,
      is_exchange: false, note: "móp", reason: "expired", product: { name: "Sữa hộp", sku: "SUA1" } }],
  }])
  try {
    await dangNhap(page)
    await page.goto("/pos/tra-hang/r-mo")
    await expect(page.getByTestId("dong-tra")).toHaveCount(1)
    await expect(page.getByRole("combobox", { name: "Lý do trả dòng 1" }), "mất lý do dòng").toContainText("Hết hạn sử dụng")
    await expect(page.locator("#pos-kho"), "mất kho nhận đã chọn").toHaveValue("sale")
    await page.getByRole("button", { name: "Lưu nháp" }).click()
    await expect.poll(async () =>
      (await nhatKy()).some((r) => r.method === "POST" && r.path.endsWith("/rest/v1/return_lines"))
    ).toBe(true)
    const chenDong = (await nhatKy()).filter((r) => r.method === "POST" && r.path.endsWith("/rest/v1/return_lines")).at(-1)!
    const rows = (Array.isArray(chenDong.body) ? chenDong.body : [chenDong.body]) as Array<Record<string, unknown>>
    expect(rows[0], "lưu lại xoá mất trường của dòng trả").toMatchObject({ reason: "expired", note: "móp", vat_rate: 0.1, quantity: 3 })
  } finally {
    await xoa("return_lines", "return_id", "r-mo")
    await xoa("returns", "id", "r-mo")
  }
})
