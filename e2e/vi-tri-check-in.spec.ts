import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * CHỦ NHÀ 23/11/2026 (ảnh Ghé thăm "Chị Nga 81": check-in 20.916420, 106.341170 — "Cách điểm bán 75.82 km"; ghim Google
 * Maps 20.848420, 106.678727 Lê Chân — "1 giờ 20 phút"): "Kiểm tra tại sao toạ độ vị trí trên google maps và trên app lại
 * lệch nhau?". Toạ độ check-in là chỗ MÁY đứng, đọc một lần không sai số; khoảng cách đo tới vị trí điểm bán ĐANG LƯU (màn
 * không cho xem); nút Định vị ở form Sửa khách ghi đè vị trí điểm bán ngay, không hỏi, không xét sai số.
 * Luật: `@/lib/customers/vi-tri` (tests/vi-tri-check-in.test.ts). Khách "Tạp hoá Cô Ba", điểm bán lưu ở 20.85, 106.68.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const CUA_HANG = { lat: 20.85, lng: 106.68 }

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
type Db = {
  customers: Array<{ id: string; phone?: string; gps_lat: number | null; gps_lng: number | null }>
  visit_logs?: Array<Record<string, unknown>>
}
const docDb = async (): Promise<Db> => (await fetch(`${FAKE}/__db`)).json()
const khach = async () => (await docDb()).customers.find((c) => c.id === KHACH)!
const luotGhe = async () => ((await docDb()).visit_logs ?? []).filter((v) => v.customer_id === KHACH)

test.beforeEach(async () => {
  await api(`visit_logs?customer_id=eq.${KHACH}`, "DELETE")
  await api(`customers?id=eq.${KHACH}`, "PATCH", { gps_lat: CUA_HANG.lat, gps_lng: CUA_HANG.lng, photo_approved_at: null })
})
test.afterAll(async () => {
  await api(`visit_logs?customer_id=eq.${KHACH}`, "DELETE")
  await api(`customers?id=eq.${KHACH}`, "PATCH", { gps_lat: null, gps_lng: null })
})

async function moKhach(page: Page, viTri: { latitude: number; longitude: number; accuracy: number }, gio?: Date) {
  await page.context().grantPermissions(["geolocation"])
  await page.context().setGeolocation(viTri)
  await dangNhap(page)
  // `dangNhap` ghim đồng hồ của cả bộ (30/09/2026 10:00) — giờ riêng của bài đặt SAU nó.
  if (gio) await page.clock.setFixedTime(gio)
  await page.goto(`/customers/${KHACH}`)
  await expect(page.getByRole("button", { name: "Ghé thăm" }).first()).toBeVisible()
}

test("ghé đúng cửa hàng (GPS ±8m): hiện sai số, vị trí điểm bán đang lưu + bản đồ hai điểm; ngày ghé theo giờ VN", async ({ page }) => {
  // 05:30 sáng 30/09 giờ VN = 22:30 ngày 29/09 giờ UTC — bản cũ ghi `toISOString().slice(0, 10)` → "2026-09-29".
  await moKhach(page, { latitude: 20.8502, longitude: 106.6802, accuracy: 8 }, new Date("2026-09-29T22:30:00Z"))
  await page.getByRole("button", { name: "Ghé thăm" }).first().click()
  const hop = page.getByRole("dialog")
  const viTri = hop.getByTestId("vi-tri-check-in")
  await expect(viTri.getByTestId("toa-do-check-in")).toHaveText("20.850200, 106.680200 (±8m)")
  await expect(viTri.getByRole("link", { name: "Bản đồ" }).first()).toHaveAttribute("href", "https://www.google.com/maps?q=20.8502,106.6802")
  const daLuu = viTri.getByTestId("diem-ban-da-luu")
  await expect(daLuu).toContainText("Điểm bán đã lưu: 20.850000, 106.680000")
  await expect(daLuu.getByRole("link", { name: "Bản đồ" })).toHaveAttribute("href", "https://www.google.com/maps?q=20.85,106.68")
  await expect(viTri).toContainText("Đúng vị trí điểm bán (30m)")
  await expect(viTri.getByTestId("sai-so-lon")).toHaveCount(0)

  await hop.getByRole("button", { name: "Ghi nhận" }).click()
  await expect(page.getByText("Đã ghi nhận ghé thăm: Tạp hoá Cô Ba").first()).toBeVisible()
  const lg = await luotGhe()
  expect(lg).toHaveLength(1)
  expect(lg[0]).toMatchObject({ visit_date: "2026-09-30", check_in_lat: 20.8502, check_in_lng: 106.6802, result: "no_order" })
})

