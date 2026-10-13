import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { SUA, NCC } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 13/10/2026: "Xem lại phiếu trả NCC. Sao sửa phiếu nháp -> ra màn post lại hiện trạng thái đã xuất kho và
 *   ko có nút lưu nháp tiếp (chỉ có nút ghi nhận và xuất kho)".
 *   Nút "Sửa" (phiếu nháp) và "Sửa phiếu" (đã ghi nhận) cùng đi `/…/edit` → màn POS `/…/<id>/sua`; màn từng coi mọi phiếu
 *   ở đường ấy là đã ghi nhận. Nay nhãn / nút theo trạng thái thật — phiếu nhập nháp dính cùng lỗi (không có Lưu tạm).
 *   Dòng dữ liệu RIÊNG của spec này.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
type Db = {
  supplier_returns: Array<{ id: string; status: string }>
  supplier_return_lines?: Array<{ return_id: string; unit_price: number }>
  purchase_invoices: Array<{ id: string; status: string }>
  purchase_invoice_lines?: Array<{ invoice_id: string; unit_price: number }>
}
const docDb = async (): Promise<Db> => (await fetch(`${FAKE}/__db`)).json()
/* ⚠ Nhật ký CHUNG cả lượt chạy — chỉ đếm lời gọi về phiếu của spec này. */
const goiVe = async (fn: string, id: string) =>
  (await nhatKy()).filter((r) => r.method === "POST" && r.path.endsWith(`/rpc/${fn}`) && JSON.stringify(r.body ?? {}).includes(id))

const NCC_JOIN = { name: "Vinamilk", code: "NCC1" }
const dongTra = { product_id: SUA, unit_name: "hộp", quantity: 5, unit_price: 20000, line_discount: 0, conversion_factor: 1, notes: null, product: { name: "Sữa hộp", sku: "SUA1" } }
const phieuTra = (id: string, status: string, code: string) => ({
  id, org_id: ORG, supplier_id: NCC, return_code: code, return_date: "2026-10-12", warehouse_zone: "sale", reason: "damaged",
  status, discount: 0, vat: 0, vat_override: null, notes: null, subtotal: 100000, total: 100000,
  created_at: "2026-10-12T02:00:00Z", supplier: NCC_JOIN, lines: [dongTra],
})
const dongNhap = { id: "pil-sua-nhap", product_id: SUA, unit_name: "thùng", quantity: 2, unit_price: 150000, line_discount: 0, vat_rate: 0, conversion_factor: 24, notes: null, sort_order: 1, product: { name: "Sữa hộp", sku: "SUA1" } }
const phieuNhap = (id: string, status: string, code: string) => ({
  id, org_id: ORG, receipt_code: code, invoice_number: null, invoice_date: "2026-10-12", status, supplier_id: NCC,
  warehouse_zone: "sale", discount: 0, vat: 0, vat_override: null, total: 300000, notes: null,
  created_at: "2026-10-12T02:00:00Z", supplier: NCC_JOIN, lines: [dongNhap],
})

test.beforeAll(async () => {
  await api("supplier_returns", "POST", [
    phieuTra("sr-sua-nhap", "draft", "PTNCC-0901"),
    phieuTra("sr-sua-xong", "completed", "PTNCC-0902"),
    phieuTra("sr-sua-huy", "cancelled", "PTNCC-0903"),
  ])
  await api("purchase_invoices", "POST", [phieuNhap("pi-sua-nhap", "draft", "PN-0901"), phieuNhap("pi-sua-xong", "completed", "PN-0902")])
})
test.afterAll(async () => {
  for (const id of ["sr-sua-nhap", "sr-sua-xong", "sr-sua-huy"]) {
    await api(`supplier_returns?id=eq.${id}`, "DELETE")
    await api(`supplier_return_lines?return_id=eq.${id}`, "DELETE")
  }
  for (const id of ["pi-sua-nhap", "pi-sua-xong"]) {
    await api(`purchase_invoices?id=eq.${id}`, "DELETE")
    await api(`purchase_invoice_lines?invoice_id=eq.${id}`, "DELETE")
  }
})

const nhan = (page: Page, chu: string) => page.getByText(chu, { exact: true }).first()

