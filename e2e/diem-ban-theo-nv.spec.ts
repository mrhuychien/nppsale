import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * CHỦ NHÀ 27/11/2026: "Phần bán hàng > Điểm bán cần cập nhật thêm lọc theo nhân viên bán hàng để xem nhân viên bán hàng nào
 * còn bao nhiêu điểm chưa cập nhật". Ô "Nhân viên phụ trách" (NV CHÍNH — như bộ lọc Nhân viên của danh sách khách): mỗi người
 * kèm số điểm theo tab đang xem (máy chủ đếm — `khach_thieu_anh_theo_nv`, mig 264), nhiều trước; chọn một người thì danh sách
 * + số trên tab chỉ còn của người ấy (`p_nv`). NVBH không có ô (RLS chỉ còn khách mình). Sổ chưa chạy 264 thì ẩn ô.
 * Hàm giả: e2e/fixture.mjs. Luật: tests/diem-ban-theo-nv.test.ts; SQL thật: scripts/sql/thu-264-diem-ban-theo-nv.sql.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const SAU = { id: "00000000-0000-4000-8000-000000000264", org_id: ORG, full_name: "Lê Thị Sáu 264", role: "sales", is_active: true }
const BAY = { id: "00000000-0000-4000-8000-000000000265", org_id: ORG, full_name: "Trần Văn Bảy 264", role: "sales", is_active: true }
const XONG = { id: "00000000-0000-4000-8000-000000000266", org_id: ORG, full_name: "Ngô Văn Xong 264", role: "sales", is_active: true }
const kh = (id: string, ten: string, gps: boolean) => ({
  id, org_id: ORG, customer_code: id.toUpperCase(), store_name: ten, owner_name: "Thử", phone: `09${id.replace(/\D/g, "").padEnd(8, "7")}`,
  address: null, status: "active", group_id: null, debt: 0, credit_limit: 0, payment_terms: "COD",
  gps_lat: gps ? 20.85 : null, gps_lng: gps ? 106.68 : null,
})
// Sáu: 2 còn thiếu (2 chưa ảnh, 1 chưa vị trí) · Bảy: 3 thiếu cả hai · Xong: đủ ảnh + vị trí.
const KH = [
  kh("nv264-s1", "NV264 Sáu 1", false), kh("nv264-s2", "NV264 Sáu 2", true),
  kh("nv264-b1", "NV264 Bảy 1", false), kh("nv264-b2", "NV264 Bảy 2", false), kh("nv264-b3", "NV264 Bảy 3", false),
  kh("nv264-x1", "NV264 Xong 1", true),
]
const PC = [
  ["nv264-s1", SAU.id], ["nv264-s2", SAU.id], ["nv264-b1", BAY.id], ["nv264-b2", BAY.id], ["nv264-b3", BAY.id], ["nv264-x1", XONG.id],
].map(([customer_id, user_id], i) => ({ id: `pc-nv264-${i}`, customer_id, user_id, role: "primary", status: "active" }))

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const tatRpc = (fn: string[]) =>
  fetch(`${FAKE}/__tat_rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn }) })
type Luot = { method: string; path: string; body: unknown; query?: string; client?: string }
const sau = async (t: number) => ((await nhatKy()) as Luot[]).slice(t).filter((x) => (x.client ?? "").includes("createBrowserClient"))
const goiThieu = (ds: Luot[]) => ds.filter((x) => x.path === "/rest/v1/rpc/khach_thieu_anh").map((x) => x.body as Record<string, unknown>)
const goiDem = (ds: Luot[]) => ds.filter((x) => x.path === "/rest/v1/rpc/khach_thieu_anh_theo_nv")

test.beforeEach(async () => {
  await api("users", "POST", [SAU, BAY, XONG])
  await api("customers", "POST", KH)
  await api("customer_assignments", "POST", PC)
  await api("customer_photos", "POST", [{ id: "anh-nv264-x1", org_id: ORG, customer_id: "nv264-x1", slot: 1, photo_url: "https://x/1.jpg", taken_at: "2026-09-29T03:00:00Z" }])
})
test.afterEach(async () => {
  await tatRpc([])
  await api(`users?id=eq.${OWNER}`, "PATCH", { role: "owner" })
  await api("customer_photos?id=eq.anh-nv264-x1", "DELETE")
  for (const a of PC) await api(`customer_assignments?id=eq.${a.id}`, "DELETE")
  for (const c of KH) await api(`customers?id=eq.${c.id}`, "DELETE")
  for (const u of [SAU, BAY, XONG]) await api(`users?id=eq.${u.id}`, "DELETE")
})

const oNv = (page: Page) => page.getByRole("combobox", { name: "Nhân viên phụ trách" })
const tab = (page: Page, ten: string) => page.getByRole("button", { name: new RegExp(`^${ten}`) })
const nutChup = (page: Page) => page.getByRole("link", { name: "Mở để chụp" })
async function cacLuaChon(page: Page): Promise<string[]> {
  await oNv(page).click()
  const ds = await page.getByRole("option").allTextContents()
  await page.keyboard.press("Escape")
  return ds.map((x) => x.trim())
}

test("chủ NPP: ô Nhân viên kèm số còn thiếu (nhiều trước); chọn một người → danh sách + số trên tab chỉ của người ấy; giữ qua tải lại; số theo tab", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers/missing-photos")
  await expect(oNv(page)).toBeVisible()
  const ds = await cacLuaChon(page)
  expect(ds[0]).toBe("Tất cả nhân viên")
  expect(ds[1]).toMatch(/^Chưa phân công · \d+$/)
  const vt = (s: string) => ds.indexOf(s)
  expect(vt("Trần Văn Bảy 264 · 3"), ds.join(" | ")).toBeGreaterThan(1)
  expect(vt("Lê Thị Sáu 264 · 2"), "nhiều trước: Bảy (3) đứng trên Sáu (2)").toBeGreaterThan(vt("Trần Văn Bảy 264 · 3"))
  expect(vt("Ngô Văn Xong 264 · 0"), "NV đã cập nhật hết vẫn hiện, số 0, đứng sau").toBeGreaterThan(vt("Lê Thị Sáu 264 · 2"))

  const t = (await nhatKy()).length
  await oNv(page).click()
  await page.getByRole("option", { name: "Lê Thị Sáu 264 · 2" }).click()
  await expect(nutChup(page)).toHaveCount(2)
  await expect(nutChup(page).first()).toHaveAttribute("href", "/customers/nv264-s1#anh-diem-ban")
  await expect(tab(page, "Còn thiếu").locator("span")).toHaveText("2")
  await expect(tab(page, "Chưa có ảnh").locator("span")).toHaveText("2")
  await expect(tab(page, "Chưa có vị trí").locator("span")).toHaveText("1")
  expect(goiThieu(await sau(t))).toContainEqual({ p_tab: "all", p_offset: 0, p_limit: 50, p_nv: SAU.id })
  await expect(page).toHaveURL(new RegExp(`[?&]nv=${SAU.id}`))

  // Mở hồ sơ khách rồi lùi / tải lại: vẫn đang xem Sáu.
  await page.reload()
  await expect(oNv(page)).toHaveText("Lê Thị Sáu 264 · 2")
  await expect(nutChup(page)).toHaveCount(2)

  // Đổi tab: số cạnh tên theo tab đang xem.
  await tab(page, "Chưa có vị trí").click()
  await expect(nutChup(page)).toHaveCount(1)
  const dsVt = await cacLuaChon(page)
  expect(dsVt).toContain("Lê Thị Sáu 264 · 1")
  expect(dsVt).toContain("Trần Văn Bảy 264 · 3")

  // Về Tất cả: không gửi p_nv nữa, bỏ khỏi đường dẫn.
  const t2 = (await nhatKy()).length
  await oNv(page).click()
  await page.getByRole("option", { name: "Tất cả nhân viên" }).click()
  await expect.poll(async () => goiThieu(await sau(t2)).length).toBeGreaterThan(0)
  expect(goiThieu(await sau(t2)).every((b) => !("p_nv" in b)), JSON.stringify(goiThieu(await sau(t2)))).toBe(true)
  await expect(page).not.toHaveURL(/[?&]nv=/)
})

test("chọn NV đã cập nhật hết → danh sách trống nói rõ tên người", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/customers/missing-photos?nv=${XONG.id}`)
  await expect(oNv(page)).toHaveText("Ngô Văn Xong 264 · 0")
  await expect(page.getByText("Không còn điểm bán nào thiếu — Ngô Văn Xong 264")).toBeVisible()
  await expect(tab(page, "Còn thiếu").locator("span")).toHaveText("0")
})

