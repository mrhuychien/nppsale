import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { NCC, SUA, ORG } from "./fixture.mjs"

/**
 * CHỦ NHÀ 05/10/2026: "Viết lại giao diện nhà cung cấp chi tiết" · "Xem lại phần xóa NCC?" · "Thêm chức năng gộp NCC".
 *
 * Vinamilk (NCC): phiếu nhập PN-1 hoàn thành 20/09 (tháng này theo đồng hồ e2e 30/09) 300.000, dòng Sữa hộp × thùng
 *   400.000; nợ 300.000 đã trả 100.000 (một phiếu chi) → còn 200.000; Sữa hộp gắn NCC chính.
 * "NCC Trống": không có gì → xoá được. "Vinamilk Miền Nam": nợ 50.000 → gộp vào Vinamilk thì Vinamilk còn 250.000.
 */
const TRONG = "00000000-0000-4000-8000-0000000002e2"
const MIEN_NAM = "00000000-0000-4000-8000-0000000002e3"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeAll(async () => {
  await api("purchase_invoices?id=eq.pi1", "PATCH", { supplier_id: NCC, payable_id: "pay-ct-1" })
  await api("purchase_invoice_lines", "POST", [{ id: "pil-ct-1", invoice_id: "pi1", product_id: SUA, unit_name: "thùng", quantity: 1, unit_price: 400000 }])
  await api("payables", "POST", [
    { id: "pay-ct-1", org_id: ORG, supplier_id: NCC, invoice_number: "HD1", amount: 300000, paid: 100000, status: "partial", created_at: "2026-09-20T08:00:00Z", opening_balance: false },
    { id: "pay-ct-2", org_id: ORG, supplier_id: MIEN_NAM, invoice_number: "HD-MN", amount: 50000, paid: 0, status: "open", created_at: "2026-09-21T08:00:00Z", opening_balance: false },
  ])
  await api("payable_payments", "POST", [{ id: "pp-ct-1", payable_id: "pay-ct-1", amount: 100000, method: "cash", paid_at: "2026-09-22T08:00:00Z" }])
  await api(`products?id=eq.${SUA}`, "PATCH", { primary_supplier_id: NCC })
  await api("suppliers", "POST", [
    { id: TRONG, org_id: ORG, code: "NCC-TRONG", name: "NCC Trống", is_active: true },
    { id: MIEN_NAM, org_id: ORG, code: "NCC-MN", name: "Vinamilk Miền Nam", phone: "0908000111", is_active: true },
  ])
})
test.afterAll(async () => {
  await api("purchase_invoices?id=eq.pi1", "PATCH", { payable_id: null })
  await api("purchase_invoice_lines?id=eq.pil-ct-1", "DELETE")
  await api("payables?id=in.(pay-ct-1,pay-ct-2)", "DELETE")
  await api("payable_payments?id=eq.pp-ct-1", "DELETE")
  await api(`products?id=eq.${SUA}`, "PATCH", { primary_supplier_id: null })
  await api(`suppliers?id=in.(${TRONG},${MIEN_NAM})`, "DELETE")
  await api(`suppliers?id=eq.${NCC}`, "PATCH", { is_active: true, tax_code: null, phone: null })
})

const kpi = (page: Page, nhan: string) => page.getByTestId("ncc-kpi").locator("div").filter({ hasText: nhan }).first()

