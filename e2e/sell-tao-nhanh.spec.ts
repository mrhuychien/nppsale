import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/10/2026 (Update 3.10): "Đang làm đơn -> thêm khách hàng -> thêm xong quay về phần đơn đang làm,
 *   add luôn khách vừa thêm vào khách. Tương tự sản phẩm cũng vậy" · mục 5: "Update ngược cơ chế tương tự cho
 *   sell bán hàng trên mobile". Tạo TẠI CHỖ (tấm trượt kín màn), gán sẵn chữ đang tìm, lưu xong tự gắn vào đơn.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, { method: "PATCH", body: JSON.stringify({ role }) })
const KHACH = "Cô Tám Mới"
/** "Tạp hoá Cô Ba" — SĐT 0911111111 trong dữ liệu mẫu. */
const KHACH_CO_BA = "00000000-0000-4000-8000-0000000000c1"
const HANG = "Kẹo Mới Z"

test.beforeEach(async () => {
  await api("sales_routes", { method: "POST", body: JSON.stringify([{ id: "tuyen-stn", org_id: ORG, code: "STN", name: "Sell Nhanh", is_active: true, sort_order: 1 }]) })
})
test.afterEach(async () => {
  await api("sales_routes?id=eq.tuyen-stn", { method: "DELETE" })
  await api(`customers?store_name=eq.${encodeURIComponent(KHACH)}`, { method: "DELETE" })
  await api(`products?name=eq.${encodeURIComponent(HANG)}`, { method: "DELETE" })
})

const gio = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("npp.sell.cart.v1") || "{}"))

/** Từ màn đơn /sell sang màn chọn khách (lối thật: router.back() của màn chọn khách về lại đơn). */
async function moChonKhach(page: Page) {
  await page.goto("/sell")
  // Bấm trước lúc màn kịp nạp xong thì nút chưa có sự kiện — bấm lại tới khi sang màn chọn khách. Đã sang thì thôi bấm:
  // lần đầu `next dev` dịch màn chọn khách chậm (URL đổi trễ cả chục giây), màn mới không còn nút ấy — bấm không hẹn giờ
  // là đứng chờ tới hết giờ bài.
  await expect(async () => {
    if (!/\/sell\/customer$/.test(page.url())) await page.getByRole("button", { name: /Chọn khách hàng/ }).click({ timeout: 2000 })
    await expect(page).toHaveURL(/\/sell\/customer$/, { timeout: 2000 })
  }).toPass({ timeout: 60_000 })
}

test("chọn khách: tìm tên chưa có → bước tìm SĐT → tạo tại chỗ → về đơn với khách vừa tạo", async ({ page }) => {
  await dangNhap(page)
  await moChonKhach(page)
  await page.getByLabel("Tìm khách hàng").fill(KHACH)
  // Tìm không ra → nút tạo mang đúng chữ đang tìm.
  const tao = page.getByTestId("tao-khach-voi-sdt")
  await expect(tao).toHaveText(`Tạo khách hàng mới “${KHACH}”`)
  await tao.click()

  const khung = page.getByTestId("tao-nhanh-khach")
  await expect(khung).toBeVisible()
  /* ⚠ Chủ nhà 03/11/2026: "vẫn phải qua bước lọc trùng số điện thoại chứ ko được đến thẳng màn tạo khách hàng". */
  await expect(khung.getByText("Tìm khách hàng đã có")).toBeVisible()
  await expect(khung.getByTestId("tk-shop"), "vào thẳng form tạo khách").toHaveCount(0)
  await khung.getByTestId("tk-tim").fill("0987650008")
  await expect(khung.getByTestId("tk-khong-trung")).toContainText("Chưa có khách nào dùng số 0987 650 008")
  await khung.getByTestId("tk-tao-moi").click()
  // Tên đang tìm ở đơn + số vừa dò mang sang form.
  await expect(khung.getByTestId("tk-shop")).toHaveValue(KHACH)
  await expect(khung.getByTestId("tk-phone")).toHaveValue("0987 650 008")
  await khung.getByTestId("tk-owner").fill("Lê Thị Tám")
  await khung.getByTestId("tk-street").fill("8 Cầu Đất")
  await khung.locator("#tk-route").click()
  await khung.locator("#tk-route").fill("STN")
  await khung.getByTestId("search-select-xo").getByRole("button", { name: /STN · Sell Nhanh/ }).click()
  await khung.getByTestId("tk-luu").click()

  await expect(khung).toHaveCount(0)
  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByRole("button", { name: new RegExp(`${KHACH}.*Đổi khách`) })).toBeVisible()
  const ghi = await (await api(`customers?store_name=eq.${encodeURIComponent(KHACH)}&select=id`)).json()
  expect(ghi).toHaveLength(1)
  expect((await gio(page)).customerId).toBe(ghi[0].id)
})

test("chọn khách → Khách mới: số ĐÃ có khách thì khoá Tạo mới, chọn khách ấy luôn vào đơn; lùi là đóng khung", async ({ page }) => {
  await dangNhap(page)
  await moChonKhach(page)
  const khung = page.getByTestId("tao-nhanh-khach")
  // Lùi ở bước tìm = đóng khung, vẫn ở màn chọn khách.
  await page.getByTestId("sell-khach-moi").click()
  await expect(khung.getByText("Tìm khách hàng đã có")).toBeVisible()
  await khung.getByRole("button", { name: "Quay lại" }).click()
  await expect(khung).toHaveCount(0)
  await expect(page).toHaveURL(/\/sell\/customer$/)

  await page.getByTestId("sell-khach-moi").click()
  await expect(khung.getByTestId("tk-shop"), "vào thẳng form tạo khách").toHaveCount(0)
  await khung.getByTestId("tk-tim").fill("0911 111 111")
  await expect(khung.getByTestId("tk-trung")).toContainText("Tạp hoá Cô Ba")
  await expect(khung.getByTestId("tk-tao-moi"), "số đã có khách mà vẫn tạo mới được").toBeDisabled()
  await khung.getByTestId("tk-chon").click()

  await expect(khung).toHaveCount(0)
  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByRole("button", { name: /Tạp hoá Cô Ba.*Đổi khách/ })).toBeVisible()
  expect((await gio(page)).customerId).toBe(KHACH_CO_BA)
})

