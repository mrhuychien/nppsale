import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: màn Điểm bán cần cập nhật (/customers/missing-photos,
 *   nút "Cập nhật ảnh điểm bán" trên trang chủ NVBH) kéo CẢ sổ khách + cả bảng ảnh về rồi lọc trên máy (đo 4G: 5,9 s).
 *   Nay đọc qua RPC mig 253 (`khach_thieu_anh` / `khach_cho_duyet_anh`): máy chủ lọc + đếm ảnh + phân trang 50 dòng kèm
 *   tổng số; tab khác chỉ hỏi tổng (1 dòng); "Tải thêm" nối trang; sổ chưa chạy mig 253 (PostgREST báo PGRST202) → lùi
 *   về cách cũ, màn vẫn hiện đủ. RPC giả + RLS giả (NVBH chỉ khách mình phụ trách): e2e/fixture.mjs; tắt RPC giả để
 *   chốt đường lùi: POST /__tat_rpc (e2e/fake-supabase.mjs).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
type Luot = { method: string; path: string; body: unknown; query?: string; client?: string }
const tuTrinhDuyet = (x: Luot) => (x.client ?? "").includes("createBrowserClient")
const sau = async (t: number) => ((await nhatKy()) as Luot[]).slice(t).filter(tuTrinhDuyet)
const laRpcThieu = (x: Luot) => x.path === "/rest/v1/rpc/khach_thieu_anh"
const laRpcDuyet = (x: Luot) => x.path === "/rest/v1/rpc/khach_cho_duyet_anh"
/** Đường cũ: kéo cả sổ khách (select có gps_lat…) và cả bảng ảnh. */
const laSoKhachCu = (x: Luot) => x.path === "/rest/v1/customers" && decodeURIComponent(x.query ?? "").includes("gps_lat")
const laBangAnhCu = (x: Luot) => x.path === "/rest/v1/customer_photos"
const thanBody = (ds: Luot[]) => ds.map((x) => x.body)

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const tatRpc = (fn: string[]) =>
  fetch(`${FAKE}/__tat_rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn }) })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, "PATCH", { role })

type Db = {
  customers: Array<{ id: string; status: string; gps_lat: number | null; gps_lng: number | null }>
  customer_photos?: Array<{ customer_id: string }>
}
/** Số điểm bán còn thiếu theo sổ giả — để so với số trên tab / tổng máy chủ. */
async function demThieu() {
  const db: Db = await (await fetch(`${FAKE}/__db`)).json()
  const anh = new Map<string, number>()
  for (const p of db.customer_photos ?? []) anh.set(p.customer_id, (anh.get(p.customer_id) ?? 0) + 1)
  const ds = db.customers.filter((c) => c.status === "active")
  const khongAnh = (c: Db["customers"][number]) => (anh.get(c.id) ?? 0) === 0
  const khongVt = (c: Db["customers"][number]) => c.gps_lat == null || c.gps_lng == null
  return { all: ds.filter((c) => khongAnh(c) || khongVt(c)).length, no_photo: ds.filter(khongAnh).length, no_gps: ds.filter(khongVt).length }
}

/** 60 điểm bán thiếu cả ảnh lẫn vị trí — đẩy sổ qua trần một trang (50). */
const THEM = Array.from({ length: 60 }, (_, i) => ({
  id: `zz-thieu-${String(i + 1).padStart(2, "0")}`, org_id: ORG, customer_code: `ZZ${String(i + 1).padStart(3, "0")}`,
  store_name: `ZZ thiếu ${String(i + 1).padStart(2, "0")}`, owner_name: "Thử", phone: `0988${100000 + i}`, address: null,
  status: "active", group_id: null, debt: 0, credit_limit: 0, payment_terms: "COD", sales_user_id: OWNER, gps_lat: null, gps_lng: null,
}))
let daGieo = false

test.afterEach(async () => {
  await tatRpc([])
  await doiVai("owner")
  await api("customer_assignments?id=eq.pc-thieu-anh", "DELETE")
  if (daGieo) {
    for (const c of THEM) await api(`customers?id=eq.${c.id}`, "DELETE")
    daGieo = false
  }
})

const tab = (page: import("@playwright/test").Page, ten: string) => page.getByRole("button", { name: new RegExp(`^${ten}`) })
const nutChup = (page: import("@playwright/test").Page) => page.getByRole("link", { name: "Mở để chụp" })

test("mở màn: đọc qua RPC khach_thieu_anh (trang 50), KHÔNG kéo sổ khách / bảng ảnh; số trên tab là tổng máy chủ; đổi tab gửi p_tab", async ({ page }) => {
  const dem = await demThieu()
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/customers/missing-photos")
  await expect(nutChup(page).and(page.locator(`[href="/customers/${KHACH}#anh-diem-ban"]`))).toBeVisible()
  await page.waitForLoadState("networkidle")
  const ds = await sau(t)
  const goi = thanBody(ds.filter(laRpcThieu))
  expect(goi).toContainEqual({ p_tab: "all", p_offset: 0, p_limit: 50 })
  expect(goi, "tab khác chỉ hỏi tổng (1 dòng)").toContainEqual({ p_tab: "no_photo", p_offset: 0, p_limit: 1 })
  expect(goi).toContainEqual({ p_tab: "no_gps", p_offset: 0, p_limit: 1 })
  expect(thanBody(ds.filter(laRpcDuyet)), "người duyệt: tổng Chờ duyệt cũng 1 dòng").toContainEqual({ p_offset: 0, p_limit: 1 })
  expect(ds.filter(laSoKhachCu).length, "không kéo cả sổ khách").toBe(0)
  expect(ds.filter(laBangAnhCu).length, "không kéo cả bảng ảnh").toBe(0)
  await expect(tab(page, "Còn thiếu").locator("span")).toHaveText(String(dem.all))
  await expect(tab(page, "Chưa có ảnh").locator("span")).toHaveText(String(dem.no_photo))
  await expect(tab(page, "Chưa có vị trí").locator("span")).toHaveText(String(dem.no_gps))

  const t2 = (await nhatKy()).length
  await tab(page, "Chưa có vị trí").click()
  await expect.poll(async () => thanBody((await sau(t2)).filter(laRpcThieu))).toContainEqual({ p_tab: "no_gps", p_offset: 0, p_limit: 50 })
  await expect(nutChup(page)).toHaveCount(dem.no_gps)

  const t3 = (await nhatKy()).length
  await tab(page, "Chờ duyệt").click()
  await expect.poll(async () => thanBody((await sau(t3)).filter(laRpcDuyet))).toContainEqual({ p_offset: 0, p_limit: 50 })
  await expect(page.getByTestId("ds-cho-duyet-anh").or(page.getByText("Không có điểm bán nào chờ duyệt"))).toBeVisible()
  expect((await sau(t3)).filter(laSoKhachCu).length, "đổi tab vẫn không kéo sổ khách").toBe(0)
})

test("hơn 50 điểm bán thiếu: trang đầu 50 dòng + nút Tải thêm (p_offset 50) nối tiếp, không lặp dòng, hết thì ẩn nút", async ({ page }) => {
  await api("customers", "POST", THEM)
  daGieo = true
  const dem = await demThieu()
  expect(dem.all).toBeGreaterThan(50)
  await dangNhap(page)
  await page.goto("/customers/missing-photos")
  await expect(nutChup(page)).toHaveCount(50)
  await expect(page.getByText(`Đã hiển thị 50 / ${dem.all} điểm bán`)).toBeVisible()
  await expect(tab(page, "Còn thiếu").locator("span")).toHaveText(String(dem.all))

  const t = (await nhatKy()).length
  await page.getByRole("button", { name: `Tải thêm ${dem.all - 50} điểm bán` }).click()
  await expect(nutChup(page)).toHaveCount(dem.all)
  expect(thanBody((await sau(t)).filter(laRpcThieu))).toContainEqual({ p_tab: "all", p_offset: 50, p_limit: 50 })
  await expect(page.getByRole("button", { name: /Tải thêm/ })).toHaveCount(0)
  await expect(page.getByText(/Đã hiển thị/)).toHaveCount(0)
  const hrefs = await nutChup(page).evaluateAll((els) => els.map((e) => e.getAttribute("href")))
  expect(new Set(hrefs).size, "mỗi điểm bán một dòng").toBe(dem.all)
})

test("sổ chưa chạy mig 253 (RPC báo PGRST202) → lùi về cách cũ: màn vẫn hiện đủ, không báo lỗi; đổi tab lọc trên máy, không Tải thêm", async ({ page }) => {
  await tatRpc(["khach_thieu_anh", "khach_cho_duyet_anh"])
  const dem = await demThieu()
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/customers/missing-photos")
  await expect(nutChup(page).and(page.locator(`[href="/customers/${KHACH}#anh-diem-ban"]`))).toBeVisible()
  await expect(page.getByText(/Could not find the function|PGRST202/)).toHaveCount(0)
  await page.waitForLoadState("networkidle")
  const ds = await sau(t)
  expect(ds.filter(laRpcThieu).length, "đã thử RPC trước").toBeGreaterThan(0)
  expect(ds.filter(laSoKhachCu).length, "lùi về đọc cả sổ khách").toBeGreaterThan(0)
  expect(ds.filter(laBangAnhCu).length, "lùi về đọc cả bảng ảnh").toBeGreaterThan(0)
  await expect(tab(page, "Còn thiếu").locator("span")).toHaveText(String(dem.all))
  await expect(tab(page, "Chờ duyệt"), "người duyệt vẫn có tab Chờ duyệt ở đường cũ").toBeVisible()

  const t2 = (await nhatKy()).length
  await tab(page, "Chưa có vị trí").click()
  await expect(nutChup(page)).toHaveCount(dem.no_gps)
  expect((await sau(t2)).filter(laRpcThieu).length, "đường cũ đổi tab không hỏi máy chủ").toBe(0)
  await expect(page.getByRole("button", { name: /Tải thêm/ })).toHaveCount(0)
})

test("NVBH: RPC chạy dưới RLS — chỉ khách mình phụ trách, tổng theo đó; không có tab Chờ duyệt", async ({ page }) => {
  await api("customer_assignments", "POST", [{ id: "pc-thieu-anh", org_id: ORG, customer_id: KHACH, user_id: OWNER, role: "primary", status: "active" }])
  await dangNhap(page)
  await doiVai("sales")
  const t = (await nhatKy()).length
  await page.goto("/customers/missing-photos")
  await expect(nutChup(page)).toHaveCount(1)
  await expect(nutChup(page)).toHaveAttribute("href", `/customers/${KHACH}#anh-diem-ban`)
  await expect(tab(page, "Còn thiếu").locator("span")).toHaveText("1")
  await expect(tab(page, "Chờ duyệt")).toHaveCount(0)
  await page.waitForLoadState("networkidle")
  const ds = await sau(t)
  expect(ds.filter(laRpcThieu).length).toBeGreaterThan(0)
  expect(ds.filter(laRpcDuyet).length, "NVBH không hỏi Chờ duyệt").toBe(0)
  expect(ds.filter(laSoKhachCu).length).toBe(0)
})
