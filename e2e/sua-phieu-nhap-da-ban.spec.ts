import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { SUA, NCC } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 06/10/2026: "Hiện tại những phiếu nhập hàng từ NCC đã bán hàng ra không sửa được, tao muốn sửa được".
 *   Phiếu nhập ĐÃ HOÀN THÀNH sửa TẠI CHỖ qua RPC `sua_phieu_nhap` (mig 235) — không còn huỷ-rồi-lập-lại (bị chặn khi
 *   hàng đã bán / đã trả tiền). Luật kho / giá vốn / công nợ: scripts/sql/thu-235-sua-phieu-nhap-da-ban.sql (13/13).
 */
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const DONG = {
  id: "pil-pi1-e2e", invoice_id: "pi1", product_id: SUA, unit_name: "thùng", quantity: 2, unit_price: 150000, line_discount: 0,
  vat_rate: 0, conversion_factor: 24, notes: null, sort_order: 1,
}

test.beforeEach(async () => {
  /* Backend giả: dòng nhúng (`lines:purchase_invoice_lines(...)`) đọc từ mảng nằm sẵn trên phiếu. */
  await api("purchase_invoices?id=eq.pi1", "PATCH", {
    supplier_id: NCC, status: "completed", discount: 0, vat_override: null, notes: null, invoice_number: "HD1",
    lines: [{ ...DONG, product: { name: "Sữa hộp", sku: "SUA1" } }],
  })
  await api("purchase_invoice_lines?invoice_id=eq.pi1", "DELETE")
  await api("purchase_invoice_lines", "POST", [DONG])
})
test.afterAll(async () => {
  await api("purchase_invoice_lines?invoice_id=eq.pi1", "DELETE")
  await api("purchase_invoices?id=eq.pi1", "PATCH", { supplier_id: null, total: 300000, lines: null })
})

/* ⚠ Lọc theo phiếu của spec này — nhật ký là CHUNG, spec khác chạy song song cũng gọi cùng RPC. */
const goiRpc = async (fn: string) =>
  (await nhatKy()).filter(
    (r) => r.method === "POST" && r.path.endsWith(`/rpc/${fn}`) &&
      (fn !== "sua_phieu_nhap" || (r.body as { p_invoice_id?: string } | null)?.p_invoice_id === "pi1")
  )

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("sửa giá phiếu nhập đã hoàn thành: Lưu sửa gọi sua_phieu_nhap, không huỷ phiếu", async ({ page }) => {
    const truoc = (await goiRpc("cancel_purchase_invoice")).length
    await dangNhap(page)
    await page.goto("/purchasing/receipts/pi1/edit")
    await expect(page.getByTestId("buoc-phieu")).toBeVisible()
    await expect(page.getByTestId("dong-phieu-ncc")).toContainText("150.000đ / thùng")
    await page.getByTestId("dong-phieu-ncc").getByRole("button", { name: /^Sữa hộp/ }).first().click()
    await page.locator("#sua-dong-gia").fill("160000")
    await page.getByRole("button", { name: "Xong" }).click()
    await page.getByRole("button", { name: "Lưu sửa" }).click()
    await expect(page).toHaveURL(/\/purchasing\/receipts\/pi1$/)
    const goi = (await goiRpc("sua_phieu_nhap")).at(-1)
    const body = goi?.body as { p_invoice_id: string; p_head: Record<string, unknown>; p_lines: Array<Record<string, unknown>> }
    expect(body.p_invoice_id).toBe("pi1")
    expect(body.p_head).toMatchObject({ supplier_id: NCC, invoice_number: "HD1", warehouse_zone: "sale" })
    expect(body.p_lines).toEqual([expect.objectContaining({ product_id: SUA, unit_name: "thùng", quantity: 2, unit_price: 160000, conversion_factor: 24 })])
    expect((await goiRpc("cancel_purchase_invoice")).length).toBe(truoc)
  })

  test("máy chủ chặn (đã bán nhiều hơn số sửa) thì báo rõ, ở lại màn sửa", async ({ page }) => {
    await dangNhap(page)
    await page.route("**/rest/v1/rpc/sua_phieu_nhap", (r) =>
      r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "DA_XUAT_NHIEU_HON: Hàng của phiếu đã xuất nhiều hơn số lượng sửa — Sữa hộp: đã xuất 30 hộp, số lượng mới chỉ 24." }) })
    )
    await page.goto("/purchasing/receipts/pi1/edit")
    await page.getByRole("button", { name: "Lưu sửa" }).click()
    await expect(page.getByText(/đã xuất 30 hộp, số lượng mới chỉ 24/).first()).toBeVisible()
    await expect(page).toHaveURL(/\/purchasing\/receipts\/pi1\/edit$/)
  })
})

test("POS máy tính: phiếu đã hoàn thành có nút Lưu sửa, lưu gọi sua_phieu_nhap", async ({ page }) => {
  const truoc = (await goiRpc("cancel_purchase_invoice")).length
  const daGoi = (await goiRpc("sua_phieu_nhap")).length
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/pi1/sua")
  const gia = page.getByLabel("Giá nhập dòng 1")
  await expect(gia).toHaveValue("150.000")
  await expect(page.getByText(/Lưu là sửa luôn kho và công nợ NCC/)).toBeVisible()
  await gia.fill("")
  await gia.pressSequentially("155000", { delay: 30 })
  await page.getByRole("button", { name: "Lưu sửa" }).click()
  // Chờ lần gọi MỚI — nhật ký chung còn lần gọi của test trước.
  await expect.poll(async () => (await goiRpc("sua_phieu_nhap")).length).toBeGreaterThan(daGoi)
  const body = (await goiRpc("sua_phieu_nhap")).at(-1)?.body as { p_lines: Array<Record<string, unknown>> }
  expect(body.p_lines[0]).toMatchObject({ unit_name: "thùng", unit_price: 155000, quantity: 2 })
  expect((await goiRpc("cancel_purchase_invoice")).length).toBe(truoc)
})
