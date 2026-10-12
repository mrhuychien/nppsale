import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 12/10/2026: "phần cập nhật ảnh kèm định vị cho điểm bán. chưa sửa, cập nhật lại, xoá ảnh + vị trí cũ".
 *   Khách "Tạp hoá Cô Ba" bị ghim vị trí SAI (20.80, 106.60 — chụp ảnh 1 ở nhà). NVBH đứng ở cửa hàng (20.85, 106.68):
 *     · Chụp lại ảnh 1 → ảnh mới thay TẠI CHỖ ô 1, file cũ xoá khỏi kho, vị trí điểm bán đi theo ảnh mới;
 *     · Cập nhật theo chỗ đang đứng → hỏi (dời bao xa) rồi ghi; Xoá vị trí → toạ độ về trống;
 *     · Xoá tấm đã ghim vị trí → hỏi xoá luôn vị trí; dòng ảnh + file đều mất.
 *   File trong kho do API máy chủ xoá (/api/customers/photo-cleanup — trình duyệt không xoá được, mig 207).
 *   Dữ liệu RIÊNG của spec này, trả lại như cũ sau mỗi chốt. Luật: tests/anh-diem-ban-sua-xoa.test.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const ORG_KHAC = "00000000-0000-4000-8000-0000000000a2"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const KHO = "customer-photos"
const ANH_1 = `${ORG}/${KHACH}/1-1000.jpg`
const ANH_2 = `${ORG}/${KHACH}/2-2000.jpg`
const congKhai = (p: string) => `${FAKE}/storage/v1/object/public/${KHO}/${p}`
/** Ảnh PNG 1×1 — đủ để màn nén / đóng dấu rồi tải lên. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64")
const CUA_HANG = { latitude: 20.85, longitude: 106.68, accuracy: 8 }

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
type Db = {
  customers: Array<{ id: string; gps_lat: number | null; gps_lng: number | null }>
  customer_photos: Array<{ id: string; customer_id: string; slot: number; photo_url: string; gps_lat: number | null; gps_lng: number | null }>
  storage_objects?: Array<{ bucket_id: string; name: string }>
}
const docDb = async (): Promise<Db> => (await fetch(`${FAKE}/__db`)).json()
const khach = async () => (await docDb()).customers.find((c) => c.id === KHACH)!
const anhCuaKhach = async () => (await docDb()).customer_photos.filter((p) => p.customer_id === KHACH).sort((a, b) => a.slot - b.slot)
const fileTrongKho = async () => ((await docDb()).storage_objects ?? []).filter((o) => o.bucket_id === KHO).map((o) => o.name).sort()

/** Dữ liệu đầu mỗi chốt: điểm bán ghim ở 20.80, 106.60 (từ ảnh 1), ảnh 2 chụp lệch vài trăm mét. */
async function dungDuLieu(gps: { lat: number | null; lng: number | null } = { lat: 20.8, lng: 106.6 }) {
  await api(`customer_photos?customer_id=eq.${KHACH}`, "DELETE")
  await api(`storage_objects?bucket_id=eq.${KHO}`, "DELETE")
  await api(`customers?id=eq.${KHACH}`, "PATCH", { gps_lat: gps.lat, gps_lng: gps.lng })
  await api("customer_photos", "POST", [
    { id: "cp-1", org_id: ORG, customer_id: KHACH, slot: 1, photo_url: congKhai(ANH_1), taken_at: "2026-09-29T03:00:00Z", gps_lat: 20.8, gps_lng: 106.6, gps_accuracy: 12 },
    { id: "cp-2", org_id: ORG, customer_id: KHACH, slot: 2, photo_url: congKhai(ANH_2), taken_at: "2026-09-29T03:05:00Z", gps_lat: 20.803, gps_lng: 106.6, gps_accuracy: 20 },
  ])
  await api("storage_objects", "POST", [{ bucket_id: KHO, name: ANH_1 }, { bucket_id: KHO, name: ANH_2 }])
}

async function moKhach(page: Page) {
  await page.context().grantPermissions(["geolocation"])
  await page.context().setGeolocation(CUA_HANG)
  await dangNhap(page)
  await page.goto(`/customers/${KHACH}`)
  await expect(page.getByTestId("anh-diem-ban-2")).toBeVisible()
  // Vị trí máy đã đọc xong (dòng trên cùng của khối ảnh).
  await expect(page.getByText("20.85000, 106.68000 (±8m)")).toBeVisible()
}

test.afterAll(async () => {
  await api(`customer_photos?customer_id=eq.${KHACH}`, "DELETE")
  await api(`storage_objects?bucket_id=eq.${KHO}`, "DELETE")
  await api(`customers?id=eq.${KHACH}`, "PATCH", { gps_lat: null, gps_lng: null })
})

