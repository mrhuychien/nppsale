import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { chonKhach, dangNhap, FAKE, mocDonDep, tatTacVuDon, theoDoiIn } from "./helpers"
import { HOA_DON, KHACH, NCC, ORG, OWNER, SUA } from "./fixture.mjs"

/**
 * ⚠ TÁC VỤ ĐƠN — chủ nhà 04/11/2026: "sau khi hoàn thành 1 đơn thì tự đóng pos, cần thì mở lại sau"; 05/11/2026: "In xong
 *   đóng luôn". Luật: src/lib/pos/tac-vu-don.ts.
 *
 * ⚠ CHỈ TAB MỞ BẰNG `window.open` (nút trong app → `openInNewTab`) MỚI TỰ ĐÓNG ĐƯỢC. Trang của `page.goto` là tab "mở bằng
 *   tay" — Chromium lờ `window.close()` → bài ấy đi đường lùi. Nên các bài "đóng" ở đây mở POS từ nút / `window.open`.
 *
 * ⚠ Chromium không giao diện bắn `afterprint` NGAY khi trang in gọi `print()`. Để thử "hộp in còn mở thì chưa đóng", trang
 *   in được thay bằng một trang giả chỉ báo "in xong" khi bài bấm (`giaTrangIn`); một bài đi trọn trang in THẬT.
 */

/** Tờ `post_invoice` của máy chủ giả trả về (`e2e/fixture.mjs`). */
const HD_MOI = "00000000-0000-4000-8000-00000000f004"

