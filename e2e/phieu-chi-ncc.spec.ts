import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { NCC, ORG, OWNER } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 09/10/2026: "phiếu chi thêm phần chi cho ncc và chọn NCC là xong, phiếu chi xuất hiện xong giao dịch NCC là
 *   xong, ko nhất thiết phiếu chi phải chi trả đúng hóa đơn nào đó, có thể chi trả ncc 1 cục 200 triệu, nhiều hóa đơn
 *   nợ" (mig 242).
 * Vinamilk: nợ đầu kỳ 50.000 (01/09) + phiếu nhập PN-PC1 300.000 (10/09) → còn phải trả 350.000. Chi 400.000 → máy chủ
 *   trừ đầu kỳ trước rồi PN-PC1, dư 50.000 thành tiền trả trước. Luật thật (khoá, trigger, huỷ phiếu nhập) chạy ở
 *   scripts/sql/thu-242-phieu-chi-tra-ncc.sql; máy giả (fixture.mjs) chỉ đủ cho màn hình thấy kết quả.
 */
test.use({ viewport: { width: 1280, height: 900 } })
test.describe.configure({ mode: "serial" })

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, "PATCH", { role })

const NCC_EMB = { name: "Vinamilk", code: "NCC1" }
const NO_DK = {
  id: "pay-pc-dk", org_id: ORG, supplier_id: NCC, invoice_number: null, amount: 50000, paid: 0, status: "open", opening_balance: true,
  due_date: null, notes: "Nợ đầu kỳ", created_at: "2026-09-01T03:00:00Z", supplier: NCC_EMB,
}
const NO_PN = {
  id: "pay-pc-pn", org_id: ORG, supplier_id: NCC, invoice_number: "HD-PC1", amount: 300000, paid: 0, status: "open", opening_balance: false,
  due_date: null, notes: null, created_at: "2026-09-10T03:00:00Z", supplier: NCC_EMB,
}
const PN = {
  id: "pi-pc1", org_id: ORG, supplier_id: NCC, receipt_code: "PN-PC1", invoice_number: "HD-PC1", invoice_date: "2026-09-10", status: "completed",
  warehouse_zone: "sale", subtotal: 300000, vat: 0, discount: 0, total: 300000, payable_id: NO_PN.id, completed_at: "2026-09-10T03:00:00Z",
  created_at: "2026-09-10T02:00:00Z", supplier: NCC_EMB,
}

test.beforeAll(async () => {
  await api("payables", "POST", [NO_DK, NO_PN])
  await api("purchase_invoices", "POST", [PN])
})
test.afterEach(async () => {
  await doiVai("owner")
})
test.afterAll(async () => {
  await api(`purchase_invoices?id=eq.${PN.id}`, "DELETE")
  await api(`payables?id=in.(${NO_DK.id},${NO_PN.id})`, "DELETE")
  await api(`payables?supplier_id=eq.${NCC}&invoice_number=like.PCNCC-*`, "DELETE")
  await api("payable_payments?supplier_payment_id=not.is.null", "DELETE")
  await api(`supplier_payments?org_id=eq.${ORG}`, "DELETE")
})

const goiRpc = async (fn: string) =>
  (await nhatKy()).filter((r) => r.method === "POST" && r.path.endsWith(`/rpc/${fn}`)).map((r) => r.body)

const chonNcc = async (page: Page, hop: ReturnType<Page["getByRole"]>) => {
  const o = hop.locator("#pc-ncc")
  await o.click()
  await o.fill("vina")
  await page.getByTestId("search-select-xo").filter({ visible: true }).getByRole("button", { name: /Vinamilk/ }).click()
}

