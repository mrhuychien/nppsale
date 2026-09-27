import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 27/09/2026: "Viết lại giao diện danh sách trả hàng trên mobile của nhân viên bán hàng
 *   theo mẫu". Đầu trang xanh, thẻ "Chờ xử lý · N phiếu" + Xử lý ngay, chip trạng thái có số, ô tìm
 *   + lý do, phiếu nhóm theo ngày, ngăn phiếu có Kho nhận + "Hoàn thành · nhập …".
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, "PATCH", { role })

const PHIEU = [
  {
    id: "r-mb-1", return_code: "TH-M001", status: "submitted", reason: "damaged", credit_note_amount: 148000,
    return_date: "2026-12-31", customer: { store_name: "Thanh Sang" }, order: { order_code: "DH-M456" }, invoice: { invoice_code: "HD-M461" },
  },
  {
    id: "r-mb-2", return_code: "TH-M002", status: "draft", reason: "wrong_item", credit_note_amount: 96000,
    return_date: "2026-12-31", customer: { store_name: "Bảy Hoa" }, order: null, invoice: null,
  },
]

test.beforeAll(async () => {
  await api(
    "returns",
    "POST",
    PHIEU.map((p) => ({
      org_id: ORG, customer_id: "00000000-0000-4000-8000-0000000000c1", created_at: "2026-12-31T02:00:00Z",
      requested_by: OWNER, requester: { full_name: "Chủ NPP" }, sales_user_id: OWNER, seller: { full_name: "Chủ NPP" },
      credit_with_invoice: false, invoice_id: null, order_id: null, ...p,
    }))
  )
})
test.afterAll(async () => {
  for (const p of PHIEU) await api(`returns?id=eq.${p.id}`, "DELETE", {})
})

test("điện thoại: màn theo mẫu — thẻ chờ xử lý, chip có số, nhóm ngày, hoàn thành ngay trong ngăn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const man = page.getByTestId("tra-mobile")
  await expect(man.getByRole("heading", { name: "Trả hàng" })).toBeVisible()
  // Không còn app bar chuẩn chồng lên đầu trang xanh.
  await expect(page.locator("header").filter({ hasText: "Trả hàng" }).first()).toBeHidden()

  const the = man.getByTestId("the-cho-xu-ly")
  await expect(the).toContainText(/Chờ xử lý · \d+ phiếu/)
  await expect(the.getByRole("button", { name: "Xử lý ngay" })).toBeVisible()
  await expect(man.getByRole("link", { name: /Tạo phiếu trả/ })).toHaveAttribute("href", "/returns/new")

  // Mở ở tab "Chờ xử lý", chip có số.
  const chipCho = man.getByRole("tab", { name: /^Chờ xử lý/ })
  await expect(chipCho).toHaveAttribute("aria-selected", "true")
  await expect(chipCho).toContainText(/\d+/)

  // Nhóm ngày + thẻ phiếu: khách, lý do · mã đơn, mã phiếu · mã HĐ, tiền, trạng thái.
  await man.getByLabel("Tìm phiếu trả").fill("TH-M001")
  await expect(man.getByRole("heading", { name: "31/12" })).toBeVisible()
  await expect(man.getByText("1 phiếu · 148.000")).toBeVisible()
  const phieu = man.getByTestId("the-tra").filter({ hasText: "Thanh Sang" })
  await expect(phieu).toContainText("Hàng hư hỏng · DH-M456")
  await expect(phieu).toContainText("TH-M001 · HD-M461")
  await expect(phieu).toContainText("148.000")
  await expect(phieu).toContainText("Chờ xử lý")
  // Phiếu nháp không nằm ở tab Chờ xử lý.
  await man.getByLabel("Tìm phiếu trả").fill("TH-M002")
  await expect(man.getByText("Không có phiếu phù hợp")).toBeVisible()
  await man.getByLabel("Tìm phiếu trả").fill("TH-M001")

  // Ngăn phiếu: Credit note, các dòng, kho gợi ý theo lý do (hư hỏng → kho cận date).
  await phieu.click()
  const ngan = page.getByTestId("ngan-phieu-tra")
  await expect(ngan.getByText("TH-M001")).toBeVisible()
  await expect(ngan.getByTestId("tien-phieu-tra")).toHaveText("148.000đ")
  await expect(ngan).toContainText("Hóa đơn gốc")
  await expect(ngan.getByRole("radio", { name: /Kho cận date/ })).toHaveAttribute("aria-checked", "true")
  await ngan.getByRole("radio", { name: /Kho bán/ }).click()
  await ngan.getByRole("button", { name: "Hoàn thành · nhập kho bán" }).click()
  await expect(ngan).toBeHidden()
  await expect(page.getByText("TH-M001 đã nhập kho bán · công nợ giảm 148.000đ", { exact: true })).toBeVisible()

  // Phiếu rời tab Chờ xử lý, sang Đã nhập kho.
  await expect(man.getByTestId("the-tra").filter({ hasText: "Thanh Sang" })).toHaveCount(0)
  await man.getByRole("tab", { name: /^Đã nhập kho/ }).click()
  await expect(man.getByTestId("the-tra").filter({ hasText: "Thanh Sang" })).toContainText("Đã nhập kho")
})

