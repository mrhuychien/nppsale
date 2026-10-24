import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → đợt 4: màn Kho hàng (máy tính) mở là kéo CẢ bảng tồn theo khu + CẢ
 *   danh mục hàng kèm đơn vị (≈1 MB) về rồi mới gộp / lọc / tìm / cộng / chia trang trên máy. Nay đọc qua RPC mig 255
 *   (`ton_kho_trang`): máy chủ gộp + lọc + tìm + sắp + chia trang; máy chỉ nhận trang đang xem (20 dòng) kèm tổng số dòng
 *   và TỔNG CỘNG của cả tập đã lọc. Sổ chưa chạy mig 255 (PGRST202) → lùi về cách cũ, màn vẫn đúng.
 *   RPC giả: e2e/fixture.mjs; tắt RPC giả: POST /__tat_rpc (e2e/fake-supabase.mjs). Điện thoại: e2e/kho-mobile-thiet-ke.spec.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
type Luot = { method: string; path: string; body: unknown; query?: string; client?: string }
const tuTrinhDuyet = (x: Luot) => (x.client ?? "").includes("createBrowserClient")
const sau = async (t: number) => ((await nhatKy()) as Luot[]).slice(t).filter(tuTrinhDuyet)
const laRpcTon = (x: Luot) => x.path === "/rest/v1/rpc/ton_kho_trang"
const laBangTonCu = (x: Luot) => x.path === "/rest/v1/v_stock_balance_by_zone"
const laDanhMucCu = (x: Luot) => x.path === "/rest/v1/products" && decodeURIComponent(x.query ?? "").includes("product_units")
const thanBody = (ds: Luot[]) => ds.map((x) => x.body)
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const tatRpc = (fn: string[]) =>
  fetch(`${FAKE}/__tat_rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn }) })

/** 25 mặt hàng còn tồn, SL = số thứ tự, giá trị = SL × 1.000 → tổng SL 325, tổng giá trị 325.000. */
const N = 25
const SP = Array.from({ length: N }, (_, i) => {
  const n = String(i + 1).padStart(2, "0")
  return { id: `zz-ton-${n}`, org_id: ORG, sku: `ZT0${n}`, name: `ZZ tồn ${n}`, base_unit: "hộp", status: "active", sell_price: 1000, cost_price: 500, vat_rate: 0, units: [], price_lists: [] }
})
const TON = SP.map((p, i) => ({ org_id: ORG, product_id: p.id, warehouse_zone: "sale", qty_in_base_uom: i + 1, value: (i + 1) * 1000 }))

test.beforeAll(async () => {
  await api("products", "POST", SP)
  await api("v_stock_balance_by_zone", "POST", TON)
})
test.afterAll(async () => {
  await api(`products?id=in.(${SP.map((p) => p.id).join(",")})`, "DELETE")
  await api(`v_stock_balance_by_zone?org_id=eq.${ORG}`, "DELETE")
})
test.afterEach(async () => {
  await tatRpc([])
})

/** Khối bảng tồn trên máy tính: ô tìm "Tìm theo tên / SKU…" + bảng + thanh trang. */
const khoi = (page: Page) => page.locator("div.space-y-3").filter({ has: page.getByPlaceholder("Tìm theo tên / SKU…") })
const dem = (page: Page) => page.getByTestId("ton-dem-may-tinh")
const dong = (page: Page) => khoi(page).locator("tbody tr")

test("máy tính: mở màn chỉ hỏi RPC trang 20 dòng; số dòng + Tổng cộng là của CẢ 25 mã; không kéo bảng tồn / danh mục hàng", async ({ page }) => {
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/inventory")
  await expect(dem(page)).toContainText("25 sản phẩm")
  await expect(dem(page)).toContainText("325.000")
  await expect(dong(page)).toHaveCount(20)
  await expect(khoi(page).locator("tfoot")).toContainText("325")
  await expect(khoi(page).locator("tfoot")).toContainText("325.000")
  await page.waitForLoadState("networkidle")
  const ds = await sau(t)
  expect(thanBody(ds.filter(laRpcTon))).toContainEqual({ p_tim: null, p_con_ton: true, p_sap: "ten", p_offset: 0, p_limit: 20 })
  expect(ds.filter(laBangTonCu).length, "không kéo cả bảng tồn").toBe(0)
  expect(ds.filter(laDanhMucCu).length, "không kéo cả danh mục hàng").toBe(0)

  // Trang sau: hỏi máy chủ từ dòng 20, 5 dòng còn lại; số dòng + tổng cộng vẫn của cả tập.
  const t2 = (await nhatKy()).length
  await khoi(page).getByRole("button", { name: "Trang sau" }).click()
  await expect(dong(page)).toHaveCount(5)
  await expect(dem(page)).toContainText("25 sản phẩm")
  await expect(khoi(page).locator("tfoot")).toContainText("325.000")
  expect(thanBody((await sau(t2)).filter(laRpcTon))).toContainEqual({ p_tim: null, p_con_ton: true, p_sap: "ten", p_offset: 20, p_limit: 20 })
})

test("tìm gõ xong mới hỏi (p_tim), bỏ 'Chỉ hiện hàng còn tồn' → p_con_ton false và thêm mã hết tồn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory")
  await expect(dem(page)).toContainText("25 sản phẩm")

  const t = (await nhatKy()).length
  await khoi(page).getByPlaceholder("Tìm theo tên / SKU…").fill("tồn 07")
  await expect(dem(page)).toContainText("1 sản phẩm")
  await expect(dem(page)).toContainText("7.000")
  await expect(dong(page)).toHaveCount(1)
  await expect(dong(page).first()).toContainText("ZZ tồn 07")
  const goi = thanBody((await sau(t)).filter(laRpcTon)) as Array<{ p_tim: string | null }>
  expect(goi.some((b) => b.p_tim === "tồn 07"), "gửi chuỗi tìm lên máy chủ").toBe(true)
  expect(goi.filter((b) => b.p_tim !== null && b.p_tim !== "tồn 07"), "không hỏi từng phím").toEqual([])

  await khoi(page).getByPlaceholder("Tìm theo tên / SKU…").fill("")
  await expect(dem(page)).toContainText("25 sản phẩm")
  // Bỏ "còn tồn": thêm mã ĐANG BÁN hết tồn (Sữa hộp, Mì tôm… của sổ giả) — số dòng theo sổ, không theo trang.
  const db = (await (await fetch(`${FAKE}/__db`)).json()) as { products: Array<{ status?: string | null }> }
  const soDangBan = db.products.filter((p) => (p.status ?? "active") === "active").length
  const t2 = (await nhatKy()).length
  await page.getByText("Chỉ hiện hàng còn tồn").click()
  await expect(dem(page)).toContainText(`${soDangBan} sản phẩm`)
  expect(thanBody((await sau(t2)).filter(laRpcTon))).toContainEqual({ p_tim: null, p_con_ton: false, p_sap: "ten", p_offset: 0, p_limit: 20 })
})

test("sổ chưa chạy mig 255 (RPC báo PGRST202) → lùi về cách cũ: đọc đủ hai bảng, số liệu như nhau, chia trang trên máy", async ({ page }) => {
  await tatRpc(["ton_kho_trang"])
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/inventory")
  await expect(dem(page)).toContainText("25 sản phẩm")
  await expect(dem(page)).toContainText("325.000")
  await expect(dong(page)).toHaveCount(20)
  await expect(page.getByText(/Could not find the function|PGRST202/)).toHaveCount(0)
  await page.waitForLoadState("networkidle")
  const ds = await sau(t)
  expect(ds.filter(laRpcTon).length, "đã thử RPC trước").toBeGreaterThan(0)
  expect(ds.filter(laBangTonCu).length, "lùi về đọc cả bảng tồn").toBeGreaterThan(0)
  expect(ds.filter(laDanhMucCu).length, "lùi về đọc cả danh mục hàng").toBeGreaterThan(0)

  const t2 = (await nhatKy()).length
  await khoi(page).getByRole("button", { name: "Trang sau" }).click()
  await expect(dong(page)).toHaveCount(5)
  expect((await sau(t2)).filter(laRpcTon).length, "đường cũ chia trang trên máy, không hỏi lại").toBe(0)
})