test("màn Chi phí: Lập phiếu chi → Trả NCC → chọn NCC là xong; tiền tự trừ nợ cũ nhất, dư thành trả trước; xem, huỷ", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/finance/expenses")
  await page.getByRole("button", { name: "Lập phiếu chi" }).filter({ visible: true }).first().click()

  const hop = page.getByRole("dialog")
  await expect(hop.getByRole("tablist", { name: "Loại phiếu chi" })).toBeVisible()
  await hop.getByRole("tab", { name: "Trả NCC" }).click()
  await expect(hop.getByRole("tab", { name: "Trả NCC" })).toHaveAttribute("aria-selected", "true")
  await expect(hop.getByText("Không cần chọn hoá đơn")).toBeVisible()

  // Chưa chọn NCC → chặn ngay, không gọi máy chủ.
  await hop.getByRole("button", { name: "Lưu phiếu chi" }).click()
  await expect(page.getByText("Chọn nhà cung cấp").first()).toBeVisible()
  expect(await goiRpc("chi_tra_ncc")).toHaveLength(0)

  await chonNcc(page, hop)
  await expect(hop.getByTestId("pc-no-ncc")).toContainText("Còn phải trả NCC: 350.000đ")
  await hop.locator("#pc-tien").fill("400000")
  await expect(hop.locator("#pc-tien")).toHaveValue("400.000")
  await expect(hop.locator("#pc-ngay")).toHaveValue("2026-09-30")
  await hop.getByRole("combobox", { name: "Hình thức chi" }).click()
  await page.getByRole("option", { name: "Chuyển khoản" }).click()
  await hop.locator("#pc-tham-chieu").fill("UNC 15")
  await hop.locator("#pc-ghi-chu").fill("trả đợt 1")
  await hop.getByRole("button", { name: "Lưu phiếu chi" }).click()

  await expect(page.getByText("Đã lập phiếu chi PCNCC-0001 — 400.000đ").first()).toBeVisible()
  await expect(page.getByText("đã trừ 350.000đ vào 2 khoản nợ cũ nhất; 50.000đ là tiền trả trước (tự trừ vào phiếu nhập sau).").first()).toBeVisible()
  expect((await goiRpc("chi_tra_ncc")).at(-1)).toEqual({
    p_supplier_id: NCC, p_amount: 400000, p_paid_date: "2026-09-30", p_method: "transfer", p_notes: "trả đợt 1", p_reference: "UNC 15",
  })
  await expect(hop).toHaveCount(0)

  // Danh sách phiếu chi: dòng "Trả NCC" — không nút xoá; tổng chi cộng cả phiếu.
  const dong = page.getByRole("row").filter({ hasText: "Trả nhà cung cấp" })
  await expect(dong).toHaveCount(1)
  await expect(dong).toContainText("Trả NCC")
  await expect(dong).toContainText("Vinamilk — trả đợt 1")
  await expect(dong).toContainText("400.000")
  await expect(dong.getByRole("button", { name: "Xoá chi phí" })).toHaveCount(0)

  await dong.click()
  const xem = page.getByRole("dialog")
  await expect(xem).toContainText("Phiếu chi PCNCC-0001")
  await expect(xem.getByRole("link", { name: "Vinamilk →" })).toHaveAttribute("href", `/suppliers/${NCC}?tab=debt`)
  await expect(xem.getByRole("button", { name: "Huỷ phiếu chi" })).toBeVisible()
  const href = await xem.getByRole("link", { name: "Chi tiết" }).getAttribute("href")
  expect(href).toMatch(/^\/finance\/phieu-chi-ncc\/[0-9a-f-]+$/)

  // Trang chi tiết: đã trừ vào khoản nào (đầu kỳ trước), phần trả trước còn lại.
  await page.goto(href!)
  await expect(page.getByRole("main").getByRole("heading", { name: "Phiếu chi PCNCC-0001" })).toBeVisible()
  await expect(page.getByText("Đã chi", { exact: true }).first()).toBeVisible()
  const bang = page.getByTestId("pc-da-tru")
  await expect(bang.locator("tbody tr")).toHaveText([/Nợ đầu kỳ\s*50\.000đ/, /PN-PC1\s*300\.000đ/])
  await expect(bang.getByRole("link", { name: "PN-PC1" })).toHaveAttribute("href", `/purchasing/receipts/${PN.id}`)
  await expect(page.getByText("Còn là tiền trả trước")).toBeVisible()

  await page.getByRole("button", { name: "Huỷ phiếu chi" }).click()
  const hoi = page.getByRole("alertdialog").or(page.getByRole("dialog")).first()
  await expect(hoi).toContainText("Huỷ phiếu chi PCNCC-0001?")
  await hoi.locator("#ly-do-huy").fill("chi nhầm")
  await hoi.getByRole("button", { name: "Huỷ phiếu chi" }).click()

  await expect(page.getByText("Đã huỷ phiếu chi PCNCC-0001").first()).toBeVisible()
  expect((await goiRpc("huy_phieu_chi_ncc")).at(-1)).toEqual({ p_id: href!.split("/").pop(), p_reason: "chi nhầm" })
  await expect(page.getByText("Phiếu đã huỷ")).toBeVisible()
  await expect(page.getByText("chi nhầm")).toBeVisible()
  await expect(page.getByRole("button", { name: "Huỷ phiếu chi" })).toHaveCount(0)
  await expect(page.getByTestId("pc-da-tru")).toHaveCount(0)

  // Phiếu đã huỷ không còn trong danh sách phiếu chi.
  await page.goto("/finance/expenses")
  await expect(page.getByRole("row").filter({ hasText: "Trả nhà cung cấp" })).toHaveCount(0)
})

