import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "Làm nốt" — hai việc còn lại của đợt tốc độ:
 *   1. POS mở tab mới (tải cứng) không tải lại cả danh mục hàng + bảng giá khi danh mục chưa đổi (số phiên mig 209):
 *      khách + tồn vẫn đọc mới; số phiên tăng (sửa hàng / giá / đơn vị) là tải lại.
 *   2. Danh sách Đơn hàng / Hoá đơn bán không kéo cả sổ khách lúc mở màn — chỉ khi mở khung "Lọc nhanh" có ô Khách hàng.
 */
type Luot = { method: string; path: string; query?: string; client?: string }
const tuTrinhDuyet = (x: Luot) => (x.client ?? "").includes("createBrowserClient")
const sau = async (t: number) => ((await nhatKy()) as Luot[]).slice(t).filter(tuTrinhDuyet)
const laDanhMucHang = (x: Luot) => x.path === "/rest/v1/products" && decodeURIComponent(x.query ?? "").includes("price_lists(")
const laDanhMucKhachPos = (x: Luot) => x.path === "/rest/v1/customers" && decodeURIComponent(x.query ?? "").includes("credit_limit")
const laSoKhachLoc = (x: Luot) => x.path === "/rest/v1/customers" && decodeURIComponent(x.query ?? "").includes("select=id,store_name,owner_name,phone")
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã (SKU|hàng)/i).first()
async function themHang(page: Page, tu: string) {
  await oTim(page).fill(tu)
  await oTim(page).press("Enter")
}
/** Bản lưu IndexedDB đã mang khoá sản phẩm (số phiên) chưa — ghi sau khi tải xong, không chặn màn. */
const banLuuCoKhoa = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number | null>((res) => {
        const r = indexedDB.open("nppsale-offline")
        r.onerror = () => res(null)
        r.onsuccess = () => {
          try {
            const g = r.result.transaction("kv").objectStore("kv").get("order-ref-data")
            g.onsuccess = () => res((g.result as { phien?: number } | undefined)?.phien ?? null)
            g.onerror = () => res(null)
          } catch {
            res(null)
          }
        }
      })
  )

test.describe("POS nhớ danh mục hàng", () => {
  test.afterEach(async () => {
    await api("danh_muc_ban_phien?id=eq.1", "PATCH", { phien: 1 })
  })

  test("mở lại POS: hàng + giá dùng bản lưu khi số phiên chưa đổi (khách vẫn đọc mới); số phiên tăng là tải lại", async ({ page }) => {
    await api("danh_muc_ban_phien?id=eq.1", "PATCH", { phien: 1 })
    await dangNhap(page)
    const dong = page.getByTestId("dong-don")

    // Lần 1: máy chưa có bản lưu → tải đủ.
    let t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await themHang(page, "Sữa")
    await expect(dong).toHaveCount(1)
    expect((await sau(t)).filter(laDanhMucHang).length, "lần đầu tải danh mục hàng").toBeGreaterThan(0)
    await expect.poll(() => banLuuCoKhoa(page), { message: "bản lưu mang số phiên" }).toBe(1)

    // Lần 2 (tab mới = tải cứng): không hỏi bảng sản phẩm; khách vẫn đọc mới; vẫn thêm được hàng.
    t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await themHang(page, "Mì")
    await expect(dong.first()).toContainText("Mì tôm")
    const lan2 = await sau(t)
    expect(lan2.filter(laDanhMucHang).length, "lần 2 KHÔNG tải lại danh mục hàng").toBe(0)
    expect(lan2.filter(laDanhMucKhachPos).length, "khách vẫn đọc mới").toBeGreaterThan(0)
    expect(lan2.some((x) => x.path === "/rest/v1/danh_muc_ban_phien"), "có hỏi số phiên").toBe(true)

    // Sửa hàng / giá → số phiên tăng → mở lại là tải lại danh mục hàng.
    await api("danh_muc_ban_phien?id=eq.1", "PATCH", { phien: 2 })
    t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await themHang(page, "Sữa")
    await expect(dong.first()).toContainText("Sữa hộp")
    expect((await sau(t)).filter(laDanhMucHang).length, "số phiên tăng → tải lại").toBeGreaterThan(0)
  })
})

test.describe("ô lọc khách chỉ tải danh sách khách khi khung lọc mở", () => {
  test.beforeEach(async ({ page }) => {
    const TAT_CA = { orders: ["search", "specialStatus", "date", "customer", "sales", "amount"] }
    await page.addInitScript((tatCa) => {
      window.localStorage.setItem("list-view:orders", JSON.stringify({ filters: ["search", "customer"], knownFilters: tatCa }))
    }, TAT_CA.orders)
  })

  test("Đơn hàng: mở màn không kéo sổ khách; bấm Lọc nhanh mới tải; chọn khách thì lọc theo khách ấy", async ({ page }) => {
    const t = (await nhatKy()).length
    await dangNhap(page)
    await expect(page.locator('[data-doc-list="desktop"]').getByText(/đơn hàng/).first()).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect((await sau(t)).filter(laSoKhachLoc).length, "mở màn không đọc sổ khách").toBe(0)

    await page.getByRole("button", { name: /Lọc nhanh/ }).click()
    await expect.poll(async () => (await sau(t)).filter(laSoKhachLoc).length, { message: "mở khung lọc thì tải" }).toBeGreaterThan(0)
    const o = page.locator("#ord-customer")
    await o.fill("Cô Ba")
    // Mục của ô xổ (nút có dòng phụ "chủ quán · SĐT") — không phải chữ trùng tên trong bảng đơn bên dưới.
    await page.getByRole("button", { name: /^Tạp hoá Cô Ba Cô Ba ·/ }).click()
    await expect
      .poll(async () => (await sau(t)).some((x) => x.path === "/rest/v1/sales_orders" && (x.query ?? "").includes("customer_id=eq.")))
      .toBe(true)
  })

  test("Hoá đơn bán: mở màn không kéo sổ khách", async ({ page }) => {
    await dangNhap(page)
    const t = (await nhatKy()).length
    await page.goto("/sales-invoices")
    await expect(page.locator('[data-doc-list="desktop"]')).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect((await sau(t)).filter(laSoKhachLoc).length).toBe(0)
  })
})