test("chi tiết NCC (máy tính): thẻ đầu, 4 ô số, 5 tab, hai cột ≥1280px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC}`)
  const dau = page.getByTestId("ncc-dau")
  await expect(dau.getByRole("heading", { name: "Vinamilk" })).toBeVisible()
  await expect(page.getByTestId("ncc-trang-thai")).toHaveText("Hoạt động")
  await expect(page.getByTestId("ncc-dong-phu")).toContainText("Nhà cung cấp · 1 phiếu nhập")
  for (const n of ["Tạo phiếu nhập", "Trả hàng NCC", "Sửa thông tin"]) await expect(dau.getByRole("button", { name: n })).toBeVisible()

  await expect(kpi(page, "Giá trị nhập tháng này")).toContainText("300.000đ")
  await expect(page.getByTestId("ncc-con-no")).toHaveText("200.000đ")
  await expect(kpi(page, "Tổng phiếu nhập")).toContainText("1phiếu")
  await expect(kpi(page, "Sản phẩm")).toContainText("1SKU")

  // Mặc định tab Lịch sử: phiếu nhập + lần trả tiền, mới trước.
  await expect(page.getByRole("tab", { name: "Lịch sử giao dịch" })).toHaveAttribute("data-state", "active")
  const gd = page.getByTestId("ncc-giao-dich")
  await expect(gd).toHaveCount(2)
  await expect(gd.first()).toContainText("Trả tiền NCC")
  await expect(gd.filter({ hasText: "PN-1" })).toContainText("300.000đ")
  await expect(gd.filter({ hasText: "PN-1" })).toContainText("Hoàn thành")

  // Hai cột: cột phải nằm bên phải thẻ tab.
  const trai = await page.getByRole("tablist").boundingBox()
  const phai = await page.getByTestId("ncc-hoat-dong").boundingBox()
  expect(phai!.x).toBeGreaterThan(trai!.x + 300)
  await expect(page.getByTestId("ncc-hoat-dong")).toContainText("Phiếu nhập PN-1")

  await page.getByRole("tab", { name: "Tổng quan" }).click()
  const hs = page.getByTestId("ncc-ho-so")
  await expect(hs).toContainText("Hồ sơ nhà cung cấp")
  await expect(hs.locator("div").filter({ hasText: /^Điện thoại/ })).toContainText("Chưa cập nhật")
  await expect(hs.locator("div").filter({ hasText: /^Hạn mức công nợ/ })).toContainText("Không đặt hạn mức")

  await page.getByRole("tab", { name: "Bảng giá" }).click()
  const gia = page.getByTestId("dong-bang-gia")
  await expect(gia).toHaveCount(1)
  await expect(gia).toContainText("Sữa hộp")
  await expect(gia).toContainText("thùng")
  await expect(gia).toContainText("400.000đ")

  await page.getByRole("tab", { name: "Công nợ" }).click()
  await expect(page.getByTestId("dong-no-ncc")).toHaveCount(1)

  await page.getByRole("tab", { name: "Thông tin pháp lý" }).click()
  const pl = page.getByTestId("ncc-phap-ly")
  for (const n of ["Tên pháp nhân", "Mã số thuế", "Loại hình", "Người đại diện", "Số giấy phép ĐKKD", "Ngày cấp", "Địa chỉ đăng ký", "Tài khoản ngân hàng"]) {
    await expect(pl).toContainText(n)
  }
  await expect(pl.getByRole("button", { name: "Cập nhật" })).toBeVisible()
})

test("Cần hoàn thiện → Bổ sung mở form sửa đúng ô, lưu gửi đúng cột", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC}`)
  const can = page.getByTestId("ncc-can-hoan-thien")
  await expect(can).toContainText("Chưa có mã số thuế")
  await can.getByTestId("viec-tax_code").getByRole("button", { name: "Bổ sung" }).click()
  const sheet = page.getByTestId("ncc-sua")
  await expect(sheet).toBeVisible()
  await expect(sheet.locator("#ncc-tax_code")).toBeFocused()
  await sheet.locator("#ncc-tax_code").fill("0312345678")
  await sheet.getByRole("button", { name: "Lưu thay đổi" }).click()
  await expect(sheet).toHaveCount(0)
  const patch = (await nhatKy()).filter((r) => r.method === "PATCH" && r.path === "/rest/v1/suppliers").at(-1)
  expect(patch?.body).toMatchObject({ tax_code: "0312345678", name: "Vinamilk" })
  // Ô pháp lý chưa điền thì không gửi (mã lên trước mig 232 vẫn lưu được).
  expect(patch?.body).not.toHaveProperty("legal_name")
  await expect(can).not.toContainText("Chưa có mã số thuế")
})

test("xoá NCC đã có chứng từ: không xoá, kể số chứng từ, mời Ngừng hợp tác / Gộp", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC}`)
  const truoc = (await nhatKy()).length
  const vung = page.getByTestId("ncc-vung-nguy-hiem")
  await vung.getByRole("button", { name: "Xóa nhà cung cấp" }).click()
  const khong = page.getByTestId("ncc-khong-xoa-duoc")
  await expect(khong).toContainText("1 phiếu nhập")
  await expect(khong).toContainText("còn nợ 200.000đ")
  await expect(khong.getByRole("button", { name: "Gộp vào NCC khác…" })).toBeVisible()
  await expect(vung.getByRole("button", { name: "Xóa", exact: true })).toHaveCount(0)
  await khong.getByRole("button", { name: "Ngừng hợp tác" }).click()
  await expect(page.getByTestId("ncc-trang-thai")).toHaveText("Ngừng hợp tác")
  const log = (await nhatKy()).slice(truoc)
  expect(log.some((r) => r.path === "/rest/v1/rpc/so_chung_tu_ncc")).toBe(true)
  expect(log.some((r) => r.method === "DELETE" && r.path === "/rest/v1/suppliers")).toBe(false)
  expect(log.filter((r) => r.method === "PATCH" && r.path === "/rest/v1/suppliers").at(-1)?.body).toEqual({ is_active: false })
})