test("chi tiết NCC: nút Chi trả NCC (NCC chọn sẵn) → phiếu hiện MỘT dòng giao dịch; tab Công nợ có dòng Tiền trả trước", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC}`)
  await page.getByTestId("ncc-dau").getByRole("button", { name: "Chi trả NCC" }).click()

  const hop = page.getByRole("dialog")
  await expect(hop.getByRole("heading", { name: "Phiếu chi trả NCC" })).toBeVisible()
  await expect(hop.locator("#pc-ncc")).toHaveCount(0)
  await expect(hop.getByTestId("phieu-chi-ncc")).toContainText("Vinamilk")
  // Phiếu chi trước đã huỷ → nợ về đủ 350.000.
  await expect(hop.getByTestId("pc-no-ncc")).toContainText("Còn phải trả NCC: 350.000đ")
  await hop.getByRole("button", { name: "Trả hết" }).click()
  await expect(hop.locator("#pc-tien")).toHaveValue("350.000")
  await hop.locator("#pc-tien").fill("400000")
  await hop.getByRole("button", { name: "Lưu phiếu chi" }).click()

  await expect(page.getByText("Đã lập phiếu chi PCNCC-0002 — 400.000đ").first()).toBeVisible()
  expect((await goiRpc("chi_tra_ncc")).at(-1)).toEqual({
    p_supplier_id: NCC, p_amount: 400000, p_paid_date: "2026-09-30", p_method: "cash", p_notes: null, p_reference: null,
  })

  // Lịch sử: mỗi phiếu chi MỘT dòng (kể cả phiếu đã huỷ) — phần tiền đã chia vào từng khoản nợ không hiện lặp.
  const gd = page.getByTestId("ncc-giao-dich")
  await expect(gd.getByText("PCNCC-0002")).toBeVisible()
  await expect(gd.getByText("PCNCC-0001")).toBeVisible()
  await expect(page.getByText("0 phiếu trả · 2 lần trả tiền")).toBeVisible()

  await page.getByRole("tab", { name: /Công nợ/ }).click()
  await expect(page.getByText("Còn phải trả -50.000đ")).toBeVisible()
  const truoc = page.getByRole("row").filter({ hasText: "PCNCC-0002" })
  await expect(truoc).toContainText("Tiền trả trước")
  await expect(page.getByRole("row").filter({ hasText: "PN-PC1" })).toContainText("Đã thanh toán")
})

test("Quản lý: không có loại phiếu Trả NCC, không có nút Chi trả NCC / Huỷ phiếu chi (Chủ NPP, Kế toán mới chi)", async ({ page }) => {
  await doiVai("manager")
  await dangNhap(page)
  await page.goto("/finance/expenses")
  await page.getByRole("button", { name: "Lập phiếu chi" }).filter({ visible: true }).first().click()
  const hop = page.getByRole("dialog")
  await expect(hop.getByText("Ghi nhận một khoản chi phí phát sinh")).toBeVisible()
  await expect(hop.getByRole("tab", { name: "Trả NCC" })).toHaveCount(0)
  await hop.getByRole("button", { name: "Hủy" }).click()

  // Vẫn xem được phiếu chi trả NCC trong danh sách, nhưng không huỷ được.
  const dong = page.getByRole("row").filter({ hasText: "Trả nhà cung cấp" })
  await expect(dong).toHaveCount(1)
  await dong.click()
  await expect(page.getByRole("dialog")).toContainText("Phiếu chi PCNCC-0002")
  await expect(page.getByRole("dialog").getByRole("button", { name: "Huỷ phiếu chi" })).toHaveCount(0)

  await page.goto(`/suppliers/${NCC}`)
  await expect(page.getByTestId("ncc-dau").getByRole("button", { name: "Trả hàng NCC" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Chi trả NCC" })).toHaveCount(0)
})
