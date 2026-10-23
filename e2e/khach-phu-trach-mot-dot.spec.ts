import { test, expect, type Route } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm". Đo màn Khách hàng: danh sách → phân công → ngành hàng của người
 *   phụ trách — hai vòng mạng nối đuôi sau danh sách, kể cả trên điện thoại NVBH, nơi dòng "phụ trách" không hiện.
 *   Nay: NVBH điện thoại không đọc; vai khác đọc ba câu cùng lúc (giữ câu phân công lại vẫn thấy hai câu kia đi).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const NV = { id: "00000000-0000-4000-8000-0000000000e7", org_id: ORG, full_name: "Đỗ Thị Tám", role: "sales", is_active: true }
const PC = { id: "pc-e2e-tam", customer_id: KHACH, user_id: NV.id, role: "primary", status: "active", user: { id: NV.id, full_name: NV.full_name, is_active: true } }
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, { method: "PATCH", body: JSON.stringify({ role }) })
const laTrinhDuyet = (h: Record<string, string>) => (h["x-client-info"] ?? "").includes("createBrowserClient")

test.beforeEach(async () => {
  await api("users", { method: "POST", body: JSON.stringify([NV]) })
  await api("customer_assignments", { method: "POST", body: JSON.stringify([PC]) })
})
test.afterEach(async () => {
  await api(`customer_assignments?id=eq.${PC.id}`, { method: "DELETE" })
  await api(`users?id=eq.${NV.id}`, { method: "DELETE" })
})

test.describe("máy tính, chủ NPP", () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test("phân công + ngành hàng + NCC hỏi CÙNG LÚC; cột Phụ trách vẫn hiện đúng người", async ({ page }) => {
    await dangNhap(page)
    await page.waitForLoadState("networkidle")
    const giu: Route[] = []
    await page.route(/:54321\/rest\/v1\/customer_assignments\?/, (r) => void giu.push(r))
    const thay = { nganh: false, ncc: false }
    page.on("request", (r) => {
      const u = r.url()
      if (u.includes("/rest/v1/user_suppliers?")) thay.nganh = true
      if (/\/rest\/v1\/suppliers\?select=id%2Cname$|\/rest\/v1\/suppliers\?select=id,name$/.test(u)) thay.ncc = true
    })
    await page.goto("/customers")
    await expect.poll(() => giu.length, { message: "câu phân công phải đã đi (đang bị giữ)" }).toBeGreaterThan(0)
    // ⚠ 5 giây — dưới hẹn giờ 10 giây của app; đợi lâu hơn thì câu bị giữ tự hết giờ, nối đuôi cũng chạy tiếp.
    await expect.poll(() => thay.nganh, { message: "ngành hàng của NV không đợi phân công", timeout: 5000 }).toBe(true)
    await expect.poll(() => thay.ncc, { message: "danh mục NCC không đợi phân công", timeout: 5000 }).toBe(true)
    for (const r of giu.splice(0)) await r.continue()
    await page.unroute(/:54321\/rest\/v1\/customer_assignments\?/)
    await expect(page.getByText("Đỗ Thị Tám").filter({ visible: true }).first()).toBeVisible()
  })
})

test.describe("điện thoại, NVBH", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("không đọc phân công / ngành hàng — thẻ khách của NVBH không hiện dòng ấy", async ({ page }) => {
    await dangNhap(page)
    await page.waitForLoadState("networkidle")
    await doiVai("sales")
    try {
      const doc: string[] = []
      page.on("request", (r) => {
        const u = r.url()
        if (laTrinhDuyet(r.headers()) && (u.includes("/rest/v1/customer_assignments?") || u.includes("/rest/v1/user_suppliers?"))) doc.push(u)
      })
      await page.goto("/customers")
      await expect(page.getByText("Tạp hoá Cô Ba").filter({ visible: true }).first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(800)
      expect(doc, "NVBH điện thoại đọc thứ không hiện").toEqual([])
      await expect(page.getByText("Đỗ Thị Tám").filter({ visible: true })).toHaveCount(0)
    } finally {
      await doiVai("owner")
    }
  })
})