test("chụp lại tấm đã ghim vị trí: thay tại chỗ ô 1, xoá file cũ, vị trí điểm bán đi theo ảnh mới", async ({ page }) => {
  await dungDuLieu()
  await moKhach(page)
  const viTri = page.getByTestId("vi-tri-diem-ban")
  await expect(viTri).toContainText("20.80000, 106.60000")
  await expect(page.getByTestId("anh-diem-ban-1")).toContainText("Ghim vị trí điểm bán")
  await expect(page.getByTestId("anh-diem-ban-2")).not.toContainText("Ghim vị trí điểm bán")
  await expect(page.getByText("Bạn đang cách điểm bán khoảng 10,0 km.", { exact: false })).toBeVisible()

  await page.getByLabel("Chụp lại ảnh 1").setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: PNG })
  await expect(page.getByText("Đã thay ảnh 1 và cập nhật vị trí điểm bán").first()).toBeVisible()

  const anh = await anhCuaKhach()
  expect(anh.map((a) => [a.id, a.slot]), "vẫn 2 tấm, ảnh 1 sửa TẠI CHỖ (cùng dòng, cùng ô)").toEqual([["cp-1", 1], ["cp-2", 2]])
  expect(anh[0].photo_url).toMatch(new RegExp(`/${KHO}/${ORG}/${KHACH}/1-\\d+\\.jpg$`))
  expect(anh[0].photo_url).not.toBe(congKhai(ANH_1))
  expect([anh[0].gps_lat, anh[0].gps_lng]).toEqual([20.85, 106.68])
  expect(anh[1].photo_url, "ảnh 2 không bị đụng").toBe(congKhai(ANH_2))
  const kh = await khach()
  expect([kh.gps_lat, kh.gps_lng], "vị trí điểm bán đi theo ảnh mới").toEqual([20.85, 106.68])
  // File cũ xoá khỏi kho (qua API máy chủ, không chặn màn — chờ một nhịp).
  const fileMoi = anh[0].photo_url.split(`/${KHO}/`)[1]
  await expect.poll(fileTrongKho).toEqual([fileMoi, ANH_2].sort())

  await expect(viTri).toContainText("20.85000, 106.68000")
  await expect(page.getByText(/Bạn đang cách điểm bán khoảng/)).toHaveCount(0)
})

test("vị trí điểm bán: cập nhật theo chỗ đang đứng (hỏi dời bao xa) rồi xoá vị trí", async ({ page }) => {
  await dungDuLieu({ lat: 20.85, lng: 106.68 })
  await moKhach(page)
  const viTri = page.getByTestId("vi-tri-diem-ban")
  await expect(viTri).toContainText("20.85000, 106.68000")
  const chiDuong = page.getByRole("link", { name: "Chỉ đường", exact: true })
  await expect(chiDuong).toHaveAttribute("href", "https://www.google.com/maps?q=20.85,106.68")
  // Đánh dấu khối: sửa xong mà trang bật khung chờ cả trang thì khối dựng lại từ đầu (điện thoại nhảy về đầu trang).
  await viTri.evaluate((el) => { el.setAttribute("data-giu-nguyen", "1") })

  // Đi sang chỗ khác ~1,5 km rồi bấm: phải đọc vị trí MỚI, không lấy số đọc lúc mở trang.
  await page.context().setGeolocation({ latitude: 20.86, longitude: 106.69, accuracy: 5 })
  await viTri.getByRole("button", { name: "Cập nhật theo chỗ đang đứng" }).click()
  const hoi = page.getByRole("dialog")
  await expect(hoi).toContainText("Cập nhật vị trí điểm bán?")
  await expect(hoi).toContainText("Dời điểm bán về chỗ bạn đang đứng: 20.86000, 106.69000 (±5m) — cách vị trí cũ khoảng 1,5 km.")
  await hoi.getByRole("button", { name: "Cập nhật vị trí" }).click()
  await expect(page.getByText("Đã cập nhật vị trí điểm bán").first()).toBeVisible()
  expect(await khach()).toMatchObject({ gps_lat: 20.86, gps_lng: 106.69 })
  await expect(viTri).toContainText("20.86000, 106.69000")
  // Đầu trang (nút Chỉ đường) theo vị trí mới — trang đã tải lại — mà khối ảnh KHÔNG dựng lại.
  await expect(chiDuong).toHaveAttribute("href", "https://www.google.com/maps?q=20.86,106.69")
  await expect(viTri).toHaveAttribute("data-giu-nguyen", "1")

  // Sai số quá lớn → không hỏi, không ghi.
  await page.context().setGeolocation({ latitude: 20.9, longitude: 106.7, accuracy: 350 })
  await viTri.getByRole("button", { name: "Cập nhật theo chỗ đang đứng" }).click()
  await expect(page.getByText(/Sai số ±350m — quá lớn để ghim/).first()).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(await khach()).toMatchObject({ gps_lat: 20.86, gps_lng: 106.69 })

  await viTri.getByRole("button", { name: "Xoá vị trí" }).click()
  await expect(page.getByRole("dialog")).toContainText("Xoá vị trí điểm bán?")
  await page.getByRole("dialog").getByRole("button", { name: "Xoá vị trí" }).click()
  await expect(page.getByText("Đã xoá vị trí điểm bán").first()).toBeVisible()
  expect(await khach()).toMatchObject({ gps_lat: null, gps_lng: null })
  await expect(viTri).toContainText("Chưa có")
  await expect(viTri.getByRole("button", { name: "Ghim vị trí đang đứng" })).toBeVisible()
  await expect(viTri.getByRole("button", { name: "Xoá vị trí" })).toHaveCount(0)
  await expect(chiDuong, "hết toạ độ thì không còn nút Chỉ đường").toHaveCount(0)
  await expect(viTri).toHaveAttribute("data-giu-nguyen", "1")
  // Ảnh giữ nguyên.
  expect((await anhCuaKhach()).map((a) => a.id)).toEqual(["cp-1", "cp-2"])
})