test("ảnh chủ nhà: check-in cách vị trí điểm bán ĐANG LƯU 36 km → 'quá xa' + nhắc vị trí đang lưu có thể sai; Ghi nhận hỏi lại", async ({ page }) => {
  await moKhach(page, { latitude: 20.91642, longitude: 106.34117, accuracy: 15 })
  await page.getByRole("button", { name: "Ghé thăm" }).first().click()
  const hop = page.getByRole("dialog")
  await expect(hop.getByTestId("toa-do-check-in")).toHaveText("20.916420, 106.341170 (±15m)")
  const xa = hop.getByTestId("check-in-xa")
  await expect(xa).toContainText("Cách điểm bán 36,0 km — quá xa")
  await expect(xa).toContainText("vị trí điểm bán đang lưu bị sai")
  await expect(hop.getByTestId("diem-ban-da-luu")).toContainText("20.850000, 106.680000")

  // Huỷ ở hộp hỏi → không ghi gì.
  let hoi = ""
  page.once("dialog", (d) => { hoi = d.message(); void d.dismiss() })
  await hop.getByRole("button", { name: "Ghi nhận" }).click()
  await expect.poll(() => hoi).toBe("Bạn đang cách điểm bán 36,0 km (vị trí đọc sai số ±15m) — vẫn ghi nhận?")
  expect(await luotGhe()).toHaveLength(0)

  page.once("dialog", (d) => void d.accept())
  await hop.getByRole("button", { name: "Ghi nhận" }).click()
  await expect(page.getByText("Đã ghi nhận ghé thăm: Tạp hoá Cô Ba").first()).toBeVisible()
  expect((await luotGhe()).map((v) => [v.check_in_lat, v.check_in_lng])).toEqual([[20.91642, 106.34117]])
})

