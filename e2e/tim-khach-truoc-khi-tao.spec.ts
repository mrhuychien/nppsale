import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 14/10/2026: "Kiểm tra phần tạo khách hàng mới trên điện thoại của nhân viên mất phần tìm khách hàng đã có
 *   trước khi tạo rồi". Luật gốc (06/06/2026): "trước khi NV sale thêm KH mới, cần check trùng (theo SĐT, địa chỉ,
 *   tên). Nếu KH đã tồn tại — kể cả do NV khác phụ trách — cho phép sale 'thêm vào danh sách của tôi' thay vì tạo trùng".
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

test.beforeEach(async () => {
  await api("users", { method: "POST", body: JSON.stringify([{ id: NV_KHAC, org_id: ORG, full_name: "Nguyễn Văn Khác", role: "sales", phone: "0911000099", is_active: true }]) })
  await api("customer_assignments", { method: "POST", body: JSON.stringify([{ id: "pc-khac", customer_id: KHACH, user_id: NV_KHAC, role: "primary", status: "active", org_id: ORG }]) })
})
test.afterEach(async () => {
  await doiVai("owner")
  await api(`customer_assignments?customer_id=eq.${KHACH}`, { method: "DELETE" })
  await api(`users?id=eq.${NV_KHAC}`, { method: "DELETE" })
})

test("NVBH: Thêm khách → bước TÌM trước; tìm theo địa chỉ ra khách NV khác phụ trách → Thêm vào DS của tôi; không thấy thì tạo, chữ mang sang form; lùi về còn chữ", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.goto("/customers/new")
  // Bước tìm hiện TRƯỚC — chưa có form.
  await expect(page.getByText("Tìm khách hàng đã có")).toBeVisible()
  await expect(page.getByTestId("tk-shop")).toHaveCount(0)

  // Tìm theo ĐỊA CHỈ (ô tìm ở danh sách khách không thấy khách người khác phụ trách — RLS).
  await page.getByTestId("tk-tim").fill("Lê Lợi")
  const the = page.getByTestId("tk-trung").filter({ hasText: "Tạp hoá Cô Ba" })
  await expect(the).toBeVisible()
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

  // Không thấy khách phù hợp → tạo mới, tên đã gõ mang sang ô Tên cửa hàng.
  await page.getByTestId("tk-tim").fill("Tạp hoá Bà Hai Mới")
  await expect(page.getByTestId("tk-khong-trung")).toContainText("Chưa có khách nào khớp")
  await page.getByTestId("tk-tao-moi").click()
  await expect(page.getByTestId("tk-shop")).toHaveValue("Tạp hoá Bà Hai Mới")
  // Lùi từ form → về bước tìm, chữ còn nguyên.
  await page.getByRole("button", { name: "Huỷ" }).click()
  await expect(page.getByTestId("tk-tim")).toHaveValue("Tạp hoá Bà Hai Mới")
  await expect(page).toHaveURL(/\/customers\/new$/)
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

test("Chủ NPP trên điện thoại: bước tìm có nút Xem khách (không có nút nhận); gõ SĐT không ra → tạo mới gán sẵn số", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers/new")
  await page.getByTestId("tk-tim").fill("0911")
  const the = page.getByTestId("tk-trung").filter({ hasText: "Tạp hoá Cô Ba" })
  await expect(the.getByTestId("tk-xem")).toHaveAttribute("href", `/customers/${KHACH}`)
  await expect(the.getByTestId("tk-nhan")).toHaveCount(0)

  await page.getByTestId("tk-tim").fill("0912 345 678")
  await expect(page.getByTestId("tk-khong-trung")).toBeVisible()
  await page.getByTestId("tk-tao-moi").click()
  await expect(page.getByTestId("tk-phone")).toHaveValue("0912 345 678")
  await expect(page.getByTestId("tk-shop")).toHaveValue("")
})

test.describe("máy tính", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })
  test("bản máy tính (cùng đường tìm): tìm theo địa chỉ → NVBH Thêm vào DS của tôi → Trong DS của bạn", async ({ page }) => {
    await dangNhap(page)
    await doiVai("sales")
    await page.goto("/customers/new")
    await expect(page.getByRole("heading", { name: "Tìm khách hàng đã có" })).toBeVisible()
    await page.getByPlaceholder("VD: 0901xxx, Hồng Bàng, Tạp hóa Hai...").fill("Lê Lợi")
    await expect(page.getByText("Phụ trách chính:")).toBeVisible()
    await page.getByRole("button", { name: "Thêm vào DS của tôi" }).click()
    await expect(page.getByText("Trong DS của bạn")).toBeVisible()
    expect((await phanCong()).filter((a) => a.user_id === OWNER)).toMatchObject([{ role: "secondary" }])
  })
})
