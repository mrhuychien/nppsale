import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026: "khi sửa hoá đơn có phiếu nhập kho đã hoàn thành -> hệ thống
 *   sẽ hỏi 'Cần huỷ phiếu nhập trước?' y/n -> yes -> huỷ phiếu nhập, trên hoá đơn sửa
 *   được tất cả thông tin, khi cập nhật -> cập nhật lại hết" · "No -> giữ nguyên phiếu
 *   nhập gắn vào hoá đơn mới." (mig 210 — khoá `tra_da_nhap` của `reissue_invoice`).
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
/* Đơn gốc của HD-E2E-1 (máy chủ giả) — chèn riêng như pos-hoa-don.spec. */
const DON_HD = "00000000-0000-4000-8000-0000000000f9"
const chen = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const goiCuoi = async (fn: string) => (await nhatKy()).filter((r) => r.path.endsWith(`/rpc/${fn}`)).at(-1)
const soLuongTra = (page: Page) => page.getByRole("button", { name: /^số lượng trả dòng 1 — đang là/ })

test.beforeEach(async () => {
  await chen("sales_orders", [{
    id: DON_HD, org_id: "00000000-0000-4000-8000-0000000000a1", order_code: "DH-0009",
    customer_id: "00000000-0000-4000-8000-0000000000c1", sales_user_id: "00000000-0000-4000-8000-0000000000b1",
    status: "completed", payment_terms: "COD", notes: null,
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" },
  }])
  await chen("returns", [{
    id: "r-da-nhap", org_id: "khong-hien-trong-danh-sach", order_id: DON_HD, invoice_id: HOA_DON,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "completed", credit_with_invoice: true,
    return_code: "TH-0099", destination_zone: "date", credit_note_amount: 40000,
    lines: [
      { id: "rl-da-nhap", product_id: "00000000-0000-4000-8000-0000000000d1", unit_name: "hộp", quantity: 2, unit_price: 20000, vat_rate: 0, is_exchange: false, product: { name: "Sữa hộp", sku: "SUA1" } },
    ],
  }])
})
test.afterEach(async () => {
  await fetch(`${FAKE}/rest/v1/returns?id=eq.r-da-nhap`, { method: "DELETE" })
  await fetch(`${FAKE}/rest/v1/sales_orders?id=eq.${DON_HD}`, { method: "DELETE" })
})

test("sửa HĐ có phiếu trả đã nhập kho: hỏi ngay; Không → giữ phiếu nhập, dòng trả chỉ xem", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/pos/hoa-don/${HOA_DON}/sua`)
  const hoi = page.getByTestId("hoi-tra-da-nhap")
  await expect(hoi.getByRole("heading", { name: "Cần huỷ phiếu nhập trước?" })).toBeVisible()
  await expect(hoi).toContainText("TH-0099")
  await hoi.getByRole("button", { name: "Không" }).click()
  await expect(hoi).toBeHidden()
  await expect(page.getByTestId("dai-tra-da-nhap")).toContainText("giữ nguyên phiếu nhập")
  await expect(page.getByTestId("dong-tra-cu")).toContainText("chỉ xem")
  await expect(soLuongTra(page)).toHaveCount(0)

  await page.getByRole("button", { name: /Huỷ HĐ & lập lại/ }).click()
  await expect.poll(async () => !!(await goiCuoi("reissue_invoice"))).toBe(true)
  const p = ((await goiCuoi("reissue_invoice"))!.body as { p: Record<string, unknown> }).p
  expect(p.tra_da_nhap).toBe("giu")
  expect(p.return_edits, "Không mà vẫn gửi sửa dòng trả").toBeUndefined()
})

test("sửa HĐ có phiếu trả đã nhập kho: Có → sửa được hàng trả, gửi lam_lai kèm phần sửa; đóng hộp thì bấm lưu hỏi lại", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/pos/hoa-don/${HOA_DON}/sua`)
  const hoi = page.getByTestId("hoi-tra-da-nhap")
  await expect(hoi).toBeVisible()
  // Đóng hộp không chọn → bấm lưu thì hỏi lại, chưa gửi gì.
  await page.keyboard.press("Escape")
  await expect(hoi).toBeHidden()
  const truoc = (await nhatKy()).filter((r) => r.path.endsWith("/rpc/reissue_invoice")).length
  await page.getByRole("button", { name: /Huỷ HĐ & lập lại/ }).click()
  await expect(hoi).toBeVisible()
  expect((await nhatKy()).filter((r) => r.path.endsWith("/rpc/reissue_invoice")).length, "chưa chọn mà đã lập lại").toBe(truoc)

  await hoi.getByRole("button", { name: /Có, huỷ phiếu nhập/ }).click()
  await expect(page.getByTestId("dai-tra-da-nhap")).toContainText("phiếu về Chờ xử lý")
  await soLuongTra(page).click()
  await page.getByLabel("số lượng trả dòng 1", { exact: true }).fill("1")
  await page.getByLabel("số lượng trả dòng 1", { exact: true }).press("Enter")
  await expect(page.getByTestId("khoi-hang-tra")).toContainText("trừ 20.000")

  await page.getByRole("button", { name: /Huỷ HĐ & lập lại/ }).click()
  await expect.poll(async () => ((await goiCuoi("reissue_invoice"))?.body as { p?: { tra_da_nhap?: string } } | undefined)?.p?.tra_da_nhap).toBe("lam_lai")
  const p = ((await goiCuoi("reissue_invoice"))!.body as { p: Record<string, unknown> }).p
  expect(p.return_edits).toEqual([{ line_id: "rl-da-nhap", quantity: 1 }])
})