test("NVBH: không có ô Nhân viên, không đọc số theo NV; ?nv= dán vào cũng bỏ qua (RLS đã chỉ còn khách mình)", async ({ page }) => {
  await dangNhap(page)
  // Đổi vai SAU khi đăng nhập (đăng nhập vai sales thì về trang chủ NVBH, không qua /orders).
  await api(`users?id=eq.${OWNER}`, "PATCH", { role: "sales" })
  const t = (await nhatKy()).length
  await page.goto(`/customers/missing-photos?nv=${BAY.id}`)
  await expect(tab(page, "Còn thiếu")).toBeVisible()
  await page.waitForLoadState("networkidle")
  await expect(oNv(page)).toHaveCount(0)
  const ds = await sau(t)
  expect(goiDem(ds), "NVBH không gọi khach_thieu_anh_theo_nv").toHaveLength(0)
  expect(goiThieu(ds).length).toBeGreaterThan(0)
  expect(goiThieu(ds).every((b) => !("p_nv" in b)), JSON.stringify(goiThieu(ds))).toBe(true)
})

test("sổ chưa chạy mig 264 (khach_thieu_anh_theo_nv báo PGRST202) → ẩn ô Nhân viên, bỏ ?nv= cũ, danh sách vẫn đủ như trước", async ({ page }) => {
  await tatRpc(["khach_thieu_anh_theo_nv"])
  await dangNhap(page)
  await page.goto(`/customers/missing-photos?nv=${SAU.id}`)
  await expect(page).not.toHaveURL(/[?&]nv=/)
  await expect(oNv(page)).toHaveCount(0)
  await expect(page.getByText(/PGRST202|Could not find the function/)).toHaveCount(0)
  const t = (await nhatKy()).length
  await tab(page, "Chưa có ảnh").click()
  await expect.poll(async () => goiThieu(await sau(t)).length).toBeGreaterThan(0)
  expect(goiThieu(await sau(t)).every((b) => !("p_nv" in b))).toBe(true)
  await expect(nutChup(page).and(page.locator('[href="/customers/nv264-b3#anh-diem-ban"]'))).toBeVisible()
})