async function giaTrangIn(context: BrowserContext, baoNgay: boolean) {
  await context.route(/\/in\/(hoa-don|don-hang|tra-hang)\/[^?]+\?auto=1/, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><meta charset="utf-8"><p>Trang in giả</p><script>
        window.inXong = () => parent.postMessage({ type: "npp:in-xong" }, location.origin);
        ${baoNgay ? "window.inXong();" : ""}
      </script>`,
    })
  )
}

/** Mở POS xuất hàng từ nút "Xuất hàng" ở danh sách đơn — đúng đường của người dùng (`window.open`). */
async function moXuatHangTuDanhSach(page: Page): Promise<Page> {
  await page.goto("/orders")
  const nut = page.locator('[data-doc-list="desktop"]').getByRole("button", { name: "Xuất hàng", exact: true }).first()
  const [pos] = await Promise.all([page.context().waitForEvent("page"), nut.click()])
  await pos.waitForLoadState()
  await expect(pos).toHaveURL(/\/pos\/hoa-don\/moi\?order=o-e2e-1$/)
  await expect(pos.getByTestId("dong-hoa-don")).toHaveCount(1)
  return pos
}

/** Mở một đường POS ở tab mới y như `openInNewTab` (window.open rồi cắt opener). */
async function moTuApp(page: Page, url: string): Promise<Page> {
  const [pos] = await Promise.all([
    page.context().waitForEvent("page"),
    page.evaluate((u) => {
      const w = window.open(u, "_blank")
      if (w) w.opener = null
    }, url),
  ])
  await pos.waitForLoadState()
  return pos
}

const khungInCua = async (pos: Page) => {
  await expect.poll(() => pos.frames().some((f) => f.url().includes("/in/hoa-don/"))).toBe(true)
  return pos.frames().find((f) => f.url().includes("/in/hoa-don/"))!
}

test("xuất hàng mở từ danh sách: hộp in đóng MỚI đóng POS; tab danh sách báo đã xuất", async ({ page }) => {
  await giaTrangIn(page.context(), false)
  await dangNhap(page)
  const pos = await moXuatHangTuDanhSach(page)
  await pos.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
  const khung = await khungInCua(pos)
  expect(khung.url()).toContain(`/in/hoa-don/${HD_MOI}?auto=1`)
  /* Hộp in còn mở (trang in chưa báo xong) → POS phải còn — đóng lúc này là cắt ngang lệnh in. */
  await expect(pos).toHaveURL(new RegExp(`/pos/hoa-don/${HD_MOI}`))
  await pos.waitForTimeout(1200)
  expect(pos.isClosed(), "đóng POS trước khi hộp in đóng").toBe(false)

  const dong = pos.waitForEvent("close")
  await khung.evaluate(() => (window as unknown as { inXong: () => void }).inXong())
  await dong
  await page.bringToFront()
  await expect(page.getByText("Đã xuất hóa đơn HD-E2E-3")).toBeVisible()
  await expect(page.getByText("POS đã in xong và tự đóng.", { exact: true })).toBeVisible()
})

test("trang in THẬT: tờ in xong là POS tự đóng (đủ đường trang in → báo in xong → đóng)", async ({ page }) => {
  /* Máy chủ giả không có dữ liệu cho tờ `post_invoice` trả về — chép tạm HD-E2E-1 thành HD-E2E-3 rồi gỡ. */
  const don = await mocDonDep("sales_invoices", "sales_invoice_lines")
  const chen = (bang: string, rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  try {
    await chen("sales_invoices", [{
      id: HD_MOI, org_id: ORG, invoice_code: "HD-E2E-3", order_id: "o-tvd-khong-dung-chung",
      customer_id: KHACH, status: "posted", subtotal: 900000, vat: 0, total: 900000,
      payment_terms: "COD", due_date: "2026-09-30", notes: null, invoice_date: "2026-09-23",
      stock_entry_id: null, created_at: "2026-09-23T08:00:00Z",
      customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" },
      order: { order_code: "DH-0001" }, sales_user: { full_name: "Chủ NPP" },
      posted_by: OWNER, sales_user_id: OWNER, creator: { full_name: "Chủ NPP" },
    }])
    await chen("sales_invoice_lines", [{
      id: "sil-tvd", invoice_id: HD_MOI, product_id: SUA, quantity: 2, unit_name: "thùng", conversion_factor: 24,
      unit_price: 450000, line_discount: 0, vat_rate: 0, line_total: 900000, is_exchange: false, sort_order: 0,
      order_line_id: null, note: null, product: { name: "Sữa hộp", sku: "SUA1" },
    }])
    await dangNhap(page)
    const pos = await moXuatHangTuDanhSach(page)
    const dong = pos.waitForEvent("close")
    await pos.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
    await dong
    await page.bringToFront()
    await expect(page.getByText("Đã xuất hóa đơn HD-E2E-3")).toBeVisible()
  } finally {
    await don()
  }
  expect(HOA_DON).not.toBe(HD_MOI)
})

test("tắt Tác vụ đơn: xuất hàng in như cũ, POS ở lại trên tờ vừa xuất", async ({ page }) => {
  await tatTacVuDon(page)
  await giaTrangIn(page.context(), true)
  await dangNhap(page)
  const pos = await moXuatHangTuDanhSach(page)
  const inAn = await theoDoiIn(pos)
  await pos.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
  await expect.poll(inAn.khung).toContainEqual(expect.stringMatching(new RegExp(`/in/hoa-don/${HD_MOI}\\?auto=1`)))
  /* Trang in giả báo xong ngay → khung được gỡ (in xong), POS vẫn đứng trên tờ. */
  await expect.poll(() => pos.locator("#npp-khung-in").count()).toBe(0)
  await pos.waitForTimeout(1000)
  expect(pos.isClosed()).toBe(false)
  await expect(pos).toHaveURL(new RegExp(`/pos/hoa-don/${HD_MOI}`))
})

test("POS mở bằng tay (gõ địa chỉ): trình duyệt chặn tự đóng → về Mở chứng từ mới, nói đã xong + Ctrl + W", async ({ page }) => {
  await giaTrangIn(page.context(), true)
  await dangNhap(page)
  await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
  await expect(page.getByTestId("dong-hoa-don")).toHaveCount(1)
  await page.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
  /* ⚠ ĐỌC CÂU BÁO TRƯỚC, RỒI MỚI CHỜ ĐỊA CHỈ: câu báo hiện ở thanh trên NGAY lúc gọi `router.push("/pos")` (thanh nằm ở
     layout POS, không chờ trang mới) và tự tắt sau 6 giây kể từ đó. `next dev` lúc chạy đủ bộ có khi mất hơn 6 giây mới
     chuyển xong trang (POS nạp 3–15 giây ở lượt 13/11/2026) — chờ địa chỉ trước là tới lúc đọc thì câu đã tắt. */
  const bao = page.getByRole("status").filter({ hasText: "Ctrl + W" })
  await expect(bao).toContainText("Đã xuất hóa đơn HD-E2E-3")
  await expect(page).toHaveURL(/\/pos$/)
  await expect(page.getByRole("heading", { name: "Mở chứng từ mới" })).toBeVisible()
})

/* Phiếu nhập NHÁP riêng của spec này (máy chủ giả giữ dữ liệu suốt lượt chạy — đừng dùng phiếu chung). */
const PHIEU_NHAP = "pi-tac-vu-don"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
test.beforeAll(async () => {
  await api("purchase_invoices", "POST", [{
    id: PHIEU_NHAP, org_id: ORG, receipt_code: "PN-TVD", invoice_number: null, invoice_date: "2026-10-12", status: "draft",
    supplier_id: NCC, warehouse_zone: "sale", discount: 0, vat: 0, vat_override: null, total: 300000, notes: null,
    created_at: "2026-10-12T02:00:00Z", supplier: { name: "Vinamilk", code: "NCC1" },
    lines: [{ id: "pil-tvd", product_id: SUA, unit_name: "thùng", quantity: 2, unit_price: 150000, line_discount: 0, vat_rate: 0, conversion_factor: 24, notes: null, sort_order: 1, product: { name: "Sữa hộp", sku: "SUA1" } }],
  }])
})
test.afterAll(async () => {
  await api(`purchase_invoices?id=eq.${PHIEU_NHAP}`, "DELETE")
  await api(`purchase_invoice_lines?invoice_id=eq.${PHIEU_NHAP}`, "DELETE")
})

test("phiếu nhập (chưa có mẫu in): Hoàn thành xong POS đóng ngay, không bật in; tab gốc báo đã xong", async ({ page }) => {
  await dangNhap(page)
  const pos = await moTuApp(page, `/pos/nhap-hang/${PHIEU_NHAP}/sua`)
  await expect(pos.getByLabel("Giá nhập dòng 1")).toHaveValue("150.000")
  const khung: string[] = []
  pos.on("frameattached", (f) => khung.push(f.url()))
  const dong = pos.waitForEvent("close")
  await pos.getByRole("button", { name: "Hoàn thành & nhập kho" }).click()
  await dong
  expect(khung.filter((u) => u.includes("/in/")), "loại chưa có mẫu in mà vẫn bật khung in").toEqual([])
  await page.bringToFront()
  await expect(page.getByText("Đã hoàn thành phiếu nhập — nhập kho và ghi công nợ NCC")).toBeVisible()
  await expect(page.getByText("POS đã tự đóng.", { exact: true })).toBeVisible()
})

/* Chủ nhà 09/11/2026: "Sửa để khi đặt đơn hàng k hiện ra màn in đơn đặt hàng nữa". */
test("đặt đơn: Gửi đơn xong POS đóng ngay, KHÔNG nạp trang in phiếu đặt; tab danh sách báo đã gửi", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  const [pos] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Tạo đơn", exact: true }).click(),
  ])
  await pos.waitForLoadState()
  await expect(pos).toHaveURL(/\/pos\/don-hang\/moi$/)
  await chonKhach(pos, "Tạp hoá Cô Ba")
  const tim = pos.getByPlaceholder(/Tên hàng, mã SKU|KHÁCH TRẢ LẠI/i)
  await tim.fill("Sữa")
  await tim.press("Enter")
  await expect(pos.getByLabel("Đơn giá dòng 1")).toBeVisible()
  const trangIn: string[] = []
  page.context().on("request", (r) => { if (r.url().includes("/in/")) trangIn.push(r.url()) })
  const dong = pos.waitForEvent("close")
  await pos.getByRole("button", { name: /Gửi đơn \(F9\)/ }).click()
  await dong
  expect(trangIn, "gửi đơn mà vẫn nạp trang in phiếu đặt").toEqual([])
  await page.bringToFront()
  await expect(page.getByText("Đã gửi đơn DH-E2E-1")).toBeVisible()
  await expect(page.getByText("POS đã tự đóng.", { exact: true })).toBeVisible()
})

/** Bản lưu tab con CHUNG của mọi tab trình duyệt, như sau một ngày mở POS liên tục: 8 tab cũ. */
const TAB_CU = JSON.stringify({
  tabs: Array.from({ length: 8 }, (_, i) => ({ key: `cu-${i}`, docType: "SO", docId: `o-cu-${i}`, label: `Đơn cũ ${i + 1}`, dirty: false, count: 0 })),
  activeKey: "cu-0",
})

test("bật: POS mới không kéo tab con của các lần trước; tắt thì như cũ (khôi phục bản lưu chung)", async ({ page }) => {
  await page.context().addInitScript((v) => window.localStorage.setItem("npp.pos.tabs.v1", v), TAB_CU)
  await dangNhap(page)
  await page.goto("/pos/don-hang/o-e2e-1")
  await expect(page.getByRole("button", { name: "Lưu (F9)", exact: true })).toBeVisible()
  await expect(page.getByText("Đơn cũ 1"), "kéo theo tab con của tab trình duyệt khác").toHaveCount(0)
  await expect(page.getByText("Đóng bớt tab để mở thêm")).toHaveCount(0)

  await tatTacVuDon(page)
  await page.goto("/pos/don-hang/o-e2e-1")
  await expect(page.getByRole("button", { name: "Lưu (F9)", exact: true })).toBeVisible()
  await expect(page.getByText("Đơn cũ 1")).toBeVisible()
})