test("iPhone tắt Vị trí chính xác (ca chủ nhà: app ra điểm phía Hải Dương, Google Maps ở Lê Chân): báo GẦN ĐÚNG + chỉ chỗ bật trên iPhone; không đổ cho vị trí điểm bán; bật xong GPS tự cập nhật; Lấy lại vị trí đọc mới", async ({ browser }) => {
  // Chủ nhà 23/11/2026: "Vị trí check in chính là toạ độ vị trí hiện tại trên app ấy. Nó đang bị lệch so với vị trí hiện tại
  // trên gmaps" — cùng một iPhone; trang web chỉ nhận điểm đại diện của vùng (±km) khi "Trang web Safari" tắt Vị trí chính xác.
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  })
  const page = await ctx.newPage()
  await moKhach(page, { latitude: 20.91642, longitude: 106.34117, accuracy: 4000 })
  await page.getByRole("button", { name: "Ghé thăm" }).first().click()
  const viTri = page.getByRole("dialog").getByTestId("vi-tri-check-in")
  await expect(viTri.getByTestId("toa-do-check-in")).toHaveText("20.916420, 106.341170 (±4,0 km)")
  const ganDung = viTri.getByTestId("sai-so-lon")
  await expect(ganDung).toContainText("Máy chỉ cho vị trí GẦN ĐÚNG (sai số ±4,0 km)")
  await expect(ganDung).toContainText("iPhone: Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang web Safari → bật Vị trí chính xác.")
  await expect(viTri).toContainText("Đang lấy vị trí chính xác hơn")
  // Xa thật (36 km, hơn cả sai số) nhưng lần đọc không tin được → không đổ cho "vị trí điểm bán đang lưu bị sai".
  await expect(viTri.getByTestId("check-in-xa")).toContainText("Cách điểm bán 36,0 km — quá xa")
  await expect(viTri.getByTestId("check-in-xa")).not.toContainText("vị trí điểm bán đang lưu bị sai")
  await expect(viTri.getByText(/Đúng vị trí điểm bán/)).toHaveCount(0)

  // Bật Vị trí chính xác / GPS bắt sóng (máy báo lần đọc tốt hơn trong lúc đang chờ) → hộp theo ngay, thôi chờ.
  await page.context().setGeolocation({ latitude: 20.8501, longitude: 106.6801, accuracy: 6 })
  await expect(viTri.getByTestId("toa-do-check-in")).toHaveText("20.850100, 106.680100 (±6m)")
  await expect(viTri).toContainText("Đúng vị trí điểm bán (15m)")
  await expect(viTri.getByTestId("sai-so-lon")).toHaveCount(0)
  await expect(viTri.getByText("Đang lấy vị trí chính xác hơn")).toHaveCount(0)

  // Đi chỗ khác rồi bấm Lấy lại vị trí → đọc MỚI.
  await page.context().setGeolocation({ latitude: 20.86, longitude: 106.69, accuracy: 5 })
  await viTri.getByRole("button", { name: "Lấy lại vị trí" }).click()
  await expect(viTri.getByTestId("toa-do-check-in")).toHaveText("20.860000, 106.690000 (±5m)")
  await expect(viTri.getByTestId("check-in-xa")).toContainText("Cách điểm bán 1,5 km — quá xa")
  await ctx.close()
})

test("sai số vài trăm mét (GPS chưa bắt sóng): chưa nói được 'Đúng vị trí' — hỏi trước khi ghi nhận", async ({ page }) => {
  await moKhach(page, { latitude: 20.85, longitude: 106.68, accuracy: 400 })
  await page.getByRole("button", { name: "Ghé thăm" }).first().click()
  const hop = page.getByRole("dialog")
  const viTri = hop.getByTestId("vi-tri-check-in")
  await expect(viTri.getByTestId("toa-do-check-in")).toHaveText("20.850000, 106.680000 (±400m)")
  await expect(viTri.getByTestId("sai-so-lon")).toHaveText("Vị trí đọc được chưa chính xác (sai số ±400m) — ra chỗ thoáng, bật GPS rồi bấm Lấy lại vị trí.")
  await expect(viTri).toContainText("Chưa xác định được bạn có ở điểm bán không")
  await expect(viTri.getByText(/Đúng vị trí điểm bán/)).toHaveCount(0)
  let hoi = ""
  page.once("dialog", (d) => { hoi = d.message(); void d.dismiss() })
  await hop.getByRole("button", { name: "Ghi nhận" }).click()
  await expect.poll(() => hoi).toBe(
    "Vị trí đọc được sai số ±400m nên chưa biết bạn có đang ở điểm bán không (cách vị trí điểm bán đã lưu 0m) — vẫn ghi nhận?"
  )
  expect(await luotGhe()).toHaveLength(0)
})