test("phiếu trả NCC NHÁP: bấm Sửa ở chi tiết → màn POS nhãn NHÁP, có Lưu nháp; lưu xong vẫn là nháp, không xuất kho", async ({ page: web }) => {
  await dangNhap(web)
  await web.goto("/purchase-returns/sr-sua-nhap")
  // Máy tính: lối vào POS mở ở TAB MỚI (`PosNewTab`) — đúng đường chủ nhà bấm.
  const [page] = await Promise.all([
    web.context().waitForEvent("page"),
    web.getByRole("link", { name: "Sửa", exact: true }).click(),
  ])
  await expect(page).toHaveURL(/\/pos\/tra-ncc\/sr-sua-nhap\/sua$/)
  await expect(page.getByLabel("Giá nhập dòng 1")).toHaveValue("20.000")
  await expect(nhan(page, "NHÁP")).toBeVisible()
  await expect(nhan(page, "ĐÃ XUẤT KHO")).toHaveCount(0)
  await expect(page.getByText(/Phiếu đã xuất kho/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Ghi nhận & xuất kho" })).toBeEnabled()

  const daXuat = (await goiVe("complete_supplier_return", "sr-sua-nhap")).length
  await page.getByLabel("Giá nhập dòng 1").fill("25000")
  await page.getByRole("button", { name: "Lưu nháp" }).click()
  await expect(page.getByText("Đã lưu phiếu nháp").first()).toBeVisible()
  const db = await docDb()
  expect(db.supplier_returns.find((r) => r.id === "sr-sua-nhap")?.status).toBe("draft")
  expect((db.supplier_return_lines ?? []).filter((l) => l.return_id === "sr-sua-nhap").map((l) => l.unit_price)).toEqual([25000])
  expect((await goiVe("complete_supplier_return", "sr-sua-nhap")).length, "lưu nháp không xuất kho").toBe(daXuat)
  expect((await goiVe("cancel_supplier_return", "sr-sua-nhap")).length, "nháp thì không huỷ gì").toBe(0)
  await expect(nhan(page, "NHÁP")).toBeVisible()

  // Ghi nhận ngay trên màn → phiếu đã xuất: nhãn đổi, HẾT nút Lưu nháp (bấm nó lúc này là rút hàng về kho).
  await page.getByRole("button", { name: "Ghi nhận & xuất kho" }).click()
  await expect(page.getByText("Đã ghi nhận — xuất kho và giảm công nợ NCC").first()).toBeVisible()
  expect((await goiVe("complete_supplier_return", "sr-sua-nhap")).length).toBe(daXuat + 1)
  await expect(nhan(page, "ĐÃ XUẤT KHO")).toBeVisible()
  await expect(page.getByRole("button", { name: "Lưu nháp" })).toHaveCount(0)
})

test("phiếu trả NCC ĐÃ XUẤT: nhãn ĐÃ XUẤT KHO, nói giữ nguyên số phiếu, KHÔNG có Lưu nháp (lưu nháp = rút hàng về kho)", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-ncc/sr-sua-xong/sua")
  await expect(page.getByLabel("Giá nhập dòng 1")).toHaveValue("20.000")
  await expect(nhan(page, "ĐÃ XUẤT KHO")).toBeVisible()
  await expect(page.getByText(/giữ nguyên số phiếu/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Lưu nháp" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Huỷ", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Ghi nhận & xuất kho" })).toBeEnabled()
})

test("phiếu trả NCC ĐÃ HUỶ: nhãn ĐÃ HUỶ, nhắc khôi phục trước, không lưu được", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-ncc/sr-sua-huy/sua")
  await expect(nhan(page, "ĐÃ HUỶ")).toBeVisible()
  await expect(page.getByText(/Phiếu đã huỷ — muốn sửa thì bấm/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Ghi nhận & xuất kho" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Lưu nháp" })).toHaveCount(0)
})

test("phiếu nhập NHÁP mở bằng Sửa: nhãn NHÁP, có Lưu tạm; lưu xong vẫn nháp — không nhập kho, không sửa-tại-chỗ", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/pi-sua-nhap/sua")
  await expect(page.getByLabel("Giá nhập dòng 1")).toHaveValue("150.000")
  await expect(nhan(page, "NHÁP")).toBeVisible()
  await expect(page.getByRole("button", { name: "Hoàn thành & nhập kho" })).toBeEnabled()
  await page.getByLabel("Giá nhập dòng 1").fill("160000")
  await page.getByRole("button", { name: "Lưu tạm" }).click()
  await expect(page.getByText("Đã lưu phiếu tạm").first()).toBeVisible()
  const db = await docDb()
  expect(db.purchase_invoices.find((r) => r.id === "pi-sua-nhap")?.status).toBe("draft")
  expect((db.purchase_invoice_lines ?? []).filter((l) => l.invoice_id === "pi-sua-nhap").map((l) => l.unit_price)).toEqual([160000])
  expect((await goiVe("complete_purchase_invoice", "pi-sua-nhap")).length).toBe(0)
  expect((await goiVe("sua_phieu_nhap", "pi-sua-nhap")).length).toBe(0)

  // Hoàn thành ngay trên màn → nhãn ĐÃ NHẬP KHO, nút chính thành Lưu sửa, hết Lưu tạm.
  await page.getByRole("button", { name: "Hoàn thành & nhập kho" }).click()
  await expect(page.getByText("Đã hoàn thành — nhập kho và ghi công nợ NCC").first()).toBeVisible()
  expect((await goiVe("complete_purchase_invoice", "pi-sua-nhap")).length).toBe(1)
  await expect(nhan(page, "ĐÃ NHẬP KHO")).toBeVisible()
  await expect(page.getByRole("button", { name: "Lưu sửa" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Lưu tạm" })).toHaveCount(0)
})

test("phiếu nhập ĐÃ HOÀN THÀNH: nhãn ĐÃ NHẬP KHO, nút Lưu sửa, không có Lưu tạm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/pi-sua-xong/sua")
  await expect(page.getByLabel("Giá nhập dòng 1")).toHaveValue("150.000")
  await expect(nhan(page, "ĐÃ NHẬP KHO")).toBeVisible()
  await expect(page.getByRole("button", { name: "Lưu sửa" })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Lưu tạm" })).toHaveCount(0)
})
