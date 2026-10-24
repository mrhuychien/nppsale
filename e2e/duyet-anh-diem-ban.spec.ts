import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 12/10/2026: "Khi nhân viên cập nhật ảnh điểm bán và định vị. Chủ NPP đã phê duyệt thì khi thay đổi hoặc
 *   xoá ảnh+vị trí cần nhà phân phối phê duyệt." · "Khi đi tuyến chỉ cần checkin ko cần chụp ảnh".
 *   "Tạp hoá Cô Ba": ảnh 1 (gốc của vị trí 20.85, 106.68) + ảnh 2.
 *     · Chủ NPP bấm "Duyệt ảnh + vị trí" → khoá; "Bỏ duyệt" → mở lại.
 *     · Đã duyệt: NVBH chụp lại / xoá / dời vị trí → YÊU CẦU chờ duyệt, ảnh / toạ độ chưa đổi; rút được; gửi lại cùng ô
 *       thì yêu cầu cũ bị thay (file của nó xoá khỏi kho).
 *     · Chủ NPP duyệt → áp vào ảnh, file cũ xoá; từ chối (kèm lý do) → giữ nguyên; "Duyệt tất cả".
 *     · Màn "Điểm bán cần cập nhật" có tab "Chờ duyệt" cho người duyệt.
 *     · Check-in ghé thăm không còn ô chụp ảnh.
 *   RPC giả ở e2e/fixture.mjs (luật thật + bộ thử SQL: scripts/sql/thu-244-duyet-anh-diem-ban.sql).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const KHACH_NHOM = "00000000-0000-4000-8000-0000000000c2"
const KHO = "customer-photos"
const ANH_1 = `${ORG}/${KHACH}/1-1000.jpg`
const ANH_2 = `${ORG}/${KHACH}/2-2000.jpg`
const MOI_1 = `${ORG}/${KHACH}/1-5000.jpg`
const congKhai = (p: string) => `${FAKE}/storage/v1/object/public/${KHO}/${p}`
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64")

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, "PATCH", { role })
type Yc = { id: string; customer_id: string; kind: string; slot: number | null; status: string; photo_url: string | null; decision_note?: string | null }
type Db = {
  customers: Array<{
    id: string; gps_lat: number | null; gps_lng: number | null; photo_approved_at?: string | null; photo_approved_by?: string | null
    owner_name?: string | null
  }>
  customer_photos: Array<{ id: string; customer_id: string; slot: number; photo_url: string }>
  customer_photo_requests?: Yc[]
  storage_objects?: Array<{ bucket_id: string; name: string }>
  visit_logs?: Array<Record<string, unknown>>
}
const docDb = async (): Promise<Db> => (await fetch(`${FAKE}/__db`)).json()
const khach = async () => (await docDb()).customers.find((c) => c.id === KHACH)!
const anh = async () => (await docDb()).customer_photos.filter((p) => p.customer_id === KHACH).sort((a, b) => a.slot - b.slot)
const yeuCau = async () => ((await docDb()).customer_photo_requests ?? []).filter((r) => r.customer_id === KHACH)
const fileTrongKho = async () => ((await docDb()).storage_objects ?? []).filter((o) => o.bucket_id === KHO).map((o) => o.name).sort()

