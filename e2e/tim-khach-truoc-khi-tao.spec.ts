import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 14/10/2026: "Kiểm tra phần tạo khách hàng mới trên điện thoại của nhân viên mất phần tìm khách hàng đã có
 *   trước khi tạo rồi". Luật gốc (06/06/2026): khách đã có — kể cả do NV khác phụ trách — thì NV "thêm vào danh sách
 *   của tôi" thay vì tạo trùng.
 * ⚠ CHỦ NHÀ 15/10/2026: "Tìm kiếm như vậy là sai. ở máy tính tao chỉ cho tìm kiếm chính xác, nghĩa là nhập đúng số điện
 *   thoại của khách thì khách mới hiện ra." — gõ tên / địa chỉ / số dở KHÔNG ra khách nào (và không gửi đi tìm).
 *   Dữ liệu giả: "Tạp hoá Cô Ba" (0911111111, "1 Lê Lợi") do NV KHÁC phụ trách chính. Tài khoản e2e đổi vai bằng PATCH users.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const NV_KHAC = "00000000-0000-4000-8000-0000000000e7"
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, { method: "PATCH", body: JSON.stringify({ role }) })
const phanCong = async () => (await (await api(`customer_assignments?customer_id=eq.${KHACH}&select=*`)).json()) as Array<Record<string, unknown>>
/** Mọi chữ app đã gửi đi dò trùng — phải toàn là SỐ ĐỦ, không có tên / địa chỉ / số dở. */
const daGuiTim = async () =>
  (await nhatKy()).filter((r) => r.path.endsWith("/rpc/search_customer_dupes")).map((r) => String((r.body as { p_q?: string })?.p_q ?? ""))

test.beforeEach(async () => {
  await api("users", { method: "POST", body: JSON.stringify([{ id: NV_KHAC, org_id: ORG, full_name: "Nguyễn Văn Khác", role: "sales", phone: "0911000099", is_active: true }]) })
  await api("customer_assignments", { method: "POST", body: JSON.stringify([{ id: "pc-khac", customer_id: KHACH, user_id: NV_KHAC, role: "primary", status: "active", org_id: ORG }]) })
})
test.afterEach(async () => {
  await doiVai("owner")
  await api(`customer_assignments?customer_id=eq.${KHACH}`, { method: "DELETE" })
  await api(`users?id=eq.${NV_KHAC}`, { method: "DELETE" })
})

/** Gõ chữ không phải số đủ: nhắc "nhập đủ số", chờ quá nhịp chờ tìm (300ms) — vẫn không ra thẻ khách nào. */
async function goKhongRa(page: Page, o: string, chu: string, nhac: string) {
  await page.getByTestId(o).fill(chu)
  await expect(page.getByTestId(nhac)).toBeVisible()
  await page.waitForTimeout(700)
  await expect(page.getByText("Tạp hoá Cô Ba")).toHaveCount(0)
}

test("NVBH: bước TÌM trước; gõ địa chỉ / tên / số dở KHÔNG ra khách; nhập đúng số ra khách NV khác → Thêm vào DS của tôi; số chưa có → tạo, số mang sang form; lùi về còn số", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.goto("/customers/new")
  await expect(page.getByText("Tìm khách hàng đã có")).toBeVisible()
  await expect(page.getByTestId("tk-shop")).toHaveCount(0)

  // Chỉ tìm CHÍNH XÁC theo số: địa chỉ, tên, số dở đều không ra (khách của NV khác không lộ).
  await goKhongRa(page, "tk-tim", "Lê Lợi", "tk-chua-du-so")
  await goKhongRa(page, "tk-tim", "Tạp hoá Cô Ba", "tk-chua-du-so")
  await goKhongRa(page, "tk-tim", "0911", "tk-chua-du-so")
  await goKhongRa(page, "tk-tim", "091111111", "tk-chua-du-so")

  // Nhập ĐÚNG số → ra khách, kể cả khách NV khác phụ trách.
  await page.getByTestId("tk-tim").fill("0911 111 111")
  const the = page.getByTestId("tk-trung").filter({ hasText: "Tạp hoá Cô Ba" })
  await expect(the).toBeVisible()
  await expect(page.getByTestId("tk-chua-du-so")).toHaveCount(0)
  await expect(the).toContainText("Phụ trách chính: Nguyễn Văn Khác")
  await expect(the).toContainText("0911 111 111")
  // NVBH chưa nhận: không đưa link "Xem khách" (RLS — trang trống), chỉ có nút nhận.
  await expect(the.getByTestId("tk-xem")).toHaveCount(0)
  await the.getByTestId("tk-nhan").click()
  await expect(page.getByText("Đã thêm vào danh sách của bạn (phụ trách phụ)").first()).toBeVisible()
  await expect(the).toContainText("Trong DS của bạn")
  await expect(the.getByTestId("tk-xem")).toBeVisible()
  await expect(the.getByTestId("tk-nhan")).toHaveCount(0)
  expect((await phanCong()).filter((a) => a.user_id === OWNER)).toMatchObject([{ role: "secondary", status: "active" }])

  // Số chưa có khách → tạo mới, số mang sang ô SĐT. Lùi từ form → về bước tìm, số còn nguyên.
  await page.getByTestId("tk-tim").fill("0912 345 678")
  await expect(page.getByTestId("tk-khong-trung")).toContainText("Chưa có khách nào dùng số 0912 345 678")
  await page.getByTestId("tk-tao-moi").click()
  await expect(page.getByTestId("tk-phone")).toHaveValue("0912 345 678")
  await page.getByRole("button", { name: "Huỷ" }).click()
  await expect(page.getByTestId("tk-tim")).toHaveValue("0912 345 678")
  await expect(page).toHaveURL(/\/customers\/new$/)

  // App không gửi đi tìm gì ngoài số đủ.
  const gui = await daGuiTim()
  expect(gui.length).toBeGreaterThan(0)
  expect(gui.every((q) => /^0\d{9,10}$/.test(q)), `đã gửi đi tìm: ${gui.join(" | ")}`).toBe(true)
})