test("NVBH: số của khách chưa trong DS của mình → 'Thêm vào DS của tôi và chọn khách này' → về đơn với khách ấy", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await moChonKhach(page)
    // Chữ đang tìm ở đơn là số → điền sẵn ở bước tìm, dò ngay.
    await page.getByLabel("Tìm khách hàng").fill("0911111111")
    await page.getByTestId("sell-khach-moi").click()
    const khung = page.getByTestId("tao-nhanh-khach")
    await expect(khung.getByTestId("tk-tim")).toHaveValue("0911111111")
    await expect(khung.getByTestId("tk-trung")).toContainText("Tạp hoá Cô Ba")
    await expect(khung.getByTestId("tk-tao-moi")).toBeDisabled()
    await expect(khung.getByTestId("tk-chon"), "NVBH chưa nhận khách thì chưa chọn được").toHaveCount(0)
    await khung.getByTestId("tk-nhan").filter({ hasText: "Thêm vào DS của tôi và chọn khách này" }).click()

    await expect(khung).toHaveCount(0)
    await expect(page).toHaveURL(/\/sell$/)
    await expect(page.getByRole("button", { name: /Tạp hoá Cô Ba.*Đổi khách/ })).toBeVisible()
    expect((await gio(page)).customerId).toBe(KHACH_CO_BA)
    const pc = (await (await api(`customer_assignments?customer_id=eq.${KHACH_CO_BA}&select=user_id,role`)).json()) as Array<{ user_id: string; role: string }>
    expect(pc).toContainEqual(expect.objectContaining({ user_id: OWNER, role: "primary" }))
  } finally {
    await doiVai("owner")
    await api(`customer_assignments?customer_id=eq.${KHACH_CO_BA}&user_id=eq.${OWNER}`, { method: "DELETE" })
  }
})

test("chọn khách: có kết quả gần giống vẫn có dòng tạo mới ở cuối danh sách", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell/customer")
  await page.getByLabel("Tìm khách hàng").fill("Cô Ba")
  await expect(page.getByText("Tạp hoá Cô Ba")).toBeVisible()
  await expect(page.getByTestId("sell-tao-khach-cuoi")).toHaveText("Tạo khách hàng mới “Cô Ba”")
})

test("thêm hàng: tìm chưa có → tạo sản phẩm tại chỗ → vào đơn (chọn từng mã: sang Đơn hàng)", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByLabel("Tìm sản phẩm").fill(HANG)
  const tao = page.getByTestId("sell-tao-san-pham")
  await expect(tao).toHaveText(`Tạo sản phẩm mới “${HANG}”`)
  // Nút "Thêm sản phẩm" trên đầu, cạnh công tắc chọn nhiều — cũng mở cùng khung.
  await expect(page.getByTestId("sell-them-san-pham")).toBeVisible()
  await tao.click()

  const khung = page.getByTestId("tao-nhanh-san-pham")
  await expect(khung.locator("#name")).toHaveValue(HANG)
  await khung.locator("#base_unit").fill("gói")
  await khung.getByRole("searchbox", { name: "Nhà cung cấp *" }).click()
  await khung.getByRole("button", { name: "Vinamilk", exact: true }).click()
  await khung.getByRole("button", { name: "Lưu", exact: true }).click()
  await expect(khung).toHaveCount(0)

  await expect(page).toHaveURL(/\/sell\/cart/)
  await expect(page.getByText(HANG).first()).toBeVisible()
  const ghi = await (await api(`products?name=eq.${encodeURIComponent(HANG)}&select=id`)).json()
  expect(ghi).toHaveLength(1)
  const g = await gio(page)
  expect(g.cart).toHaveLength(1)
  expect(g.cart[0]).toMatchObject({ productId: ghi[0].id, unit: "gói", qty: 1 })
})

test("chọn hàng TRẢ: không có tạo sản phẩm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell?mode=return")
  await page.getByLabel("Tìm sản phẩm").fill(HANG)
  await expect(page.getByText(`Không tìm thấy sản phẩm khớp “${HANG}”`)).toBeVisible()
  await expect(page.getByTestId("sell-tao-san-pham")).toHaveCount(0)
  await expect(page.getByTestId("sell-them-san-pham")).toHaveCount(0)
})

test("NVBH: tạo khách được, tạo sản phẩm thì không (không có quyền Sản phẩm)", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/sell")
    await page.getByLabel("Tìm sản phẩm").fill(HANG)
    await expect(page.getByText(`Không tìm thấy sản phẩm khớp “${HANG}”`)).toBeVisible()
    await expect(page.getByTestId("sell-tao-san-pham")).toHaveCount(0)
    await expect(page.getByTestId("sell-them-san-pham")).toHaveCount(0)
    await page.goto("/sell/customer")
    await expect(page.getByTestId("sell-khach-moi")).toBeVisible()
  } finally {
    await doiVai("owner")
  }
})
