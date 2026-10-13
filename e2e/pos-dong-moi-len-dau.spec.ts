import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 13/10/2026:
 *   1. "xử lý phần pos : thêm sản phẩm thì sản phẩm xuất hiện đầu danh sách luôn" — mọi màn POS: dòng vừa thêm lên ĐẦU;
 *      gộp dòng trùng (bật sẵn ở màn đơn) thì dòng được cộng số lượng cũng lên đầu. Thứ tự lưu = thứ tự trên màn.
 *   2. "kiểm tra lại phần sửa hóa đơn, khi phần đổi trả dài quá ko có scroll luôn ? kẹt cứng chỉ hiện hàng đổi trả không
 *      hiện phiếu đi" — khối hàng đổi trả có trần chiều cao, dòng cuộn trong khối; bảng hàng đi luôn còn chỗ.
 */
const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã (SKU|hàng)|KHÁCH TRẢ LẠI/i).first()
const them = async (page: Page, tu: string) => {
  await oTim(page).fill(tu)
  await oTim(page).press("Enter")
}
const soLuong = (page: Page, nhan: string) => page.getByRole("button", { name: new RegExp(`^${nhan} — đang là`) })

test("đơn hàng: món vừa thêm lên đầu; thêm lại món đã có (gộp dòng trùng) thì dòng ấy lên đầu, SL +1; lưu đúng thứ tự trên màn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/don-hang/moi")
  await chonKhach(page, "Tạp hoá Cô Ba")
  const dong = page.getByTestId("dong-don")
  await them(page, "Sữa")
  await expect(dong).toHaveCount(1)
  await them(page, "Mì")
  await expect(dong).toHaveCount(2)
  await expect(dong.first()).toContainText("Mì tôm")
  await expect(dong.nth(1)).toContainText("Sữa hộp")
  // Thêm lại Sữa: gộp vào dòng Sữa (bật sẵn) — dòng ấy lên đầu, 2 hộp.
  await them(page, "Sữa")
  await expect(dong).toHaveCount(2)
  await expect(dong.first()).toContainText("Sữa hộp")
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("2")
  await page.getByRole("button", { name: "Xong" }).click()

  await page.getByRole("button", { name: /Lưu nháp/ }).click()
  const cuaToi = async () =>
    (await nhatKy()).filter((r) => r.path.endsWith("/rpc/create_order_with_lines")).at(-1)
  await expect.poll(async () => !!(await cuaToi())).toBe(true)
  const p = ((await cuaToi())!.body as { p: { lines: Array<Record<string, unknown>> } }).p
  expect(p.lines.map((l) => [l.product_id, Number(l.quantity)]), "lưu theo thứ tự trên màn").toEqual([
    ["00000000-0000-4000-8000-0000000000d1", 2],
    ["00000000-0000-4000-8000-0000000000d2", 1],
  ])
})

test("xuất hàng (hoá đơn): món thêm tay lên trên dòng của đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
  const dong = page.getByTestId("dong-hoa-don")
  await expect(dong).toHaveCount(1)
  await them(page, "Mì")
  await expect(dong).toHaveCount(2)
  await expect(dong.first()).toContainText("Mì tôm")
  await expect(dong.nth(1)).toContainText("Sữa hộp")
})

for (const [ten, duong] of [["nhập hàng", "/pos/nhap-hang/moi"], ["trả NCC", "/pos/tra-ncc/moi"]] as const) {
  test(`${ten}: món vừa thêm lên đầu danh sách`, async ({ page }) => {
    await dangNhap(page)
    await page.goto(duong)
    const dong = page.locator("[data-dong]")
    await them(page, "Sữa")
    await expect(dong).toHaveCount(1)
    await them(page, "Mì")
    await expect(dong).toHaveCount(2)
    await expect(dong.first()).toContainText("Mì tôm")
    await expect(dong.nth(1)).toContainText("Sữa hộp")
  })
}

/* Sửa hóa đơn HD-E2E-1 có phiếu trả kèm 15 dòng — chèn riêng rồi gỡ (cùng khuôn với e2e/pos-hoa-don.spec.ts). */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const DON_HD = "00000000-0000-4000-8000-0000000000f9"
const chen = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (duong: string) => fetch(`${FAKE}/rest/v1/${duong}`, { method: "DELETE" })