test("xoá NCC chưa có chứng từ: hỏi lại tại chỗ rồi xoá, về danh sách", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dangNhap(page)
  await page.goto(`/suppliers/${TRONG}`)
  await page.getByTestId("ncc-vung-nguy-hiem").getByRole("button", { name: "Xóa nhà cung cấp" }).click()
  const hoi = page.getByTestId("ncc-xac-nhan-xoa")
  await expect(hoi).toContainText('Xóa "NCC Trống"?')
  await hoi.getByRole("button", { name: "Xóa", exact: true }).click()
  await expect(page).toHaveURL(/\/suppliers$/)
  const xoa = (await nhatKy()).filter((r) => r.method === "DELETE" && r.path === "/rest/v1/suppliers")
  expect((xoa.at(-1) as { query?: string } | undefined)?.query).toContain(`id=eq.${TRONG}`)
})

test("gộp NCC: chọn NCC giữ lại, thấy những gì chuyển sang, gộp xong về NCC giữ lại với nợ cộng dồn", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dangNhap(page)
  await page.goto(`/suppliers/${MIEN_NAM}`)
  await page.getByTestId("ncc-vung-nguy-hiem").getByRole("button", { name: "Gộp vào NCC khác…" }).click()
  const hop = page.getByTestId("gop-ncc")
  await hop.locator("#gop-ncc-vao").click()
  await hop.locator("#gop-ncc-vao").fill("Vinamilk")
  await hop.getByTestId("search-select-xo").getByRole("button", { name: /^Vinamilk/ }).click()
  await expect(hop.getByTestId("gop-ncc-se-chuyen")).toContainText("1 dòng công nợ NCC")
  await expect(hop.getByTestId("gop-ncc-se-chuyen")).toContainText("còn nợ 50.000đ")
  await hop.getByTestId("gop-ncc-xac-nhan").click()
  await expect(page).toHaveURL(new RegExp(`/suppliers/${NCC}$`))
  await expect(page.getByTestId("ncc-con-no")).toHaveText("250.000đ")
  const rpc = (await nhatKy()).filter((r) => r.path === "/rest/v1/rpc/gop_nha_cung_cap")
  expect(rpc.at(-1)?.body).toEqual({ p_tu: MIEN_NAM, p_vao: NCC })
})

test("chi tiết NCC trên điện thoại: 4 ô số thành 2 cột, không cuộn ngang, tab cuộn được", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC}`)
  await expect(page.getByTestId("ncc-con-no")).toBeVisible()
  const o = page.getByTestId("ncc-kpi").locator(":scope > div")
  const [a, b, c] = [await o.nth(0).boundingBox(), await o.nth(1).boundingBox(), await o.nth(2).boundingBox()]
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
  expect(c!.y).toBeGreaterThan(a!.y + 10)
  const tran = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(tran).toBeLessThanOrEqual(0)
  // Nút ở thẻ đầu đủ cao để bấm.
  const nut = await page.getByTestId("ncc-dau").getByRole("button", { name: "Tạo phiếu nhập" }).boundingBox()
  expect(nut!.height).toBeGreaterThanOrEqual(36)
})

test("danh sách NCC: chọn 2 NCC → Gộp, chọn NCC giữ lại trong các NCC đã chọn", async ({ page }) => {
  const A = "00000000-0000-4000-8000-0000000002e4"
  const B = "00000000-0000-4000-8000-0000000002e5"
  await api("suppliers", "POST", [
    { id: A, org_id: ORG, code: "NCC-GA", name: "Gộp Thử An", is_active: true },
    { id: B, org_id: ORG, code: "NCC-GB", name: "Gộp Thử Bình", is_active: true },
  ])
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await dangNhap(page)
    await page.goto("/suppliers")
    await page.getByRole("checkbox", { name: "Chọn Gộp Thử An" }).click()
    const nut = page.getByRole("button", { name: "Gộp", exact: true })
    await expect(nut).toBeDisabled()
    await page.getByRole("checkbox", { name: "Chọn Gộp Thử Bình" }).click()
    await nut.click()
    const hop = page.getByTestId("gop-ncc")
    await hop.getByRole("radio", { name: /Gộp Thử Bình/ }).click()
    await expect(hop.getByTestId("gop-ncc-se-chuyen")).toContainText("Gộp Thử An")
    await expect(hop.getByTestId("gop-ncc-se-chuyen")).toContainText("Chưa có chứng từ")
    await hop.getByTestId("gop-ncc-xac-nhan").click()
    await expect(page).toHaveURL(new RegExp(`/suppliers/${B}$`))
    const rpc = (await nhatKy()).filter((r) => r.path === "/rest/v1/rpc/gop_nha_cung_cap")
    expect(rpc.at(-1)?.body).toEqual({ p_tu: A, p_vao: B })
  } finally {
    await api(`suppliers?id=in.(${A},${B})`, "DELETE")
  }
})
