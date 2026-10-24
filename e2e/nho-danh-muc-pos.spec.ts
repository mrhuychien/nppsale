import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "Làm nốt" — hai việc còn lại của đợt tốc độ:
 *   1. POS mở tab mới (tải cứng) không tải lại cả danh mục hàng + bảng giá khi danh mục chưa đổi (số phiên mig 209):
 *      tồn vẫn đọc mới; số phiên tăng (sửa hàng / giá / đơn vị) là tải lại.
 *   2. Danh sách Đơn hàng / Hoá đơn bán không kéo cả sổ khách lúc mở màn — chỉ khi mở khung "Lọc nhanh" có ô Khách hàng.
 *   Đợt 4 (24/10/2026, mig 254): SỔ KHÁCH cũng nhớ như hàng — số phiên khách `phien_khach` cùng dòng, hỏi một câu; sổ giả
 *   tự tăng số khi ghi khách / nhóm / phân công (như trigger thật).
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
const banLuuCoKhoa = (page: Page, khach = false) =>
  page.evaluate(
    (khach) =>
      new Promise<number | null>((res) => {
        const r = indexedDB.open("nppsale-offline")
        r.onerror = () => res(null)
        r.onsuccess = () => {
          try {
            const g = r.result.transaction("kv").objectStore("kv").get("order-ref-data")
            g.onsuccess = () => {
              const b = g.result as { phien?: number; khach?: { phien?: number } } | undefined
              res((khach ? b?.khach?.phien : b?.phien) ?? null)
            }
            g.onerror = () => res(null)
          } catch {
            res(null)
          }
        }
      }),
    khach
  )
/** Số phiên sổ khách đang có trên sổ giả (các bài trước ghi khách làm nó tăng — so với số thật, không so với 1). */
const soKhach = async (): Promise<number> =>
  Number(((await (await fetch(`${FAKE}/__db`)).json()) as { danh_muc_ban_phien: Array<{ phien_khach: number }> }).danh_muc_ban_phien[0].phien_khach)
const laSoPhien = (x: Luot) => x.path === "/rest/v1/danh_muc_ban_phien"
const laTonKho = (x: Luot) => x.path === "/rest/v1/batches"

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
    expect(lan2.filter(laDanhMucKhachPos).length, "khách cũng dùng bản lưu (số phiên khách chưa đổi — mig 254)").toBe(0)
    expect(lan2.filter(laTonKho).length, "tồn kho vẫn đọc mới").toBeGreaterThan(0)
    expect(lan2.filter(laSoPhien).length, "hỏi số phiên MỘT câu (cả hai số)").toBe(1)

    // Sửa hàng / giá → số phiên tăng → mở lại là tải lại danh mục hàng.
    await api("danh_muc_ban_phien?id=eq.1", "PATCH", { phien: 2 })
    t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await themHang(page, "Sữa")
    await expect(dong.first()).toContainText("Sữa hộp")
    expect((await sau(t)).filter(laDanhMucHang).length, "số phiên tăng → tải lại").toBeGreaterThan(0)
  })

  test("sổ khách: lần 2 dùng bản lưu (chọn khách vẫn được); sửa khách → số phiên khách tăng → tải lại sổ khách, hàng vẫn bản lưu", async ({ page }) => {
    await dangNhap(page)
    const dong = page.getByTestId("dong-don")

    // Lần 1: chưa có bản lưu → tải cả sổ khách; bản lưu mang số phiên khách đang có trên sổ.
    let t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    expect((await sau(t)).filter(laDanhMucKhachPos).length, "lần đầu tải sổ khách").toBeGreaterThan(0)
    const so1 = await soKhach()
    await expect.poll(() => banLuuCoKhoa(page, true), { message: "bản lưu mang số phiên khách" }).toBe(so1)

    // Lần 2 (tab mới = tải cứng): không hỏi bảng khách mà vẫn chọn được khách; hàng cũng từ bản lưu.
    t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await themHang(page, "Mì")
    await expect(dong.first()).toContainText("Mì tôm")
    const lan2 = await sau(t)
    expect(lan2.filter(laDanhMucKhachPos).length, "lần 2 KHÔNG tải lại sổ khách").toBe(0)
    expect(lan2.filter(laDanhMucHang).length, "hàng cũng bản lưu").toBe(0)

    // Sửa một khách (sổ giả tăng số phiên khách như trigger thật) → mở lại là tải lại sổ khách; hàng không đổi vẫn bản lưu.
    await api("customers?id=eq.00000000-0000-4000-8000-0000000000c2", "PATCH", { address: "2 Trần Phú (sửa)" })
    expect(await soKhach(), "ghi khách → số phiên khách tăng").toBe(so1 + 1)
    t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    const lan3 = await sau(t)
    expect(lan3.filter(laDanhMucKhachPos).length, "số phiên khách tăng → tải lại sổ khách").toBeGreaterThan(0)
    expect(lan3.filter(laDanhMucHang).length, "hàng chưa đổi → vẫn bản lưu").toBe(0)
    await expect.poll(() => banLuuCoKhoa(page, true), { message: "bản lưu mang số phiên khách MỚI" }).toBe(so1 + 1)
    await api("customers?id=eq.00000000-0000-4000-8000-0000000000c2", "PATCH", { address: "2 Trần Phú" })
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