test("Định vị ở form Sửa thông tin: sai số lớn không ghi; sai số tốt thì HỎI (dời bao xa) — Huỷ không đổi, đồng ý mới ghi", async ({ page }) => {
  await moKhach(page, { latitude: 20.9, longitude: 106.7, accuracy: 350 })
  await page.getByRole("tab", { name: "Sửa thông tin" }).click()
  const dinhVi = page.getByRole("button", { name: "Định vị", exact: true })
  const ghiToaDo = async () =>
    (await nhatKy()).filter((r) => r.method === "PATCH" && r.path === "/rest/v1/customers" && (r.body as { gps_lat?: unknown })?.gps_lat !== undefined).length
  const truoc = await ghiToaDo()

  await dinhVi.click()
  await expect(page.getByText("Sai số ±350m — quá lớn để ghim (tối đa 100m). Ra chỗ thoáng rồi thử lại.").first()).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(await khach()).toMatchObject({ gps_lat: 20.85, gps_lng: 106.68 })

  await page.context().setGeolocation({ latitude: 20.86, longitude: 106.69, accuracy: 5 })
  await dinhVi.click()
  const hoi = page.getByRole("dialog")
  await expect(hoi).toContainText("Cập nhật vị trí điểm bán?")
  await expect(hoi).toContainText(
    "Dời điểm bán về chỗ bạn đang đứng: 20.86000, 106.69000 (±5m) — cách vị trí cũ khoảng 1,5 km. Chỉ đồng ý khi bạn đang đứng tại cửa hàng."
  )
  await hoi.getByRole("button", { name: "Hủy" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(await khach()).toMatchObject({ gps_lat: 20.85, gps_lng: 106.68 })
  expect(await ghiToaDo(), "chưa đồng ý thì không gửi câu ghi toạ độ nào").toBe(truoc)

  await dinhVi.click()
  await page.getByRole("dialog").getByRole("button", { name: "Cập nhật vị trí" }).click()
  await expect(page.getByText("Đã lưu tọa độ GPS").first()).toBeVisible()
  expect(await khach()).toMatchObject({ gps_lat: 20.86, gps_lng: 106.69 })
  await expect(page.getByTestId("cf-toa-do")).toHaveText("20.860000, 106.690000 (±5m)")
})

test.describe("tạo khách trên điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const SDT = "0912345670"
  test.beforeEach(async () => {
    await api("sales_routes", "POST", [{ id: "tuyen-vt", org_id: ORG, code: "VT", name: "Tuyến vị trí", is_active: true, sort_order: 1 }])
  })
  test.afterEach(async () => {
    await api("sales_routes?id=eq.tuyen-vt", "DELETE")
    await api(`customers?phone=eq.${SDT}`, "DELETE")
  })

  test("Lấy vị trí hiện tại: sai số lớn không nhận; sai số tốt thì gắn vào khách mới (kèm ±sai số trên nút)", async ({ page }) => {
    await page.context().grantPermissions(["geolocation"])
    await page.context().setGeolocation({ latitude: 20.87, longitude: 106.66, accuracy: 350 })
    await dangNhap(page)
    await page.goto(`/customers/new?sdt=${SDT}`)
    await expect(page.getByTestId("tk-khong-trung")).toBeVisible()
    await page.getByTestId("tk-tao-moi").click()
    await page.getByTestId("tk-shop").fill("Tạp hoá Vị Trí")
    await page.getByTestId("tk-owner").fill("Chị Vị")
    await page.getByTestId("tk-street").fill("81 Dư Hàng")
    await page.locator("#tk-route").click()
    await page.locator("#tk-route").fill("VT")
    await page.getByTestId("search-select-xo").filter({ visible: true }).getByRole("button", { name: /VT · Tuyến vị trí/ }).first().click()

    const nut = page.getByRole("button", { name: /Lấy vị trí hiện tại|Đã lấy vị trí/ })
    await nut.click()
    await expect(page.getByText("Sai số ±350m — quá lớn để ghim (tối đa 100m). Ra chỗ thoáng rồi thử lại.").first()).toBeVisible()
    await expect(nut).toHaveText("Lấy vị trí hiện tại")

    await page.context().setGeolocation({ latitude: 20.8701, longitude: 106.6601, accuracy: 7 })
    await nut.click()
    await expect(nut).toHaveText("Đã lấy vị trí (±7m) · bấm để lấy lại")
    await page.getByTestId("tk-luu").click()
    await expect(page.getByTestId("tk-xong")).toContainText("Đã thêm Tạp hoá Vị Trí")
    const moi = (await docDb()).customers.filter((c) => c.phone === SDT)
    expect(moi.map((c) => [c.gps_lat, c.gps_lng])).toEqual([[20.8701, 106.6601]])
  })
})
