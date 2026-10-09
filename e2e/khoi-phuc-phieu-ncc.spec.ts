import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 09/10/2026: "Phiếu nhập hàng, phiếu trả NCC hủy xong phải có đường khôi phục" (mig 241).
 *   Phiếu Đã huỷ có nút Khôi phục (vai ghi mua hàng) → hỏi lại → RPC `khoi_phuc_phieu_nhap` / `khoi_phuc_phieu_tra_ncc`
 *   → phiếu về đúng trạng thái trước khi huỷ. Phiếu trả gửi lại không được (kho thiếu) → dừng ở Nháp, báo lý do.
 *   Luật kho / công nợ chạy thật: scripts/sql/thu-241-khoi-phuc-phieu-ncc.sql. Dữ liệu RIÊNG của spec này.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const NCC = "00000000-0000-4000-8000-0000000000e1"
const SP = "00000000-0000-4000-8000-0000000000d1"
const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

const NHAP = {
  id: "pi-khoi-phuc", org_id: ORG, supplier_id: NCC, receipt_code: "PN-KP1", invoice_number: "HD-KP1", invoice_date: "2026-09-25",
  status: "cancelled", warehouse_zone: "sale", subtotal: 480000, vat: 0, discount: 0, total: 480000, notes: null,
  cancel_reason: "Người dùng huỷ từ màn chi tiết", completed_at: "2026-09-25T03:00:00Z", stock_entry_id: "se-kp1", payable_id: null,
  created_at: "2026-09-25T02:00:00Z", supplier: { name: "Vinamilk", code: "NCC1" },
}
const DONG_NHAP = {
  id: "pil-khoi-phuc", invoice_id: NHAP.id, product_id: SP, unit_name: "thùng", quantity: 2, unit_price: 240000, line_discount: 0,
  vat_rate: 0, conversion_factor: 24, line_total: 480000, notes: null, sort_order: 1, product: { name: "Sữa hộp", sku: "SUA1", base_unit: "hộp" },
}
const tra = (id: string, ma: string, them_: Record<string, unknown> = {}) => ({
  id, org_id: ORG, supplier_id: NCC, return_code: ma, return_date: "2026-09-26", warehouse_zone: "sale", status: "cancelled",
  reason: "damaged", notes: null, subtotal: 30000, vat: 0, discount: 0, total: 30000, stock_entry_id: `se-${id}`,
  payable_credit_id: null, completed_at: "2026-09-26T03:00:00Z", cancel_reason: "Người dùng huỷ từ màn chi tiết",
  created_by: OWNER, created_at: "2026-09-26T02:00:00Z", supplier: { id: NCC, name: "Vinamilk", code: "NCC1" }, ...them_,
})
const TRA = tra("sr-khoi-phuc", "PTNCC-0091")
const TRA_THIEU = tra("sr-khoi-phuc-thieu", "PTNCC-0092", {
  e2e_ly_do: "INSUFFICIENT_STOCK | Sữa hộp (hộp): cần 6, kho hàng bán còn 2, kho hàng date còn 0",
})

test.beforeAll(async () => {
  await them("purchase_invoices", [NHAP])
  await them("purchase_invoice_lines", [DONG_NHAP])
  await them("supplier_returns", [TRA, TRA_THIEU])
})
test.afterAll(async () => {
  await xoa("purchase_invoice_lines", "invoice_id", NHAP.id)
  await xoa("purchase_invoices", "id", NHAP.id)
  await xoa("supplier_returns", "id", TRA.id)
  await xoa("supplier_returns", "id", TRA_THIEU.id)
})

const goiRpc = async (fn: string, id: string) =>
  (await nhatKy()).filter((r) => r.method === "POST" && r.path.endsWith(`/rpc/${fn}`) &&
    Object.values((r.body as Record<string, unknown> | null) ?? {}).includes(id))

test("phiếu nhập Đã huỷ: Khôi phục → hỏi lại → về Hoàn thành, nút Huỷ phiếu quay lại", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/purchasing/receipts/${NHAP.id}`)
  await expect(page.getByText("Phiếu đã huỷ.")).toBeVisible()
  await expect(page.getByText("Huỷ nhầm thì bấm Khôi phục")).toBeVisible()
  await expect(page.getByRole("button", { name: "Huỷ phiếu" })).toHaveCount(0)

  await page.getByRole("button", { name: "Khôi phục" }).click()
  const hoi = page.getByRole("dialog")
  await expect(hoi).toContainText("Khôi phục phiếu nhập hàng?")
  await expect(hoi).toContainText("nhập lại kho vào đúng các lô cũ")
  await hoi.getByRole("button", { name: "Khôi phục" }).click()

  await expect(page.getByText("Đã khôi phục — phiếu Hoàn thành, kho và công nợ NCC đã ghi lại").first()).toBeVisible()
  expect((await goiRpc("khoi_phuc_phieu_nhap", NHAP.id)).at(-1)?.body).toEqual({ p_invoice_id: NHAP.id })
  await expect(page.getByText("Hoàn thành", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Phiếu đã huỷ.")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Khôi phục" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Huỷ phiếu" })).toBeVisible()
})

test("phiếu trả NCC Đã huỷ (đã gửi): Khôi phục → gửi lại, về Đã gửi", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/purchase-returns/${TRA.id}`)
  await expect(page.getByText("Phiếu đã huỷ.")).toBeVisible()
  await page.getByRole("button", { name: "Khôi phục" }).click()
  const hoi = page.getByRole("dialog")
  await expect(hoi).toContainText("Khôi phục phiếu trả NCC?")
  await expect(hoi).toContainText("xuất kho theo FIFO từ tồn hiện tại")
  await hoi.getByRole("button", { name: "Khôi phục" }).click()

  await expect(page.getByText("Đã khôi phục — phiếu đã gửi lại: xuất kho và giảm công nợ NCC").first()).toBeVisible()
  expect((await goiRpc("khoi_phuc_phieu_tra_ncc", TRA.id)).at(-1)?.body).toEqual({ p_return_id: TRA.id })
  await expect(page.getByText("Đã gửi", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Khôi phục" })).toHaveCount(0)
})

test("phiếu trả NCC: kho không đủ để gửi lại → về Nháp, báo rõ thiếu hàng nào", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/purchase-returns/${TRA_THIEU.id}`)
  await page.getByRole("button", { name: "Khôi phục" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Khôi phục" }).click()

  await expect(page.getByText("Đã khôi phục về Nháp — chưa gửi lại được").first()).toBeVisible()
  await expect(page.getByText("Không đủ tồn để xuất — Sữa hộp (hộp): cần 6, kho hàng bán còn 2").first()).toBeVisible()
  await expect(page.getByText("Nháp", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Gửi phiếu" })).toBeVisible()
})