test("điện thoại: phiếu tự lập ở Nháp — hoàn thành hoặc huỷ (phải ghi lý do); lọc lý do", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const man = page.getByTestId("tra-mobile")
  await man.getByRole("tab", { name: /^Nháp/ }).click()
  await man.getByLabel("Tìm phiếu trả").fill("TH-M002")
  await man.getByLabel("Lọc theo lý do").selectOption("damaged")
  await expect(man.getByText("Không có phiếu phù hợp")).toBeVisible()
  await man.getByLabel("Lọc theo lý do").selectOption("wrong_item")
  const phieu = man.getByTestId("the-tra").filter({ hasText: "Bảy Hoa" })
  await phieu.click()
  const ngan = page.getByTestId("ngan-phieu-tra")
  // Sai hàng → gợi ý kho bán.
  await expect(ngan.getByRole("button", { name: "Hoàn thành · nhập kho bán" })).toBeVisible()
  await ngan.getByRole("button", { name: "Huỷ phiếu" }).click()
  await expect(ngan.getByRole("button", { name: "Xác nhận huỷ" })).toBeDisabled()
  await ngan.getByLabel("Lý do huỷ").fill("Khách đổi ý")
  await ngan.getByRole("button", { name: "Xác nhận huỷ" }).click()
  await expect(page.getByText("Đã huỷ TH-M002", { exact: true })).toBeVisible()
  await expect(man.getByTestId("the-tra").filter({ hasText: "Bảy Hoa" })).toHaveCount(0)
})

test("điện thoại: NVBH — tiêu đề 'Trả hàng của tôi'; thiếu quyền duyệt thì không có nút Hoàn thành", async ({ page }) => {
  await api("returns?id=eq.r-mb-1", "PATCH", { status: "submitted" })
  /* Mẫu quyền NVBH có XEM trả hàng (chủ nhà 27/09/2026, mig 208). */
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/returns")
    const man = page.getByTestId("tra-mobile")
    await expect(man.getByRole("heading", { name: "Trả hàng của tôi" })).toBeVisible()
    await expect(man.getByTestId("the-cho-xu-ly").getByRole("button", { name: "Xử lý ngay" })).toBeVisible()
    await man.getByLabel("Tìm phiếu trả").fill("TH-M001")
    await man.getByTestId("the-tra").filter({ hasText: "Thanh Sang" }).click()
    const ngan = page.getByTestId("ngan-phieu-tra")
    await expect(ngan.getByText("TH-M001")).toBeVisible()
    await expect(ngan.getByRole("button", { name: /Hoàn thành/ })).toHaveCount(0)
    await expect(ngan).toContainText("Quản lý hoặc thủ kho sẽ chọn kho nhận")
  } finally {
    await doiVai("owner")
  }
})

test("cửa vào chờ bảng quyền: NVBH được chủ NPP CẤP THÊM quyền, tải thẳng trang không bị đá về /home", async ({ page }) => {
  /* Kho KHÔNG có trong mẫu NVBH; chủ NPP bật ở Phân quyền (dòng lưu trong DB). */
  await api("role_permissions", "POST", [{ id: "rp-kho-nvbh", org_id: ORG, role: "sales", module: "inventory", action: "read", allowed: true }])
  await dangNhap(page)
  await doiVai("sales")
  try {
    // Bảng quyền phải đi mạng, và chậm — đúng lúc chốt cửa vào dễ quyết sớm theo quyền mặc định.
    await page.evaluate(() => sessionStorage.clear())
    await page.route("**/rest/v1/role_permissions**", async (r) => {
      await new Promise((ok) => setTimeout(ok, 1500))
      await r.continue()
    })
    await page.goto("/inventory")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(3000)
    expect(page.url()).toContain("/inventory")
  } finally {
    await doiVai("owner")
    await api("role_permissions?id=eq.rp-kho-nvbh", "DELETE", {})
  }
})