test("database từ chối ghi vị trí (RLS: 0 dòng, không lỗi) → báo lỗi, KHÔNG báo đã xoá, màn giữ vị trí cũ", async ({ page }) => {
  await dungDuLieu({ lat: 20.85, lng: 106.68 })
  await moKhach(page)
  await page.route(
    (u) => u.port === "54321" && u.pathname === "/rest/v1/customers",
    (r) => (r.request().method() === "PATCH" ? r.fulfill({ status: 200, contentType: "application/json", body: "[]" }) : r.fallback())
  )
  const viTri = page.getByTestId("vi-tri-diem-ban")
  await viTri.getByRole("button", { name: "Xoá vị trí" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Xoá vị trí" }).click()
  await expect(page.getByText("Không xoá được vị trí").first()).toBeVisible()
  await expect(page.getByText("Đã xoá vị trí điểm bán")).toHaveCount(0)
  await expect(viTri).toContainText("20.85000, 106.68000")
  expect(await khach()).toMatchObject({ gps_lat: 20.85, gps_lng: 106.68 })
})

test("xoá tấm đã ghim vị trí: hỏi xoá luôn vị trí; dòng ảnh + file mất, tấm khác giữ nguyên", async ({ page }) => {
  await dungDuLieu()
  await moKhach(page)

  // Bỏ chọn "xoá luôn vị trí" → chỉ xoá ảnh, vị trí giữ.
  await page.getByTestId("anh-diem-ban-2").getByRole("button", { name: "Xoá" }).click()
  await expect(page.getByRole("dialog")).toContainText("Xoá ảnh 2?")
  await expect(page.getByRole("checkbox"), "ảnh 2 không ghim vị trí — không hỏi xoá vị trí").toHaveCount(0)
  await page.getByRole("dialog").getByRole("button", { name: "Xoá ảnh" }).click()
  await expect(page.getByText("Đã xoá ảnh", { exact: true }).first()).toBeVisible()
  expect((await anhCuaKhach()).map((a) => a.id)).toEqual(["cp-1"])
  expect(await khach()).toMatchObject({ gps_lat: 20.8, gps_lng: 106.6 })
  await expect.poll(fileTrongKho).toEqual([ANH_1])

  await page.getByTestId("anh-diem-ban-1").getByRole("button", { name: "Xoá" }).click()
  const hop = page.getByRole("checkbox", { name: /Xoá luôn vị trí điểm bán/ })
  await expect(hop).toBeChecked()
  await page.getByRole("dialog").getByRole("button", { name: "Xoá ảnh" }).click()
  await expect(page.getByText("Đã xoá ảnh và vị trí điểm bán").first()).toBeVisible()
  expect(await anhCuaKhach()).toEqual([])
  expect(await khach()).toMatchObject({ gps_lat: null, gps_lng: null })
  await expect.poll(fileTrongKho).toEqual([])
  await expect(page.getByTestId("vi-tri-diem-ban")).toContainText("Chưa có")
})

test("API xoá file: chỉ xoá file của đúng đơn vị mà không còn ảnh nào trỏ tới; chưa đăng nhập thì 401", async ({ page, request }) => {
  await dungDuLieu()
  const RAC = `${ORG}/${KHACH}/3-3000.jpg`
  const RAC_2 = `${ORG}/${KHACH}/3-4000.jpg`
  const DON_VI_KHAC = `${ORG_KHAC}/${KHACH}/1-1.jpg`
  await api("storage_objects", "POST", [{ bucket_id: KHO, name: RAC }, { bucket_id: KHO, name: RAC_2 }, { bucket_id: KHO, name: DON_VI_KHAC }])
  try {
    // `request` không mang phiên đăng nhập của trình duyệt.
    const lo = await request.post("/api/customers/photo-cleanup", { data: { paths: [RAC_2] } })
    expect(lo.status()).toBe(401)

    await dangNhap(page)
    const res = await page.request.post("/api/customers/photo-cleanup", { data: { paths: [ANH_1, RAC, DON_VI_KHAC, `${ORG}/../x.jpg`] } })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ removed: [RAC], skipped: [ANH_1, DON_VI_KHAC, `${ORG}/../x.jpg`] })
    expect(await fileTrongKho(), "file đang dùng, file đơn vị khác, file của lượt chưa đăng nhập: còn nguyên").toEqual(
      [ANH_1, ANH_2, RAC_2, DON_VI_KHAC].sort()
    )
  } finally {
    await api(`storage_objects?bucket_id=eq.${KHO}`, "DELETE")
  }
})
