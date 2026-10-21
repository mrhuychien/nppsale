import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { KHACH, NCC, NHOM, ORG, HOA_DON } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 21/10/2026: "Phần tạo đơn POS : phần Khách hàng / NCC khi ấn vào hiện modal xem thông tin đầy đủ và sửa các
 *   thông tin". Bấm thẻ đối tác ở màn POS → hộp xem đủ hồ sơ → "Sửa thông tin" (biểu mẫu sửa đang có) → lưu xong ở lại
 *   POS; thẻ, ô tìm, bảng giá theo ngay. Phím tắt POS không lọt khỏi hộp (F9 = gửi đơn đằng sau).
 */
const api = (p: string, init?: RequestInit) =>
  fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const doc = async (bang: string, id: string) =>
  ((await (await api(`${bang}?id=eq.${id}`)).json()) as Array<Record<string, unknown>>)[0]
/** Trả dòng về đúng bản cũ: cột biểu mẫu thêm vào mà bản cũ không có thì về null. */
const traVe = async (bang: string, cu: Record<string, unknown>) => {
  const nay = await doc(bang, String(cu.id))
  const them = Object.fromEntries(Object.keys(nay).filter((k) => !(k in cu)).map((k) => [k, null]))
  await api(`${bang}?id=eq.${cu.id}`, { method: "PATCH", body: JSON.stringify({ ...them, ...cu }) })
}
const oTimHang = (page: Page) => page.getByPlaceholder(/Tên hàng, mã (SKU|hàng)/i).first()
const ghiTu = async (moc: number, duongDan: string, method = "PATCH") =>
  (await nhatKy()).slice(moc).filter((r) => r.method === method && r.path === duongDan)