/** Đơn gốc + phiếu trả kèm HD-E2E-1 có `soDong` dòng (máy giả không tự ghép bảng con — dòng đi kèm như PostgREST trả). */
async function dungPhieuTraDai(soDong = 15) {
  await chen("sales_orders", [{
    id: DON_HD, org_id: "00000000-0000-4000-8000-0000000000a1", order_code: "DH-0009",
    customer_id: "00000000-0000-4000-8000-0000000000c1", sales_user_id: "00000000-0000-4000-8000-0000000000b1",
    status: "completed", payment_terms: "COD", notes: null,
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" },
  }])
  await chen("sales_order_lines", [{
    id: "sol9", order_id: DON_HD, product_id: "00000000-0000-4000-8000-0000000000d1", unit_name: "thùng",
    quantity: 2, conversion_factor: 24, unit_price: 450000, invoiced_qty: 2, line_total: 900000,
  }])
  await chen("returns", [{
    id: "r-hd-dai", org_id: "khong-hien-trong-danh-sach", order_id: DON_HD, invoice_id: HOA_DON,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "submitted", credit_note_amount: 300000,
    lines: Array.from({ length: soDong }, (_, i) => ({
      id: `rl-dai-${i}`, product_id: "00000000-0000-4000-8000-0000000000d1", unit_name: "hộp", quantity: 1,
      unit_price: 20000, vat_rate: 0, is_exchange: false, product: { name: "Sữa hộp", sku: "SUA1" },
    })),
  }])
}
async function goPhieuTraDai() {
  await xoa("returns?id=eq.r-hd-dai")
  await xoa("sales_order_lines?id=eq.sol9")
  await xoa(`sales_orders?id=eq.${DON_HD}`)
}

test("sửa hoá đơn: phần đổi trả DÀI thì cuộn trong khối, bảng hàng đi vẫn thấy; dòng trả mới thêm lên đầu khối", async ({ page }) => {
  await dungPhieuTraDai()
  try {
    await dangNhap(page)
    await page.goto(`/pos/hoa-don/${HOA_DON}/sua`)
    await expect(page.getByRole("heading", { name: /Sửa hóa đơn/ })).toBeVisible()
    await expect(page.getByTestId("dong-tra-cu")).toHaveCount(15)
    // Bảng hàng đi KHÔNG bị khối đổi trả đè mất.
    await expect(page.getByTestId("dong-hoa-don").first()).toBeInViewport()
    const khoi = page.getByTestId("khoi-hang-tra")
    const cao = (await khoi.boundingBox())!.height
    expect(cao, "khối đổi trả phải có trần (42% chiều cao màn)").toBeLessThanOrEqual(900 * 0.42 + 1)
    const cuon = page.getByTestId("cuon-hang-tra")
    // LĂN CHUỘT như người dùng (cuộn bằng lệnh thì khung `overflow-hidden` cũng cuộn được — đúng chỗ lỗi cũ trốn):
    // dòng đổi trả cuộn được, xuống tận dòng cuối, bảng hàng đi vẫn đứng đó.
    await cuon.hover()
    await page.mouse.wheel(0, 4000)
    await expect.poll(() => cuon.evaluate((el) => el.scrollTop), { message: "lăn chuột mà dòng đổi trả không cuộn" }).toBeGreaterThan(0)
    await expect(page.getByTestId("dong-tra-cu").last()).toBeInViewport()
    await expect(page.getByTestId("dong-hoa-don").first()).toBeInViewport()

    // Thêm hàng trả (đang cuộn ở đáy khối): dòng MỚI lên đầu khối, khối tự cuộn về nó.
    await page.getByRole("button", { name: /Thêm hàng trả/ }).click()
    await them(page, "Mì")
    const moi = page.getByTestId("dong-tra-moi")
    await expect(moi).toHaveCount(1)
    await expect(moi.first()).toBeInViewport()
    await expect(cuon.locator("[data-testid=stt-dong]").first()).toHaveText("1.")
    await expect(cuon.locator("[data-dong], [data-testid=dong-tra-cu]").first()).toContainText("Mì tôm")
    await cuon.hover()
    await page.mouse.wheel(0, 4000)
    await expect(page.getByTestId("dong-tra-cu").last()).toBeInViewport()
    await them(page, "Sữa")
    await expect(moi).toHaveCount(2)
    await expect(moi.first(), "dòng thêm sau nằm trên dòng thêm trước").toContainText("Sữa hộp")
    await expect(moi.nth(1)).toContainText("Mì tôm")
    await expect(moi.first()).toBeInViewport()
  } finally {
    await goPhieuTraDai()
  }
})