async function dungDuLieu(duyet: boolean) {
  await api(`customer_photos?customer_id=eq.${KHACH}`, "DELETE")
  await api(`customer_photo_requests?customer_id=eq.${KHACH}`, "DELETE")
  await api(`customer_photo_requests?customer_id=eq.${KHACH_NHOM}`, "DELETE")
  await api(`storage_objects?bucket_id=eq.${KHO}`, "DELETE")
  await api(`customers?id=eq.${KHACH}`, "PATCH", {
    gps_lat: 20.85, gps_lng: 106.68,
    photo_approved_at: duyet ? "2026-09-29T03:00:00Z" : null, photo_approved_by: duyet ? OWNER : null,
    approver: duyet ? { full_name: "Chủ NPP" } : null,
  })
  await api("customer_photos", "POST", [
    { id: "dp-1", org_id: ORG, customer_id: KHACH, slot: 1, photo_url: congKhai(ANH_1), taken_at: "2026-09-29T03:00:00Z", gps_lat: 20.85, gps_lng: 106.68, gps_accuracy: 8 },
    { id: "dp-2", org_id: ORG, customer_id: KHACH, slot: 2, photo_url: congKhai(ANH_2), taken_at: "2026-09-29T03:05:00Z", gps_lat: 20.851, gps_lng: 106.68, gps_accuracy: 9 },
  ])
  await api("storage_objects", "POST", [{ bucket_id: KHO, name: ANH_1 }, { bucket_id: KHO, name: ANH_2 }])
}

async function moKhach(page: Page, vai: "owner" | "sales" = "owner", viTri = { latitude: 20.8502, longitude: 106.6802, accuracy: 6 }) {
  await page.context().grantPermissions(["geolocation"])
  await page.context().setGeolocation(viTri)
  await dangNhap(page)
  if (vai !== "owner") await doiVai(vai)
  await page.goto(`/customers/${KHACH}`)
  await expect(page.getByTestId("anh-diem-ban-2")).toBeVisible()
  await expect(page.getByTestId("trang-thai-duyet-anh")).toBeVisible()
}

test.afterEach(async () => {
  await doiVai("owner")
})
test.afterAll(async () => {
  await api(`customer_photos?customer_id=eq.${KHACH}`, "DELETE")
  await api(`customer_photo_requests?customer_id=eq.${KHACH}`, "DELETE")
  await api(`customer_photo_requests?customer_id=eq.${KHACH_NHOM}`, "DELETE")
  await api(`storage_objects?bucket_id=eq.${KHO}`, "DELETE")
  await api(`customers?id=eq.${KHACH}`, "PATCH", {
    gps_lat: null, gps_lng: null, photo_approved_at: null, photo_approved_by: null, approver: null, owner_name: "Cô Ba", channel: null,
  })
  await api(`customers?id=eq.${KHACH_NHOM}`, "PATCH", { photo_approved_at: null, photo_approved_by: null, approver: null })
  await api(`visit_logs?customer_id=eq.${KHACH}`, "DELETE")
})