test("đơn POS: bấm thẻ khách → xem đủ hồ sơ; sửa tên + nhóm → thẻ, ô tìm khách, bảng giá theo ngay; F9 trong hộp không gửi đơn", async ({ page }) => {
  const khachCu = await doc("customers", KHACH)
  await api("sales_routes", { method: "POST", body: JSON.stringify([{ id: "tuyen-tt", org_id: ORG, code: "TT1", name: "Tuyến Lê Lợi", is_active: true, sort_order: 1 }]) })
  await api("customer_groups", { method: "POST", body: JSON.stringify([{ id: NHOM, org_id: ORG, name: "Đại lý" }]) })
  await api(`customers?id=eq.${KHACH}`, { method: "PATCH", body: JSON.stringify({ channel: "TT1" }) })
  try {
    await dangNhap(page)
    await page.goto(`/pos/don-hang/moi?customerId=${KHACH}`)
    const the = page.getByRole("button", { name: "Xem thông tin khách hàng: Tạp hoá Cô Ba" })
    await expect(the).toBeVisible()
    await expect(page.getByText(/bảng giá Đại lý/)).toHaveCount(0)
    // Khách chưa có nhóm: "bảng giá chung" — một lần chữ "bảng giá" (bản cũ: "bảng giá bảng giá chung").
    await expect(page.getByText(/· bảng giá chung$/)).toBeVisible()
    await expect(page.getByText(/bảng giá bảng giá/)).toHaveCount(0)
    // Có một dòng hàng: F9 lọt ra khung POS là GỬI ĐƠN thật.
    await oTimHang(page).fill("Sữa")
    await oTimHang(page).press("Enter")
    await expect(page.getByTestId("dong-don")).toHaveCount(1)
    await page.getByRole("button", { name: "Xong" }).click()

    await the.click()
    const hop = page.getByTestId("pos-thong-tin-khach")
    await expect(hop.getByRole("heading", { name: "Tạp hoá Cô Ba" })).toBeVisible()
    for (const chu of ["Cô Ba", "0911111111", "1 Lê Lợi", "TT1 — Tuyến Lê Lợi", "Không hạn mức", "Thông tin xuất hóa đơn"]) {
      await expect(hop.getByText(chu, { exact: false }).first()).toBeVisible()
    }
    const hoSo = hop.getByRole("link", { name: /Mở hồ sơ khách hàng/ })
    await expect(hoSo).toHaveAttribute("href", `/customers/${KHACH}`)
    await expect(hoSo).toHaveAttribute("target", "_blank")

    const moc = (await nhatKy()).length
    await hop.getByRole("button", { name: "Đóng" }).focus()
    await page.keyboard.press("F9")
    await page.keyboard.press("F6")
    await page.waitForTimeout(800)
    const luuDon = (await nhatKy())
      .slice(moc)
      .filter((r) => r.method !== "GET" && (/\/rpc\/.*order/.test(r.path) || r.path === "/rest/v1/sales_orders"))
    expect(luuDon.map((r) => `${r.method} ${r.path}`), "phím tắt POS (F9 gửi đơn, F6 lưu nháp) lọt khỏi hộp").toEqual([])

    await hop.getByRole("button", { name: /Sửa thông tin/ }).click()
    await expect(hop.getByRole("heading", { name: "Sửa thông tin khách hàng" })).toBeVisible()
    await expect(hop.getByRole("button", { name: /Định vị/ }), "máy POS ở văn phòng — không định vị ở đây").toHaveCount(0)
    await expect(hop.getByRole("link", { name: "Quản lý tuyến" }), "không link rời trang").toHaveCount(0)
    await hop.locator("#cf-store").fill("Tạp hoá Cô Ba Mới")
    await hop.getByRole("combobox").filter({ hasText: "Chọn nhóm" }).click()
    await page.getByRole("option", { name: "Đại lý" }).click()
    const mocLuu = (await nhatKy()).length
    await hop.getByRole("button", { name: "Cập nhật" }).click()

    await expect.poll(async () => (await ghiTu(mocLuu, "/rest/v1/customers")).length).toBe(1)
    const gui = (await ghiTu(mocLuu, "/rest/v1/customers"))[0].body as Record<string, unknown>
    expect(gui).toMatchObject({ store_name: "Tạp hoá Cô Ba Mới", group_id: NHOM, channel: "TT1" })
    expect(gui, "sửa khách không gửi lại toạ độ").not.toHaveProperty("gps_lat")

    // Về phần xem, đúng bản mới; ở lại POS (không chuyển trang).
    await expect(hop.getByRole("heading", { name: "Tạp hoá Cô Ba Mới" })).toBeVisible()
    await expect(hop.getByText("Nhóm Đại lý")).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/pos/don-hang/moi\\?customerId=${KHACH}$`))
    await hop.getByRole("button", { name: "Đóng" }).click()
    await expect(hop).toHaveCount(0)

    // Thẻ + bảng giá (nhóm khách) + ô tìm khách theo ngay, đơn đang làm còn nguyên.
    await expect(page.getByRole("button", { name: "Xem thông tin khách hàng: Tạp hoá Cô Ba Mới" })).toBeVisible()
    await expect(page.getByText(/bảng giá Đại lý/)).toBeVisible()
    await expect(page.getByTestId("dong-don")).toHaveCount(1)
    await page.getByRole("button", { name: /Đổi khách/ }).click()
    const tim = page.getByRole("dialog", { name: "Tìm khách hàng" })
    await tim.getByPlaceholder("Tên cửa hàng, SĐT, địa chỉ…").fill("Cô Ba Mới")
    await expect(tim.getByText("Tạp hoá Cô Ba Mới"), "ô tìm khách thấy tên mới").toBeVisible()
  } finally {
    await traVe("customers", khachCu)
    await api("sales_routes?id=eq.tuyen-tt", { method: "DELETE" })
    await api(`customer_groups?id=eq.${NHOM}`, { method: "DELETE" })
  }
})

test("nhập hàng POS: bấm thẻ NCC → xem đủ hồ sơ; sửa SĐT → thẻ NCC theo ngay", async ({ page }) => {
  const nccCu = await doc("suppliers", NCC)
  try {
    await dangNhap(page)
    await page.goto(`/pos/nhap-hang/moi?ncc=${NCC}`)
    await page.getByRole("button", { name: "Xem thông tin nhà cung cấp: Vinamilk" }).click()
    const hop = page.getByTestId("pos-thong-tin-ncc")
    await expect(hop.getByRole("heading", { name: "Vinamilk" })).toBeVisible()
    for (const chu of ["NCC1", "Đang hợp tác", "Pháp lý & ngân hàng", "Mã số thuế"]) {
      await expect(hop.getByText(chu).first()).toBeVisible()
    }
    await expect(hop.getByRole("link", { name: /Mở hồ sơ nhà cung cấp/ })).toHaveAttribute("target", "_blank")

    await hop.getByRole("button", { name: /Sửa thông tin/ }).click()
    await hop.locator("#ncc-phone").fill("0933333333")
    const moc = (await nhatKy()).length
    await hop.getByRole("button", { name: "Lưu thay đổi" }).click()
    await expect.poll(async () => (await ghiTu(moc, "/rest/v1/suppliers")).length).toBe(1)
    expect((await ghiTu(moc, "/rest/v1/suppliers"))[0].body).toMatchObject({ name: "Vinamilk", phone: "0933333333", code: "NCC1" })

    await expect(hop.getByRole("link", { name: "0933333333" })).toBeVisible()
    await hop.getByRole("button", { name: "Đóng" }).click()
    await expect(page.getByText("NCC1 · 0933333333")).toBeVisible()
  } finally {
    await traVe("suppliers", nccCu)
  }
})

test("xem hoá đơn POS: thẻ khách chỉ đọc vẫn mở được hồ sơ; Huỷ ở biểu mẫu sửa không ghi gì", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/pos/hoa-don/${HOA_DON}`)
  await page.getByRole("button", { name: "Xem thông tin khách hàng: Tạp hoá Cô Ba" }).click()
  const hop = page.getByTestId("pos-thong-tin-khach")
  await expect(hop.getByRole("heading", { name: "Tạp hoá Cô Ba" })).toBeVisible()
  await expect(hop.getByText("0911111111").first()).toBeVisible()
  const moc = (await nhatKy()).length
  await hop.getByRole("button", { name: /Sửa thông tin/ }).click()
  await expect(hop.getByTestId("customer-form")).toBeVisible()
  await hop.getByRole("button", { name: "Hủy" }).click()
  await expect(hop.getByRole("heading", { name: "Tạp hoá Cô Ba" })).toBeVisible()
  expect(await ghiTu(moc, "/rest/v1/customers")).toEqual([])
})