test("NVBH vào bằng ?sdt= (tìm số ở danh sách không ra) → form gán sẵn số; số trùng khách NV khác → Thêm vào DS của tôi, không còn ngõ cụt", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.goto("/customers/new?sdt=0911111111")
  await expect(page.getByTestId("tk-phone")).toHaveValue("0911 111 111")
  await expect(page.getByText(/Đã có khách hàng dùng số 0911 111 111: Tạp hoá Cô Ba/)).toBeVisible()
  await expect(page.getByTestId("tk-mo-khach-trung"), "NVBH chưa nhận khách thì 'Mở khách' là trang trống").toHaveCount(0)
  await expect(page.getByText("Phụ trách chính: Nguyễn Văn Khác")).toBeVisible()
  await page.getByTestId("tk-nhan-khach-trung").click()
  await expect(page.getByText("Đã thêm vào danh sách của bạn (phụ trách phụ)").first()).toBeVisible()
  await expect(page.getByTestId("tk-mo-khach-trung")).toBeVisible()
  expect((await phanCong()).filter((a) => a.user_id === OWNER)).toHaveLength(1)
  // Vẫn không tạo được khách trùng số.
  await expect(page.getByTestId("tk-nhan-khach-trung")).toHaveCount(0)
})

test("Chủ NPP trên điện thoại: cũng chỉ tìm đúng số — số dở không ra; đúng số có nút Xem khách (không có nút nhận)", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers/new")
  await goKhongRa(page, "tk-tim", "0911", "tk-chua-du-so")
  await page.getByTestId("tk-tim").fill("+84 911 111 111")
  const the = page.getByTestId("tk-trung").filter({ hasText: "Tạp hoá Cô Ba" })
  await expect(the.getByTestId("tk-xem")).toHaveAttribute("href", `/customers/${KHACH}`)
  await expect(the.getByTestId("tk-nhan")).toHaveCount(0)
})

test.describe("máy tính", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })
  test("bản máy tính (cùng đường tìm): địa chỉ / số dở không ra; nhập đúng số → NVBH Thêm vào DS của tôi → Trong DS của bạn", async ({ page }) => {
    await dangNhap(page)
    await doiVai("sales")
    await page.goto("/customers/new")
    await expect(page.getByRole("heading", { name: "Tìm khách hàng đã có" })).toBeVisible()
    const o = page.getByLabel("Số điện thoại khách")
    await o.fill("Lê Lợi")
    await expect(page.getByTestId("dupe-chua-du-so")).toBeVisible()
    await page.waitForTimeout(700)
    await expect(page.getByText("Phụ trách chính:")).toHaveCount(0)
    await o.fill("0911 111 111")
    await expect(page.getByText("Phụ trách chính:")).toBeVisible()
    await page.getByRole("button", { name: "Thêm vào DS của tôi" }).click()
    await expect(page.getByText("Trong DS của bạn")).toBeVisible()
    expect((await phanCong()).filter((a) => a.user_id === OWNER)).toMatchObject([{ role: "secondary" }])
    const gui = await daGuiTim()
    expect(gui.every((q) => /^0\d{9,10}$/.test(q)), `đã gửi đi tìm: ${gui.join(" | ")}`).toBe(true)
  })
})