test("chủ NPP duyệt ảnh + vị trí (khoá), sửa thẳng vẫn được, bỏ duyệt mở lại", async ({ page }) => {
  await dungDuLieu(false)
  await moKhach(page)
  const tt = page.getByTestId("trang-thai-duyet-anh")
  await expect(tt).toContainText("Chưa duyệt")
  await tt.getByRole("button", { name: "Duyệt ảnh + vị trí" }).click()
  await expect(page.getByText("Đã duyệt ảnh + vị trí điểm bán").first()).toBeVisible()
  await expect(tt).toContainText("Đã duyệt")
  await expect(tt).toContainText("Chủ NPP · 30/09/2026")
  expect(await khach()).toMatchObject({ photo_approved_by: OWNER })
  // Người duyệt không bị khoá: không có lời nhắc "gửi chủ NPP duyệt", xoá vị trí là xoá thẳng.
  await expect(page.getByText(/sẽ gửi chủ NPP duyệt/)).toHaveCount(0)
  const viTri = page.getByTestId("vi-tri-diem-ban")
  await viTri.getByRole("button", { name: "Xoá vị trí" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Xoá vị trí" }).click()
  await expect(page.getByText("Đã xoá vị trí điểm bán").first()).toBeVisible()
  expect(await khach()).toMatchObject({ gps_lat: null, gps_lng: null })
  expect(await yeuCau()).toEqual([])

  await tt.getByRole("button", { name: "Bỏ duyệt" }).click()
  await expect(page.getByRole("dialog")).toContainText("Nhân viên lại sửa thẳng được ảnh và vị trí")
  await page.getByRole("dialog").getByRole("button", { name: "Bỏ duyệt" }).click()
  await expect(page.getByText("Đã bỏ duyệt — nhân viên sửa thẳng được").first()).toBeVisible()
  await expect(tt).toContainText("Chưa duyệt")
  expect(await khach()).toMatchObject({ photo_approved_at: null, photo_approved_by: null })

  // Chưa duyệt: NVBH sửa THẲNG như cũ — không có nút duyệt, không có lời nhắc gửi duyệt, ghim vị trí là ghi luôn.
  await doiVai("sales")
  await page.reload()
  await expect(tt).toContainText("Chưa duyệt")
  await expect(tt.getByRole("button")).toHaveCount(0)
  await expect(page.getByText(/sẽ gửi chủ NPP duyệt/)).toHaveCount(0)
  await viTri.getByRole("button", { name: "Ghim vị trí đang đứng" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Cập nhật vị trí" }).click()
  await expect(page.getByText("Đã cập nhật vị trí điểm bán").first()).toBeVisible()
  expect(await khach()).toMatchObject({ gps_lat: 20.8502, gps_lng: 106.6802 })
  expect(await yeuCau()).toEqual([])
})

test("NVBH, ảnh đã duyệt: chụp lại / xoá / dời vị trí thành YÊU CẦU — ảnh, toạ độ chưa đổi; rút được; gửi lại thì thay yêu cầu cũ", async ({ page }) => {
  await dungDuLieu(true)
  await moKhach(page, "sales")
  await expect(page.getByText("Ảnh và vị trí đã được duyệt — chụp lại, xoá, dời vị trí sẽ gửi chủ NPP duyệt, chưa đổi ngay.")).toBeVisible()
  await expect(page.getByTestId("trang-thai-duyet-anh").getByRole("button")).toHaveCount(0)

  // Chụp lại ảnh 1 (gốc của vị trí) → 2 yêu cầu: thay ảnh 1 + dời vị trí theo ảnh mới.
  await page.getByLabel("Chụp lại ảnh 1").setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: PNG })
  await expect(page.getByText("Đã gửi yêu cầu: Thay ảnh 1 · Dời vị trí").first()).toBeVisible()
  let ds = (await yeuCau()).filter((r) => r.status === "pending")
  expect(ds.map((r) => r.kind).sort()).toEqual(["photo_replace", "pin_set"])
  const fileYc1 = ds.find((r) => r.kind === "photo_replace")!.photo_url!.split(`/${KHO}/`)[1]
  expect((await anh()).map((p) => p.photo_url), "ảnh CHƯA đổi").toEqual([congKhai(ANH_1), congKhai(ANH_2)])
  expect(await khach()).toMatchObject({ gps_lat: 20.85, gps_lng: 106.68 })
  expect(await fileTrongKho()).toEqual([ANH_1, ANH_2, fileYc1].sort())
  const cho = page.getByTestId("yeu-cau-cho-duyet")
  await expect(cho).toContainText("Chờ duyệt (2)")
  await expect(page.getByTestId("anh-diem-ban-1")).toContainText("Chờ duyệt: Thay ảnh 1")
  await expect(page.getByTestId("vi-tri-diem-ban")).toContainText("Chờ duyệt: Dời vị trí")
  await expect(cho.getByRole("button", { name: "Duyệt" }), "NVBH không duyệt được").toHaveCount(0)

  // File ảnh của yêu cầu đang chờ không bị API dọn file xoá.
  const don = await page.request.post("/api/customers/photo-cleanup", { data: { paths: [fileYc1] } })
  expect(await don.json()).toEqual({ removed: [], skipped: [fileYc1] })

  // Xoá ảnh 2 → hộp hỏi nói rõ là GỬI YÊU CẦU.
  await page.getByTestId("anh-diem-ban-2").getByRole("button", { name: "Xoá" }).click()
  const hoi = page.getByRole("dialog")
  await expect(hoi).toContainText("Ảnh đã được duyệt — gửi yêu cầu xoá để chủ NPP duyệt")
  await hoi.getByRole("button", { name: "Gửi yêu cầu" }).click()
  await expect(page.getByText("Đã gửi yêu cầu: Xoá ảnh 2").first()).toBeVisible()
  expect((await anh()).map((p) => p.id), "ảnh 2 CHƯA bị xoá").toEqual(["dp-1", "dp-2"])

  // Rút yêu cầu xoá ảnh 2.
  await page.getByTestId("yeu-cau-photo_delete-2").getByRole("button", { name: "Rút" }).click()
  await expect(page.getByText("Đã rút yêu cầu: Xoá ảnh 2").first()).toBeVisible()
  expect((await yeuCau()).find((r) => r.kind === "photo_delete")?.status).toBe("cancelled")

  // Xoá vị trí → yêu cầu xoá vị trí THAY yêu cầu dời vị trí đang chờ; toạ độ chưa đổi.
  await page.getByTestId("vi-tri-diem-ban").getByRole("button", { name: "Xoá vị trí" }).click()
  await expect(hoi).toContainText("Vị trí đã được duyệt — gửi yêu cầu xoá để chủ NPP duyệt")
  await hoi.getByRole("button", { name: "Gửi yêu cầu" }).click()
  await expect(page.getByText("Đã gửi yêu cầu: Xoá vị trí").first()).toBeVisible()
  expect(await khach()).toMatchObject({ gps_lat: 20.85, gps_lng: 106.68 })
  ds = (await yeuCau()).filter((r) => r.status === "pending")
  expect(ds.map((r) => r.kind).sort()).toEqual(["photo_replace", "pin_clear"])
  await expect(page.getByTestId("vi-tri-diem-ban")).toContainText("Chờ duyệt: Xoá vị trí")

  // Chụp lại ảnh 1 lần nữa → yêu cầu cũ bị thay, file của nó xoá khỏi kho; yêu cầu vị trí mới thay yêu cầu vị trí cũ.
  await page.getByLabel("Chụp lại ảnh 1").setInputFiles({ name: "moi2.png", mimeType: "image/png", buffer: PNG })
  await expect.poll(async () => (await yeuCau()).filter((r) => r.kind === "photo_replace" && r.status === "cancelled").length).toBe(1)
  ds = (await yeuCau()).filter((r) => r.status === "pending")
  expect(ds.map((r) => r.kind).sort()).toEqual(["photo_replace", "pin_set"])
  const fileYc2 = ds.find((r) => r.kind === "photo_replace")!.photo_url!.split(`/${KHO}/`)[1]
  expect(fileYc2).not.toBe(fileYc1)
  await expect.poll(fileTrongKho).toEqual([ANH_1, ANH_2, fileYc2].sort())

  // Chụp THÊM → yêu cầu thêm ảnh 3; ô 3 giữ cho yêu cầu ấy — hết ô trống, không chụp đè lên được.
  await page.getByLabel("Chụp ảnh mới").setInputFiles({ name: "them.png", mimeType: "image/png", buffer: PNG })
  await expect(page.getByText("Đã gửi yêu cầu: Thêm ảnh 3").first()).toBeVisible()
  expect((await yeuCau()).filter((r) => r.status === "pending" && r.kind === "photo_add").map((r) => r.slot)).toEqual([3])
  expect((await anh()).map((p) => p.id), "chưa thêm ảnh nào").toEqual(["dp-1", "dp-2"])
  await expect(page.getByText("Đã đủ 3 ảnh — bấm Chụp lại dưới tấm muốn thay")).toBeVisible()
})

test("chủ NPP: duyệt thay ảnh (file cũ xoá), từ chối dời vị trí kèm lý do, rồi Duyệt tất cả", async ({ page }) => {
  await dungDuLieu(true)
  await api("storage_objects", "POST", [{ bucket_id: KHO, name: MOI_1 }])
  const goc = { org_id: ORG, customer_id: KHACH, status: "pending", requested_by: OWNER, requested_at: "2026-09-30T02:00:00Z",
    requester: { full_name: "NV Bán Một" }, photo_id: null, slot: null, photo_url: null, taken_at: null, gps_lat: null, gps_lng: null,
    gps_accuracy: null, pin_lat: null, pin_lng: null }
  await api("customer_photo_requests", "POST", [
    { ...goc, id: "yc-thay1", kind: "photo_replace", photo_id: "dp-1", slot: 1, photo_url: congKhai(MOI_1), taken_at: "2026-09-30T02:00:00Z", gps_lat: 20.8502, gps_lng: 106.6802, gps_accuracy: 5 },
    { ...goc, id: "yc-vt", kind: "pin_set", pin_lat: 20.86, pin_lng: 106.69 },
  ])
  await moKhach(page)
  const cho = page.getByTestId("yeu-cau-cho-duyet")
  await expect(cho).toContainText("Chờ duyệt (2)")
  await expect(cho).toContainText("NV Bán Một")
  await expect(page.getByTestId("yeu-cau-pin_set-vt")).toContainText("20.86000, 106.69000 · cách vị trí cũ 1,5 km")

  await page.getByTestId("yeu-cau-photo_replace-1").getByRole("button", { name: "Duyệt" }).click()
  await expect(page.getByText("Đã duyệt 1 yêu cầu").first()).toBeVisible()
  expect((await anh())[0]).toMatchObject({ id: "dp-1", slot: 1, photo_url: congKhai(MOI_1) })
  await expect.poll(fileTrongKho, { message: "file ảnh 1 cũ xoá khỏi kho" }).toEqual([ANH_2, MOI_1].sort())

  await page.getByTestId("yeu-cau-pin_set-vt").getByRole("button", { name: "Từ chối" }).click()
  await page.getByLabel("Lý do từ chối").fill("Sai chỗ")
  await page.getByRole("dialog").getByRole("button", { name: "Từ chối" }).click()
  await expect(page.getByText("Đã từ chối 1 yêu cầu").first()).toBeVisible()
  expect((await yeuCau()).find((r) => r.id === "yc-vt")).toMatchObject({ status: "rejected", decision_note: "Sai chỗ" })
  expect(await khach()).toMatchObject({ gps_lat: 20.85, gps_lng: 106.68 })
  await expect(page.getByTestId("yeu-cau-cho-duyet")).toHaveCount(0)

  // Hai yêu cầu mới → "Duyệt tất cả" một lượt.
  await api("customer_photo_requests", "POST", [
    { ...goc, id: "yc-xoa2", kind: "photo_delete", photo_id: "dp-2", slot: 2 },
    { ...goc, id: "yc-xoavt", kind: "pin_clear" },
  ])
  await page.reload()
  await page.getByTestId("yeu-cau-cho-duyet").getByRole("button", { name: "Duyệt tất cả" }).click()
  await expect(page.getByText("Đã duyệt 2 yêu cầu").first()).toBeVisible()
  expect((await anh()).map((p) => p.id)).toEqual(["dp-1"])
  expect(await khach()).toMatchObject({ gps_lat: null, gps_lng: null })
  await expect.poll(fileTrongKho).toEqual([MOI_1])
})

test("màn Điểm bán cần cập nhật: tab Chờ duyệt cho người duyệt (chưa duyệt / có yêu cầu chờ); NVBH không có tab", async ({ page }) => {
  await dungDuLieu(false)
  await api(`customers?id=eq.${KHACH_NHOM}`, "PATCH", { photo_approved_at: "2026-09-29T03:00:00Z", photo_approved_by: OWNER })
  await api("customer_photo_requests", "POST", [{ id: "yc-nhom", org_id: ORG, customer_id: KHACH_NHOM, kind: "pin_clear", status: "pending",
    requested_by: OWNER, requested_at: "2026-09-30T02:00:00Z", slot: null, photo_url: null }])
  await dangNhap(page)
  await page.goto("/customers/missing-photos")
  await page.getByRole("button", { name: /Chờ duyệt/ }).click()
  const ds = page.getByTestId("ds-cho-duyet-anh")
  // Nhãn đúng DÒNG: Cô Ba chưa duyệt; Minh đã duyệt, chỉ có yêu cầu đổi đang chờ.
  const dong = (ten: string) => ds.locator(":scope > div").filter({ hasText: ten })
  await expect(dong("Tạp hoá Cô Ba")).toContainText("Chưa duyệt ảnh + vị trí")
  await expect(dong("Tạp hoá Cô Ba")).not.toContainText("yêu cầu đổi chờ duyệt")
  await expect(dong("Đại lý Minh")).toContainText("1 yêu cầu đổi chờ duyệt")
  await expect(dong("Đại lý Minh"), "đã duyệt — không gắn nhãn Chưa duyệt").not.toContainText("Chưa duyệt")
  // Mở thẳng khối ảnh điểm bán — nút Duyệt nằm trong đó (chủ nhà 20/10/2026: "mở ra … ở phần chụp ảnh luôn").
  await expect(dong("Tạp hoá Cô Ba").getByRole("link", { name: "Mở để duyệt" })).toHaveAttribute("href", `/customers/${KHACH}#anh-diem-ban`)

  await doiVai("sales")
  await page.reload()
  await expect(page.getByRole("button", { name: /Còn thiếu/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Chờ duyệt/ })).toHaveCount(0)
})

test("form Sửa thông tin: lưu sửa khách KHÔNG gửi lại toạ độ — không đè vị trí vừa được duyệt dời", async ({ page }) => {
  await dungDuLieu(true)
  await api(`customers?id=eq.${KHACH}`, "PATCH", { channel: "T2", owner_name: "Cô Ba" })
  await moKhach(page, "sales")
  await page.getByRole("tab", { name: "Sửa thông tin" }).click()
  const chu = page.locator("#cf-owner")
  await expect(chu).toHaveValue("Cô Ba")
  // Form đang mở thì người duyệt đồng ý yêu cầu dời vị trí (của một NV khác).
  await api(`customers?id=eq.${KHACH}`, "PATCH", { gps_lat: 20.86, gps_lng: 106.69 })
  await chu.fill("Cô Ba Hoa")
  await page.getByRole("button", { name: "Cập nhật", exact: true }).click()
  await expect(page.getByText("Đã cập nhật khách hàng").first()).toBeVisible()
  expect(await khach()).toMatchObject({ owner_name: "Cô Ba Hoa", gps_lat: 20.86, gps_lng: 106.69 })
})

test("đi tuyến: check-in ghé thăm KHÔNG còn ô chụp ảnh — chỉ vị trí + kết quả", async ({ page }) => {
  await dungDuLieu(false)
  await moKhach(page)
  await page.getByRole("button", { name: "Ghé thăm" }).first().click()
  const hop = page.getByRole("dialog")
  await expect(hop).toContainText("Vị trí check-in")
  await expect(hop.getByText("Ảnh cửa hàng")).toHaveCount(0)
  await expect(hop.getByText(/chụp ảnh/i)).toHaveCount(0)
  await expect(hop.locator('input[type="file"]')).toHaveCount(0)
  await expect(hop).toContainText("20.850200, 106.680200")
  await hop.getByRole("button", { name: "Ghi nhận" }).click()
  await expect(page.getByText("Đã ghi nhận ghé thăm: Tạp hoá Cô Ba").first()).toBeVisible()
  const lg = ((await docDb()).visit_logs ?? []).filter((v) => v.customer_id === KHACH)
  expect(lg).toHaveLength(1)
  expect(lg[0]).toMatchObject({ check_in_lat: 20.8502, check_in_lng: 106.6802, result: "no_order" })
  expect(lg[0].photo_url ?? null).toBeNull()
})
