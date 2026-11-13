import { test, expect, type Page, type Route } from "@playwright/test"
import { dangNhap, nhatKy, mocDonDep, tatTacVuDon, theoDoiIn, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/11/2026 — khách NPP gửi ảnh (18:07–18:25): "Loát chậm quá" · "Đơn trên a chưa tạo mới bấm vào xuất hàng mà khi
 *   loát kém a thoát máy rồi vào lại thì nó đã ra hoàn thành" · "Vào tình trạng như trên nếu mà người nào ko quen mà in đơn sẽ
 *   rơi vào quên đơn đó". Bản cũ bỏ chờ `post_invoice` ở giây 10 và báo "Chưa xuất được" — máy chủ vẫn ghi xong, đơn Hoàn thành,
 *   tờ không ai in. Máy chủ chậm dựng bằng cách GIỮ câu `post_invoice` (không bao giờ trả lời) và tự ghi hoá đơn vào sổ giả như
 *   máy chủ thật đã ghi; đồng hồ giả để khỏi chờ thật.
 */

const DON = "o-e2e-cham"
const MA_DON = "DH-CHAM"
const HD = "00000000-0000-4000-8000-00000000c0a1"
const MA_HD = "HD-CHAM-1"
const json = { "content-type": "application/json" }

const docMot = async (bang: string, id: string) =>
  ((await (await fetch(`${FAKE}/rest/v1/${bang}?id=eq.${id}&select=*`)).json()) as Array<Record<string, unknown>>)[0]

/** Đơn mới chưa xuất (chép DH-0001 + dòng sol1 của dữ liệu mẫu). */
async function taoDon(status = "submitted") {
  const don = await docMot("sales_orders", "o-e2e-1")
  const dong = await docMot("sales_order_lines", "sol1")
  await fetch(`${FAKE}/rest/v1/sales_orders`, { method: "POST", headers: json, body: JSON.stringify({ ...don, id: DON, order_code: MA_DON, status }) })
  await fetch(`${FAKE}/rest/v1/sales_order_lines`, { method: "POST", headers: json, body: JSON.stringify({ ...dong, id: "sol-cham", order_id: DON }) })
}

/** "Máy chủ ghi xong": hoá đơn ghi sổ của đơn + đơn sang Hoàn thành — như `post_invoice` thật. */
async function mayChuGhiXong() {
  const mau = await docMot("sales_invoices", "00000000-0000-4000-8000-0000000000f2")
  await fetch(`${FAKE}/rest/v1/sales_invoices`, {
    method: "POST", headers: json,
    body: JSON.stringify({ ...mau, id: HD, invoice_code: MA_HD, order_id: DON, status: "posted", invoice_date: "2026-09-30", created_at: "2026-09-30T03:05:00Z", order: { order_code: MA_DON } }),
  })
  await fetch(`${FAKE}/rest/v1/sales_orders?id=eq.${DON}`, { method: "PATCH", headers: json, body: JSON.stringify({ status: "completed" }) })
}

/** Giữ mọi câu `post_invoice` — máy chủ "đang ghi", không bao giờ trả lời. */
async function giuXuatHang(page: Page) {
  const giu: Route[] = []
  await page.route(/:54321\/rest\/v1\/rpc\/post_invoice/, (route) => { giu.push(route) })
  return giu
}

/** Màn có đang chặn rời trang (đóng tab / tải lại) không — `beforeunload` bị `preventDefault`. */
const chanRoiTrang = (page: Page) =>
  page.evaluate(() => {
    const ev = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(ev)
    return ev.defaultPrevented
  })

/** Số lượt màn hỏi lại sổ "đơn đã có hoá đơn chưa" (`timHoaDonCuaDon`: `limit=3`). */
const soLanHoiLai = async () =>
  (await nhatKy()).filter((r) => r.method === "GET" && r.path.endsWith("/sales_invoices") && (r.query ?? "").includes(`order_id=eq.${DON}`) && (r.query ?? "").includes("limit=3")).length

async function moManXuat(page: Page) {
  await page.goto(`/pos/hoa-don/moi?order=${DON}`)
  await expect(page.getByRole("heading", { name: /Xuất hàng · lập hóa đơn/ })).toBeVisible()
  await expect(page.getByTestId("dong-hoa-don")).toHaveCount(1)
}

const nutXuat = (page: Page) => page.getByRole("button", { name: /Xuất hàng & lập HĐ/ })

test("máy chủ chậm quá 60 giây mà ĐÃ ghi: không báo 'Chưa xuất được', tự kiểm lại sổ → in + mở đúng tờ như thường", async ({ page }) => {
  const donDep = await mocDonDep("sales_orders", "sales_order_lines", "sales_invoices")
  try {
    /* ⚠ Bài đọc màn SAU khi xong (câu báo, địa chỉ tờ) → tắt Tác vụ đơn như mọi bài cần ở lại màn: bật thì in xong POS (mở
       bằng tay) về /pos — chạy đua với các bước đọc bên dưới, lượt đủ bộ 13/11/2026 thua. Đường tự đóng: pos-tac-vu-don. */
    await tatTacVuDon(page)
    await page.clock.install()
    await dangNhap(page)
    await taoDon()
    const giu = await giuXuatHang(page)
    await moManXuat(page)
    const inAn = await theoDoiIn(page)
    const goc = await soLanHoiLai()

    await nutXuat(page).click()
    await expect.poll(() => giu.length).toBe(1)
    expect(await chanRoiTrang(page), "đang ghi sổ mà đóng tab / tải lại không được hỏi lại").toBe(true)

    // Quá 6 giây: nút nói thẳng là máy chủ chậm; nút Huỷ khoá (rời màn là mất câu trả lời + lệnh in).
    await page.clock.fastForward("00:07")
    await expect(page.getByRole("button", { name: "Máy chủ chậm — đang chờ, đừng tắt máy…" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Huỷ", exact: true })).toBeDisabled()

    // Bản cũ báo hỏng ở giây 10 — nay vẫn chờ câu trả lời (chưa bỏ chờ, chưa phải hỏi lại sổ).
    await page.clock.fastForward("00:10")
    await expect(page.getByRole("button", { name: "Máy chủ chậm — đang chờ, đừng tắt máy…" })).toBeVisible()
    await expect(page.getByText("Chưa xuất được")).toHaveCount(0)
    expect((await soLanHoiLai()) - goc, "bỏ chờ trước giây 60").toBe(0)
    expect(await inAn.khung()).toHaveLength(0)

    // Máy chủ ghi xong nhưng câu trả lời không về (mạng / máy chủ nghẽn) — trình duyệt hết chờ ở giây 60.
    await mayChuGhiXong()
    await page.clock.fastForward("00:45")

    await expect.poll(inAn.khung).toContainEqual(expect.stringMatching(new RegExp(`/in/hoa-don/${HD}`)))
    expect(inAn.tabMoi(), "in mà vẫn mở tab mới").toBe(0)
    /* Câu báo TRƯỚC, địa chỉ SAU: câu báo hiện cùng lúc bật in và tự tắt sau 5 giây; `next dev` lúc chạy đủ bộ có khi chuyển
       trang lâu hơn thế — chờ địa chỉ trước là tới lúc đọc câu báo đã tắt. */
    await expect(page.getByText(`Đã xuất hóa đơn ${MA_HD}`, { exact: true })).toBeVisible()
    await expect(page.getByText(/^Máy chủ trả lời chậm — đã kiểm lại sổ: hoá đơn ĐÃ ghi/)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/pos/hoa-don/${HD}$`))
    await expect(page.getByText("Chưa xuất được")).toHaveCount(0)
    expect(giu.length, "không gửi lại câu xuất hàng").toBe(1)
    expect(await chanRoiTrang(page), "xong rồi mà vẫn chặn rời trang").toBe(false)
  } finally {
    await donDep()
  }
})

test("quá 60 giây mà máy chủ CHƯA ghi: hỏi lại sổ vài lượt, không thấy mới báo hỏng + dặn bấm lại an toàn; không in", async ({ page }) => {
  const donDep = await mocDonDep("sales_orders", "sales_order_lines", "sales_invoices")
  try {
    await page.clock.install()
    await dangNhap(page)
    await taoDon()
    const giu = await giuXuatHang(page)
    await moManXuat(page)
    const inAn = await theoDoiIn(page)

    // Nhật ký máy chủ giả dùng chung cả lượt chạy — đếm từ mốc của bài này.
    const goc = await soLanHoiLai()
    const hoiLai = async () => (await soLanHoiLai()) - goc
    await nutXuat(page).click()
    await expect.poll(() => giu.length).toBe(1)
    await page.clock.fastForward("01:01")
    await expect(page.getByRole("button", { name: "Đang kiểm lại hoá đơn…" })).toBeVisible()
    await expect.poll(hoiLai).toBe(1)
    // Các lượt sau cách nhau 5 giây — tua từng giây tới khi đủ 4 lượt.
    await expect
      .poll(async () => {
        await page.clock.fastForward(1000)
        return hoiLai()
      }, { timeout: 20_000 })
      .toBe(4)

    const loi = page.getByText(/thao tác có thể đã được ghi.*Đã kiểm lại sổ: chưa thấy hoá đơn của đơn này — bấm lại để xuất/).first()
    await expect(loi).toBeVisible()
    await expect(page.getByText("Chưa xuất được", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/pos/hoa-don/moi\\?order=${DON}`))
    expect(await inAn.khung()).toHaveLength(0)
    await expect(nutXuat(page)).toBeEnabled()
    expect(await chanRoiTrang(page)).toBe(false)
  } finally {
    await donDep()
  }
})

test("bấm lại khi lần trước ĐÃ ghi: máy chủ báo đơn không còn xuất được → mở tờ đã có + dải nhắc In, KHÔNG tự in", async ({ page }) => {
  const donDep = await mocDonDep("sales_orders", "sales_order_lines", "sales_invoices")
  try {
    await dangNhap(page)
    await taoDon()
    await moManXuat(page)
    // Lần bấm trước (màn tưởng hỏng) đã ghi xong trên máy chủ.
    await mayChuGhiXong()
    await page.route(/:54321\/rest\/v1\/rpc\/post_invoice/, (route) =>
      route.fulfill({
        status: 400, contentType: "application/json",
        body: JSON.stringify({ code: "P0001", message: `ORDER_NOT_INVOICEABLE: đơn ${MA_DON} đang ở trạng thái completed, không xuất hàng được`, details: null, hint: null }),
      })
    )
    const inAn = await theoDoiIn(page)
    await nutXuat(page).click()

    await expect(page).toHaveURL(new RegExp(`/pos/hoa-don/${HD}\\?daXuat=1$`))
    await expect(page.getByText(`Đơn ${MA_DON} đã có hoá đơn ${MA_HD}`, { exact: true })).toBeVisible()
    const nhac = page.getByTestId("nhac-in-hoa-don")
    await expect(nhac).toContainText(`Đơn này đã xuất hoá đơn ${MA_HD}`)
    await expect(nhac).toContainText("CHƯA được in")
    await expect(page.getByText("Chưa xuất được")).toHaveCount(0)
    expect(await inAn.khung(), "tờ có thể đã in — không tự in lần nữa").toHaveLength(0)

    await nhac.getByRole("button", { name: "In hoá đơn" }).click()
    await expect.poll(inAn.khung).toContainEqual(expect.stringMatching(new RegExp(`/in/hoa-don/${HD}`)))
  } finally {
    await donDep()
  }
})

test("mở lại màn Xuất hàng của đơn đã xuất (tải lại trang / trình duyệt mở lại tab) → sang thẳng tờ đã có + nhắc In", async ({ page }) => {
  const donDep = await mocDonDep("sales_orders", "sales_order_lines", "sales_invoices")
  try {
    await dangNhap(page)
    await taoDon()
    await mayChuGhiXong()
    await page.goto(`/pos/hoa-don/moi?order=${DON}`)
    await expect(page).toHaveURL(new RegExp(`/pos/hoa-don/${HD}\\?daXuat=1$`))
    await expect(page.getByTestId("nhac-in-hoa-don")).toContainText(`Đơn này đã xuất hoá đơn ${MA_HD}`)
    await expect(page.getByRole("heading", { name: /Xuất hàng · lập hóa đơn/ })).toHaveCount(0)
    expect((await nhatKy()).filter((r) => r.path.endsWith("/rpc/post_invoice") && (r.body as { p?: { order_id?: string } })?.p?.order_id === DON)).toHaveLength(0)

    // Đối chứng: đơn CÒN xuất được (`submitted` — dữ liệu mẫu lại có sẵn HD-E2E-2 ghi sổ) thì luôn dựng màn xuất.
    await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
    await expect(page.getByRole("heading", { name: /Xuất hàng · lập hóa đơn/ })).toBeVisible()
    await expect(page.getByTestId("nhac-in-hoa-don")).toHaveCount(0)
  } finally {
    await donDep()
  }
})

test("điện thoại: mở lại màn Xuất hàng của đơn đã xuất → nói rõ đã có hoá đơn, nút In + Xem hoá đơn (không dựng màn xuất trống)", async ({ page, baseURL }) => {
  const donDep = await mocDonDep("sales_orders", "sales_order_lines", "sales_invoices")
  try {
    await dangNhap(page)
    await taoDon()
    await mayChuGhiXong()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.context().addCookies([{ name: "npp_kho", value: "hep", url: baseURL! }])
    await page.goto(`/sales-invoices/new?order=${DON}`)
    const nhac = page.getByTestId("nhac-in-hoa-don")
    await expect(nhac).toContainText(`Đơn ${MA_DON} đã xuất hoá đơn ${MA_HD}`)
    await expect(nhac.getByRole("link", { name: "In hoá đơn" })).toHaveAttribute("href", `/sales-invoices/${HD}/print?auto=1`)
    await expect(nhac.getByRole("link", { name: "Xem hoá đơn" })).toHaveAttribute("href", `/sales-invoices/${HD}`)
  } finally {
    await donDep()
  }
})
