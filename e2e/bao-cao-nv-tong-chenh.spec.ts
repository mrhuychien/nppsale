import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 12/10/2026: "Thêm cột tổng chênh lệch = chênh lệch thuần - giảm giá đơn" và "chênh thuần = chênh bán +
 *   chênh trả" (chênh trả âm là phần NPP đã trả cho nhân viên, giờ thu hồi).
 * ⚠ CHỦ NHÀ 03/11/2026: "phần chênh lệch trả tính sai: phải là giá trị âm" · "các cột doanh thu thuần, chênh lệch thuần ->
 *   đổi tên thành doanh thu net, chênh lệch net" · "Lôi cho tao riêng báo cáo này ra ngoài menu BÁO CÁO TỔNG HỢP > Nhân viên
 *   (Lưu ý khi bấm vào từng nhân viên xem được chi tiết như bên báo cáo)".
 *   HD-TC-1 của "NV Tổng Chênh": 3 thùng × 460.000 (bảng giá thùng 450.000) → chênh bán +30.000; tiền hàng 1.380.000, hoá
 *   đơn còn 1.360.000 → giảm giá đơn 20.000. Khách trả 1 thùng ĐÚNG GIÁ đã bán 460.000 → chênh trả (−1) × 10.000 = −10.000
 *   (bản 12/10/2026 ra +10.000 — bài khi ấy dùng phiếu trả 440.000, dưới bảng giá, nên không thấy) → chênh lệch net
 *   +20.000, tổng chênh lệch 0; doanh thu net 1.360.000 − 460.000 = 900.000.
 *   Dữ liệu RIÊNG của spec này. Logic: tests/tong-chenh-lech.test.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const SP = "00000000-0000-4000-8000-0000000000d7"
const NV = "00000000-0000-4000-8000-0000000000b6"
const HD = "hd-tc-1"
const TR = "tr-tc-1"

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeAll(async () => {
  await api("products", "POST", [{
    id: SP, org_id: ORG, sku: "TC1", name: "Sữa thử tổng chênh", base_unit: "hộp", sell_price: 20000, status: "active", primary_supplier_id: null,
    units: [{ unit_name: "thùng", conversion: 24 }],
    price_lists: [{ id: "pl-tc-t", product_id: SP, unit_name: "thùng", group_id: null, price: 450000 }],
  }])
  await api("users", "POST", [{ id: NV, org_id: ORG, full_name: "NV Tổng Chênh", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await api("sales_invoices", "POST", [{
    id: HD, org_id: ORG, invoice_code: "HD-TC-1", order_id: null, customer_id: KHACH, status: "posted",
    subtotal: 1360000, vat: 0, total: 1360000, payment_terms: "COD", due_date: "2026-09-25", invoice_date: "2026-09-25",
    created_at: "2026-09-25T03:00:00Z", sales_user_id: NV, posted_by: OWNER,
  }])
  await api("sales_invoice_lines", "POST", [{
    id: "sil-tc-1", invoice_id: HD, product_id: SP, quantity: 3, unit_name: "thùng", conversion_factor: 24, unit_price: 460000,
    line_discount: 0, vat_rate: 0, line_total: 1380000, is_exchange: false, sort_order: 0, order_line_id: null,
  }])
  await api("returns", "POST", [{
    id: TR, org_id: ORG, customer_id: KHACH, invoice_id: HD, credit_note_amount: 460000, created_at: "2026-09-26T04:00:00Z",
    revenue_date: "2026-09-26", sales_user_id: NV, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed",
  }])
  await api("return_lines", "POST", [{ id: "rl-tc-1", return_id: TR, product_id: SP, unit_name: "thùng", quantity: 1, unit_price: 460000, line_total: 460000, is_exchange: false }])
})
test.afterAll(async () => {
  await api(`return_lines?return_id=eq.${TR}`, "DELETE")
  await api(`returns?id=eq.${TR}`, "DELETE")
  await api(`sales_invoice_lines?invoice_id=eq.${HD}`, "DELETE")
  await api(`sales_invoices?id=eq.${HD}`, "DELETE")
  await api(`users?id=eq.${NV}`, "DELETE")
  await api(`products?id=eq.${SP}`, "DELETE")
})

/** Ô của dòng nhân viên theo TÊN cột (bảng có ô đầu mở chi tiết — đếm cột tay dễ lệch). */
async function oCuaDong(page: Page) {
  const dong = page.locator("tr", { hasText: "NV Tổng Chênh" }).first()
  const tieuDe = (await dong.locator("xpath=ancestor::table[1]").locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase())
  return { dong, tieuDe, o: (ten: string) => dong.locator("td").nth(tieuDe.indexOf(ten.toLowerCase())) }
}

async function kiemSoCuaNv(page: Page) {
  const { tieuDe, o } = await oCuaDong(page)
  expect(tieuDe).not.toContain("doanh thu thuần")
  expect(tieuDe).not.toContain("chênh lệch thuần")
  expect(tieuDe.indexOf("tổng chênh lệch")).toBe(tieuDe.indexOf("chênh lệch net") + 1)
  await expect(o("Chênh lệch bán")).toHaveText("+30.000đ")
  await expect(o("Giảm giá đơn")).toHaveText("-20.000đ")
  await expect(o("Giá trị trả")).toHaveText("-460.000đ")
  // Trả đúng giá đã bán trên bảng giá → ÂM (thu hồi phần chênh của thùng ấy).
  await expect(o("Chênh lệch trả")).toHaveText("−10.000đ")
  await expect(o("Doanh thu net")).toHaveText("900.000đ")
  await expect(o("Chênh lệch net")).toHaveText("+20.000đ")
  await expect(o("Tổng chênh lệch")).toHaveText("0")
}

test("Báo cáo › Nhân viên › Hàng bán theo nhân viên: chênh trả ÂM khi trả đúng giá đã bán; cột Doanh thu net / Chênh lệch net", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/employees")
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: "Hàng bán theo nhân viên", exact: true }).click()
  await expect(page.locator("th", { hasText: "Tổng chênh lệch" }).first()).toBeVisible()
  await kiemSoCuaNv(page)
})