test("xem hoá đơn: hàng đổi trả DÀI cuộn trong khối chứng từ liên quan, bảng hàng vẫn thấy", async ({ page }) => {
  // 30 dòng: không có trần thì khối này cao hơn cả cột — bảng hàng đi co về 0, đúng ca chủ nhà báo.
  await dungPhieuTraDai(30)
  try {
    await dangNhap(page)
    await page.goto(`/pos/hoa-don/${HOA_DON}`)
    const tra = page.getByTestId("hang-doi-tra")
    await expect(tra.locator(":scope > div.grid > div")).toHaveCount(30)
    const bang = page.getByTestId("cuon-dong-hang")
    await expect(bang.locator(":scope > div").first()).toBeInViewport()
    const vung = page.getByTestId("cuon-lien-quan")
    expect((await vung.boundingBox())!.height, "khối liên quan phải có trần (42% chiều cao màn)").toBeLessThanOrEqual(900 * 0.42 + 1)
    // Lăn chuột như người dùng: tới tận dòng hàng trả cuối, bảng hàng vẫn đứng đó.
    await vung.hover()
    await page.mouse.wheel(0, 4000)
    await expect.poll(() => vung.evaluate((el) => el.scrollTop), { message: "lăn chuột mà khối không cuộn" }).toBeGreaterThan(0)
    await expect(tra.locator(":scope > div.grid > div").last()).toBeInViewport()
    await expect(bang.locator(":scope > div").first()).toBeInViewport()
  } finally {
    await goPhieuTraDai()
  }
})

test("đơn hàng: nhiều chứng từ liên quan thì khối liên quan cuộn trong trần, bảng hàng bán vẫn thấy", async ({ page }) => {
  // Đơn DH-0001 có 20 phiếu trả (đã hoàn thành, không giữ lại sửa) — khối "Chứng từ liên quan" dài 20 dòng liên kết.
  const ids = Array.from({ length: 20 }, (_, i) => `r-don-lq-${i}`)
  await chen("returns", ids.map((id, i) => ({
    id, org_id: "khong-hien-trong-danh-sach", order_id: "o-e2e-1", invoice_id: null,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "completed", credit_note_amount: 10000 * (i + 1),
    created_at: `2026-10-01T08:${String(i).padStart(2, "0")}:00Z`, lines: [],
  })))
  try {
    await dangNhap(page)
    await page.goto("/pos/don-hang/o-e2e-1")
    const vung = page.getByTestId("cuon-lien-quan")
    const lienKet = vung.locator('a[href^="/pos/tra-hang/r-don-lq-"]')
    await expect(lienKet).toHaveCount(20)
    await expect(page.getByTestId("dong-don").first()).toBeInViewport()
    expect((await vung.boundingBox())!.height, "khối liên quan phải có trần (24% chiều cao màn)").toBeLessThanOrEqual(900 * 0.24 + 1)
    await vung.hover()
    await page.mouse.wheel(0, 4000)
    await expect.poll(() => vung.evaluate((el) => el.scrollTop), { message: "lăn chuột mà khối không cuộn" }).toBeGreaterThan(0)
    await expect(lienKet.last()).toBeInViewport()
    await expect(page.getByTestId("dong-don").first()).toBeInViewport()
  } finally {
    for (const id of ids) await xoa(`returns?id=eq.${id}`)
  }
})

test("đơn hàng: phần đổi trả DÀI thì cuộn trong khối, bảng hàng bán vẫn thấy", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/don-hang/moi")
  await chonKhach(page, "Tạp hoá Cô Ba")
  await them(page, "Sữa")
  await expect(page.getByTestId("dong-don")).toHaveCount(1)
  await page.getByRole("button", { name: "Xong" }).click()
  await page.getByRole("button", { name: "+ Thêm hàng trả" }).click()
  for (let i = 0; i < 12; i++) await them(page, i % 2 ? "Mì" : "Sữa")
  const dongTra = page.getByTestId("dong-tra-don")
  await expect(dongTra).toHaveCount(12)
  await expect(dongTra.first(), "dòng trả vừa thêm lên đầu").toContainText("Mì tôm")
  await expect(page.getByTestId("dong-don").first()).toBeInViewport()
  const cao = (await page.getByTestId("khoi-hang-tra-don").boundingBox())!.height
  expect(cao).toBeLessThanOrEqual(900 * 0.42 + 1)
  // Lăn chuột như người dùng: dòng đổi trả cuộn được tới dòng cuối, bảng hàng bán vẫn thấy.
  const cuon = page.getByTestId("cuon-hang-tra")
  await cuon.hover()
  await page.mouse.wheel(0, 4000)
  await expect.poll(() => cuon.evaluate((el) => el.scrollTop), { message: "lăn chuột mà dòng đổi trả không cuộn" }).toBeGreaterThan(0)
  await expect(dongTra.last()).toBeInViewport()
  await expect(page.getByTestId("dong-don").first()).toBeInViewport()
})
