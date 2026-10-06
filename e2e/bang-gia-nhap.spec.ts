import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { SUA } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 06/10/2026: "Làm thêm phần bảng giá nhập hàng -> lưu giá nhập load lại khi làm đơn, nếu giá có thay đổi
 *   thì tự cập nhật thay đổi (vẫn được toàn quyền sửa giá trên đơn nhập)". Phiếu nhập hoàn thành tự ghi giá ở máy chủ
 *   (mig 234 — scripts/sql/thu-234-bang-gia-nhap.sql); ở đây: màn Bảng giá nhập + giá điền sẵn khi lập phiếu.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

/* Thùng sữa có giá thùng RIÊNG 400.000 (khác giá vốn mặc định 15.000 × 24 = 360.000) — lần nhập gần nhất PN-0001. */
const GIA = { id: "ppl-e2e-1", org_id: ORG, product_id: SUA, unit_name: "thùng", price: 400000, effective_date: "2026-09-28", source_invoice_id: "pi1", updated_at: "2026-09-28T03:00:00Z", invoice: { receipt_code: "PN-0001" } }

test.beforeEach(async () => {
  await api("purchase_price_lists?product_id=not.is.null", "DELETE")
  await api("purchase_price_lists", "POST", [GIA])
})
test.afterAll(async () => {
  await api("purchase_price_lists?product_id=not.is.null", "DELETE")
})

const dong = (page: Page, unit: string) => page.locator(`[data-testid="dong-gia-nhap"][data-khoa="${SUA}|${unit}"]`)

test("màn Bảng giá nhập: giá đã lưu theo đơn vị, gợi ý quy đổi cho đơn vị chưa có, sửa tay lưu qua RPC", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/price-list")
  await expect(page.getByRole("heading", { name: "Bảng giá nhập" }).first()).toBeVisible()
  const thung = dong(page, "thùng").getByRole("spinbutton")
  await expect(thung).toHaveValue("400000")
  await expect(dong(page, "thùng")).toContainText("PN-0001")
  // Hộp chưa có giá riêng: gợi ý quy từ giá thùng (400.000 / 24).
  const hop = dong(page, "hộp").getByRole("spinbutton")
  await expect(hop).toHaveValue("")
  await expect(hop).toHaveAttribute("placeholder", "≈ 16.667đ")

  // Lọc "Chưa có giá" thì còn hộp, không còn thùng.
  await page.locator('[data-status-chip="chua"]').first().click()
  await expect(dong(page, "thùng")).toHaveCount(0)
  await expect(dong(page, "hộp")).toHaveCount(1)
  await page.locator('[data-status-chip="all"]').first().click()

  await hop.fill("17000")
  await thung.fill("")
  await page.getByRole("button", { name: /^Lưu \(2\)/ }).first().click()
  await expect(page.getByText(/Đã lưu bảng giá nhập/).first()).toBeVisible()
  const goi = (await nhatKy()).filter((r) => r.method === "POST" && r.path.includes("/rpc/luu_gia_nhap")).at(-1)
  expect((goi?.body as { p_dong: unknown[] }).p_dong).toEqual(
    expect.arrayContaining([
      { product_id: SUA, unit_name: "hộp", price: 17000 },
      { product_id: SUA, unit_name: "thùng", price: null },
    ])
  )
  await expect(dong(page, "hộp").getByRole("spinbutton")).toHaveValue("17000")
  await expect(dong(page, "thùng").getByRole("spinbutton")).toHaveValue("")
})

test.describe("lập phiếu nhập trên điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("giá điền sẵn từ bảng giá nhập (thùng 400.000, không phải giá vốn × 24); vẫn sửa được trên phiếu", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/purchasing/receipts/new")
    await page.getByTestId("chon-ncc").click()
    await page.getByRole("dialog").getByRole("button", { name: /Vinamilk/ }).click()
    const sua = page.getByTestId("the-hang-ncc").filter({ hasText: "Sữa hộp" })
    await sua.getByRole("button", { name: "thùng", exact: true }).click()
    await expect(page.getByTestId("buoc-phieu")).toBeVisible()
    await expect(page.getByTestId("dong-phieu-ncc")).toContainText("400.000đ / thùng")
    await expect(page.getByTestId("tong-phieu-ncc")).toHaveText("400.000đ")
    // Toàn quyền sửa giá trên phiếu.
    await page.getByTestId("dong-phieu-ncc").getByRole("button", { name: /^Sữa hộp/ }).first().click()
    await page.locator("#sua-dong-gia").fill("390000")
    await page.getByRole("button", { name: "Xong" }).click()
    await expect(page.getByTestId("tong-phieu-ncc")).toHaveText("390.000đ")
  })
})

test("POS nhập hàng (máy tính): giá điền sẵn từ bảng giá nhập; đổi ĐVT lấy đúng giá thùng; giá đã gõ thì quy theo hệ số", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/moi")
  const tim = page.getByPlaceholder("Tên hàng, mã hàng, mã vạch…")
  await tim.fill("Sữa")
  await tim.press("Enter")
  const donVi = page.getByLabel("Đơn vị tính dòng 1")
  const gia = page.getByLabel("Giá nhập dòng 1")
  // Hộp chưa có giá riêng → quy từ giá thùng 400.000 / 24.
  await expect(gia).toHaveValue("16.667")
  await donVi.selectOption("thùng")
  await expect(gia, "thùng phải lấy giá thùng trong bảng (400.000), không phải 16.667 × 24").toHaveValue("400.000")
  // Gõ giá theo HĐ NCC rồi đổi đơn vị → quy theo hệ số như cũ, không kéo về giá bảng.
  await gia.fill("")
  await gia.pressSequentially("408000", { delay: 30 })
  await donVi.selectOption("hộp")
  await expect(gia).toHaveValue("17.000")
})