test("Báo cáo tổng hợp › Nhân viên: mở từ menu, chỉ Hàng bán theo nhân viên, cùng số; bấm nhân viên ra chi tiết như báo cáo", async ({ page }) => {
  /* Chủ nhà 03/11/2026: "Kiểm tra lại tại sao phần báo cáo lại load lâu thế" — báo cáo đọc MỘT LƯỢT (`bao_cao_so_ban`) và báo
     thời gian nạp về /api/do-nap. Playwright không đọc được thân sendBeacon → tắt nó, app đi đường fetch(keepalive). */
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "sendBeacon", { value: undefined, configurable: true })
  })
  await dangNhap(page)
  const cauKho: string[] = []
  const cauDong: string[] = []
  const motLuot: string[] = []
  page.on("request", (r) => {
    const u = r.url()
    if (/\/rest\/v1\/stock_entr/.test(u)) cauKho.push(u)
    if (/\/rest\/v1\/(sales_invoice_lines|sales_invoices|return_lines|returns)\?/.test(u)) cauDong.push(u)
    if (u.includes("/rest/v1/rpc/bao_cao_so_ban")) motLuot.push(r.method())
  })
  const baoNap = page.waitForRequest((r) => r.url().endsWith("/api/do-nap") && r.method() === "POST" && (r.postData() ?? "").includes("bc-hang-ban-nv"))
  await page.getByRole("button", { name: /Báo cáo tổng hợp/ }).click()
  await page.locator('a[href="/bao-cao/nhan-vien"]').first().click()
  await expect(page).toHaveURL(/\/bao-cao\/nhan-vien$/)
  await expect(page.getByRole("heading", { name: "Hàng bán theo nhân viên", level: 1 })).toBeVisible()
  // Một mối quan tâm duy nhất → không có ô chọn.
  await expect(page.getByRole("combobox", { name: "Mối quan tâm" })).toHaveCount(0)
  await expect(page.locator("th", { hasText: "Tổng chênh lệch" }).first()).toBeVisible()
  await kiemSoCuaNv(page)

  // Bấm nhân viên → chi tiết mặt hàng × đơn vị như bên báo cáo.
  await page.locator("tr", { hasText: "NV Tổng Chênh" }).first().click()
  const ct = page.getByTestId("nv-hang-ban-chi-tiet")
  await expect(ct).toBeVisible()
  const tdCt = (await ct.locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase())
  for (const c of ["bảng giá (theo đvt)", "giá bán (theo đvt)", "chênh lệch trả", "sl thực bán", "doanh thu net", "chênh lệch net"]) expect(tdCt).toContain(c)
  const thung = ct.locator("tbody tr", { hasText: "thùng" }).first()
  await expect(thung.locator("td").nth(tdCt.indexOf("chênh lệch trả"))).toHaveText("−10.000đ")
  await expect(thung.locator("td").nth(tdCt.indexOf("sl thực bán"))).toHaveText("2")
  await expect(thung.locator("td").nth(tdCt.indexOf("chênh lệch net"))).toHaveText("+20.000đ")

  // Một lượt: không đọc phiếu kho, không đọc từng bảng hoá đơn / dòng / phiếu trả; hàm đi GET (`next dev` chạy effect hai lần).
  expect(cauKho, "đọc phiếu kho thừa").toEqual([])
  expect(cauDong, "còn đọc từng bảng").toEqual([])
  expect(motLuot.length).toBeGreaterThan(0)
  expect(Array.from(new Set(motLuot))).toEqual(["GET"])
  // Bản tóm tắt thời gian nạp (nhật ký `[bao-cao-nap]`): đúng màn, có số hoá đơn, có các câu lâu nhất (chỉ đường dẫn bỏ tham số,
  // cách gọi, ms) — không mang dữ liệu. (Câu nào lâu nhất tuỳ máy — sổ giả trả câu một lượt rất nhanh, không chốt thứ tự.)
  const bao = JSON.parse((await baoNap).postData() ?? "{}")
  expect(bao).toMatchObject({ man: "bc-hang-ban-nv", loi: null })
  expect(bao.dong).toBeGreaterThan(0)
  expect(bao.soCau).toBeGreaterThan(0)
  expect(bao.cham.length).toBeGreaterThan(0)
  for (const c of bao.cham as Array<{ p: string; m: string; ms: number }>) {
    expect(c.p).toMatch(/^\/[^?]*$/)
    expect(typeof c.ms).toBe("number")
  }
  expect(JSON.stringify(bao)).not.toContain("NV Tổng Chênh")
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })

  /* Các màn Báo cáo tổng hợp khác tự vẽ đầu trang xanh + ☰ nên ẩn app bar chuẩn; màn Nhân viên là báo cáo Nhân viên —
     ẩn theo là mất cả menu lẫn nút lùi. */
  test("Báo cáo tổng hợp › Nhân viên còn app bar có ☰, mở được menu; vẫn ra số của nhân viên", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/bao-cao/nhan-vien")
    const bar = page.locator("header").first()
    await expect(bar.getByRole("button", { name: "Mở menu" })).toBeVisible()
    await expect(page.getByText("NV Tổng Chênh").first()).toBeVisible()
    await bar.getByRole("button", { name: "Mở menu" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
  })
})

test("NVBH không có quyền Báo cáo nhân viên: không thấy mục, gõ thẳng đường dẫn cũng bị đẩy ra", async ({ page }) => {
  await dangNhap(page)
  await api(`users?id=eq.${OWNER}`, "PATCH", { role: "sales" })
  try {
    await page.goto("/bao-cao/nhan-vien")
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.locator('a[href="/bao-cao/nhan-vien"]')).toHaveCount(0)
  } finally {
    await api(`users?id=eq.${OWNER}`, "PATCH", { role: "owner" })
  }
})
