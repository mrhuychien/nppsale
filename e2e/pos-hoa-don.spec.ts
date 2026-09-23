import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ YÊU CẦU 23/09/2026: "Màn xuất hàng → POS tại hoá đơn", "Màn sửa hoá đơn
 *   / tạo hoá đơn làm giống màn tạo đơn hàng / sửa đơn hàng (trên pos)", và
 *   lỗi "Sửa hoá đơn mất phần Hàng đổi trả gắn với Hoá đơn".
 *
 * Chốt đọc tải trọng `post_invoice` / `reissue_invoice` thật mà màn gửi đi.
 */
const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã hàng|KHÁCH TRẢ LẠI/i)
/** Ô số lượng POS là một nút hiện số; bấm vào mới thành ô gõ. */
const soLuong = (page: Page, nhan: string) =>
  page.getByRole("button", { name: new RegExp(`^${nhan} — đang là`) })
async function datSo(page: Page, nhan: string, v: number) {
  await soLuong(page, nhan).click()
  await page.getByLabel(nhan, { exact: true }).fill(String(v))
  await page.getByLabel(nhan, { exact: true }).press("Enter")
}
const goiCuoi = async (fn: string) =>
  (await nhatKy()).filter((r) => r.path.endsWith(`/rpc/${fn}`)).at(-1)

const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const DON_HD = "00000000-0000-4000-8000-0000000000f9"

test("xuất hàng trên POS: dòng bám dòng đơn, thêm hàng trả đi cùng giao dịch", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
  await expect(page.getByRole("heading", { name: /Xuất hàng · lập hóa đơn/ })).toBeVisible()
  const dong = page.getByTestId("dong-hoa-don")
  await expect(dong).toHaveCount(1)
  await expect(dong.first()).toContainText("Sữa hộp")
  await expect(dong.first()).toContainText("đặt 50 hộp · đã xuất 0 hộp")
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("50")

  // Xuất một phần: 30 hộp.
  await datSo(page, "số lượng dòng 1", 30)
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("30")

  /* Đổi đơn vị NGAY TRÊN DÒNG CỦA ĐƠN (chủ nhà chốt 23/09/2026: "toàn
     quyền… ko giới hạn cái nào cả"): giá tra bảng giá thùng, và phép so
     "vượt phần còn lại" quy về hộp — 30 thùng = 720 hộp > 50 hộp đặt. */
  await page.getByRole("button", { name: "Đơn vị thùng dòng 1" }).click()
  await expect(page.getByLabel("Đơn giá dòng 1")).toHaveValue("450.000")
  await expect(dong.first()).toContainText("vượt phần còn lại")
  await datSo(page, "số lượng dòng 1", 2)
  await expect(dong.first(), "2 thùng = 48 hộp ≤ 50 mà vẫn báo vượt").not.toContainText("vượt phần còn lại")

  // Hàng khách trả kèm: bật chế độ thêm hàng trả rồi tìm ở ô bên phải.
  await page.getByRole("button", { name: /Thêm hàng trả/ }).click()
  await oTim(page).fill("Mì")
  await oTim(page).press("Enter")
  await expect(page.getByTestId("dong-tra-moi")).toHaveCount(1)
  await expect(page.getByTestId("khoi-hang-tra")).toContainText("trừ 5.000")

  /* ⚠ CHỦ NHÀ 23/09/2026: bấm "Xuất hàng & lập HĐ" là bật luôn cửa sổ in hoá đơn. */
  const moIn = page.context().waitForEvent("page")
  await page.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
  const cuaIn = await moIn
  await expect(cuaIn).toHaveURL(/\/sales-invoices\/00000000-0000-4000-8000-00000000f004\/print\?auto=1/)
  await cuaIn.close()
  await expect.poll(async () => !!(await goiCuoi("post_invoice"))).toBe(true)
  const p = ((await goiCuoi("post_invoice"))!.body as { p: Record<string, unknown> }).p as {
    order_id: string; lines: Array<Record<string, unknown>>; return_adds: Array<Record<string, unknown>>
  }
  expect(p.order_id).toBe("o-e2e-1")
  expect(p.lines).toHaveLength(1)
  expect(p.lines[0], "dòng hóa đơn rời khỏi dòng đơn").toMatchObject({
    order_line_id: "sol1", quantity: 2, unit_name: "thùng", conversion_factor: 24, unit_price: 450000,
  })
  expect(p.return_adds[0]).toMatchObject({ product_id: "00000000-0000-4000-8000-0000000000d2", quantity: 1, is_exchange: false })
  await expect(page).toHaveURL(/\/pos\/hoa-don\/00000000-0000-4000-8000-00000000f004/)
})

test("sửa hóa đơn trên POS: giữ hàng đổi, hiện và sửa được hàng trả, giữ hệ số 24", async ({ page }) => {
  /* Phiếu trả kèm HD-E2E-1 — chèn riêng cho chốt này rồi gỡ, để danh sách
     phiếu trả của các chốt khác giữ nguyên số liệu. */
  const chen = (bang: string, rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  /* Đơn gốc của HD-E2E-1 và dòng của nó — chèn riêng: đặt vào dữ liệu mẫu
     chung là danh sách đơn của các chốt khác thành năm đơn. */
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
    id: "r-hd", org_id: "khong-hien-trong-danh-sach", order_id: DON_HD, invoice_id: HOA_DON,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "submitted", credit_note_amount: 40000,
    /* Máy chủ giả không tự ghép bảng con — dòng đi kèm sẵn như PostgREST trả. */
    lines: [
      { id: "rl-hd1", product_id: "00000000-0000-4000-8000-0000000000d1", unit_name: "hộp", quantity: 2, unit_price: 20000, vat_rate: 0, is_exchange: false, product: { name: "Sữa hộp", sku: "SUA1" } },
    ],
  }])
  try {
    await dangNhap(page)
    await page.goto(`/pos/hoa-don/${HOA_DON}/sua`)
    await expect(page.getByRole("heading", { name: /Sửa hóa đơn/ })).toBeVisible()
    const dong = page.getByTestId("dong-hoa-don")
    await expect(dong).toHaveCount(1)
    /* Hàng đổi cũ (không có dòng phiếu trả tương ứng) vẫn đi theo tờ mới. */
    await expect(page.getByTestId("dong-hang-doi"), "dòng hàng đổi mất").toHaveCount(1)
    await expect(page.getByTestId("dong-hang-doi")).toContainText("1 gói")

    // Khối hàng đổi trả hiện phiếu đang bám hóa đơn, sửa được số lượng.
    await expect(page.getByTestId("dong-tra-cu")).toHaveCount(1)
    await expect(page.getByTestId("khoi-hang-tra")).toContainText("trừ 40.000")
    await datSo(page, "số lượng trả dòng 1", 1)
    await expect(page.getByTestId("khoi-hang-tra")).toContainText("trừ 20.000")

    // Người tạo · người được gán.
    await expect(page.getByTestId("nguoi-tao")).toHaveText("Chủ NPP")

    const moIn = page.context().waitForEvent("page")
    await page.getByRole("button", { name: /Huỷ HĐ & lập lại/ }).click()
    const cuaIn = await moIn
    await expect(cuaIn, "lập lại xong không bật cửa sổ in tờ MỚI").toHaveURL(/\/sales-invoices\/00000000-0000-4000-8000-00000000f003\/print\?auto=1/)
    await cuaIn.close()
    await expect.poll(async () => !!(await goiCuoi("reissue_invoice"))).toBe(true)
    const p = ((await goiCuoi("reissue_invoice"))!.body as { p_invoice_id: string; p: Record<string, unknown> })
    expect(p.p_invoice_id).toBe(HOA_DON)
    const lines = (p.p as { lines: Array<Record<string, unknown>> }).lines
    expect(lines[0], "mất hệ số / mất liên kết dòng đơn").toMatchObject({ order_line_id: "sol9", unit_name: "thùng", quantity: 2, conversion_factor: 24 })
    expect(lines[1], "hàng ĐỔI thành dòng bán").toMatchObject({ unit_name: "gói", is_exchange: true })
    expect((p.p as { return_edits: unknown[] }).return_edits).toEqual([{ line_id: "rl-hd1", quantity: 1 }])

    /* Chi tiết hóa đơn: có đơn gốc, phiếu trả và hàng đổi trả (chủ nhà 23/09/2026). */
    await page.goto(`/pos/hoa-don/${HOA_DON}`)
    const lq = page.getByTestId("chung-tu-lien-quan")
    await expect(lq).toContainText("DH-0009")
    await expect(lq).toContainText("Phiếu trả")
    await expect(lq.getByRole("link", { name: /DH-0009/ })).toHaveAttribute("href", `/pos/don-hang/${DON_HD}`)
    await expect(page.getByTestId("hang-doi-tra")).toContainText("Sữa hộp")
    await expect(page.getByTestId("hang-doi-tra")).toContainText("Trả")
  } finally {
    await fetch(`${FAKE}/rest/v1/returns?id=eq.r-hd`, { method: "DELETE" })
    await fetch(`${FAKE}/rest/v1/sales_order_lines?id=eq.sol9`, { method: "DELETE" })
    await fetch(`${FAKE}/rest/v1/sales_orders?id=eq.${DON_HD}`, { method: "DELETE" })
  }
})

/**
 * ⚠ CHỦ NHÀ 23/09/2026: "Khi xuất hàng màn tạo Hoá đơn: Mất thông tin người tạo,
 *   ko sửa được người gán; Không sửa được thông tin Hàng đổi trả".
 */
test("xuất hàng: người tạo là người đang xuất; sửa được hàng trả kèm đơn", async ({ page }) => {
  const chen = (bang: string, rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  await chen("returns", [{
    id: "r-don1", org_id: "khong-hien-trong-danh-sach", order_id: "o-e2e-1", invoice_id: null,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "draft", credit_note_amount: 60000,
    lines: [
      { id: "rl-don1", product_id: "00000000-0000-4000-8000-0000000000d1", unit_name: "hộp", quantity: 3, unit_price: 20000, vat_rate: 0, is_exchange: false, product: { name: "Sữa hộp", sku: "SUA1" } },
    ],
  }])
  try {
    await dangNhap(page)
    await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
    await expect(page.getByTestId("dong-hoa-don")).toHaveCount(1)
    await expect(page.getByTestId("nguoi-tao"), "xuất hàng mất người tạo").toHaveText("Chủ NPP")
    // Người được gán: chủ NPP thấy ô chọn (không phải chữ chỉ đọc).
    await expect(page.getByTestId("nguoi-duoc-gan")).toHaveCount(0)

    await expect(page.getByTestId("dong-tra-cu")).toHaveCount(1)
    await expect(page.getByTestId("khoi-hang-tra")).toContainText("trừ 60.000")
    await datSo(page, "số lượng trả dòng 1", 1)
    await expect(page.getByTestId("khoi-hang-tra")).toContainText("trừ 20.000")

    await page.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
    await expect.poll(async () => {
      const g = await goiCuoi("post_invoice")
      return (g?.body as { p?: { return_edits?: unknown } } | undefined)?.p?.return_edits ?? null
    }).toEqual([{ line_id: "rl-don1", quantity: 1 }])
  } finally {
    await fetch(`${FAKE}/rest/v1/returns?id=eq.r-don1`, { method: "DELETE" })
  }
})

/**
 * ⚠ CHỦ NHÀ BÁO 23/09/2026: sửa hàng ĐỔI (số lượng, quy cách, xoá) thì dòng
 *   hàng đổi trên hóa đơn phải đổi theo — một nguồn.
 */
test("xuất hàng: hàng đổi trên hóa đơn đi theo khối hàng đổi trả", async ({ page }) => {
  const chen = (bang: string, rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  await chen("returns", [{
    id: "r-doi1", org_id: "khong-hien-trong-danh-sach", order_id: "o-e2e-1", invoice_id: null,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "draft", credit_note_amount: 0,
    lines: [
      { id: "rl-doi1", product_id: "00000000-0000-4000-8000-0000000000d2", unit_name: "gói", quantity: 2, unit_price: 5000, vat_rate: 0, is_exchange: true, product: { name: "Mì tôm", sku: "MI1" } },
    ],
  }])
  try {
    await dangNhap(page)
    await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
    const doi = page.getByTestId("dong-hang-doi")
    await expect(doi).toHaveCount(1)
    await expect(doi).toContainText("2 gói")

    await datSo(page, "số lượng trả dòng 1", 3)
    await expect(doi, "sửa số lượng hàng đổi mà dòng hóa đơn đứng yên").toContainText("3 gói")
    await page.getByRole("button", { name: "Đơn vị thùng trả dòng 1" }).click()
    await expect(doi, "sửa quy cách hàng đổi mà dòng hóa đơn đứng yên").toContainText("3 thùng")

    // Hàng đổi THÊM MỚI cũng phải có dòng xuất kho.
    await page.getByRole("button", { name: /Thêm hàng trả/ }).click()
    await oTim(page).fill("Sữa")
    await oTim(page).press("Enter")
    await page.getByTestId("dong-tra-moi").getByRole("button", { name: "Đổi", exact: true }).click()
    await expect(doi).toHaveCount(2)

    await page.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
    await expect.poll(async () => !!(await goiCuoi("post_invoice"))).toBe(true)
    const p = ((await goiCuoi("post_invoice"))!.body as { p: { lines: Array<Record<string, unknown>>; return_edits: unknown[] } }).p
    const hangDoi = p.lines.filter((l) => l.is_exchange)
    expect(hangDoi.map((l) => `${l.unit_name}:${l.quantity}:${l.unit_price}`).sort()).toEqual(["hộp:1:0", "thùng:3:0"])
    expect(p.return_edits).toEqual([{ line_id: "rl-doi1", quantity: 3, unit_name: "thùng" }])
  } finally {
    await fetch(`${FAKE}/rest/v1/returns?id=eq.r-doi1`, { method: "DELETE" })
  }
})

test("xuất hàng: xoá dòng hàng đổi thì dòng hóa đơn hàng đổi biến mất", async ({ page }) => {
  const chen = (bang: string, rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  await chen("returns", [{
    id: "r-doi2", org_id: "khong-hien-trong-danh-sach", order_id: "o-e2e-1", invoice_id: null,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "draft", credit_note_amount: 0,
    lines: [
      { id: "rl-doi2", product_id: "00000000-0000-4000-8000-0000000000d2", unit_name: "gói", quantity: 2, unit_price: 5000, vat_rate: 0, is_exchange: true, product: { name: "Mì tôm", sku: "MI1" } },
    ],
  }])
  try {
    await dangNhap(page)
    await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
    await expect(page.getByTestId("dong-hang-doi")).toHaveCount(1)
    await page.getByRole("button", { name: "Bỏ dòng trả 1" }).click()
    await expect(page.getByTestId("dong-hang-doi")).toHaveCount(0)
    await page.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
    await expect.poll(async () => {
      const g = await goiCuoi("post_invoice")
      return (g?.body as { p?: { return_edits?: unknown } } | undefined)?.p?.return_edits ?? null
    }).toEqual([{ line_id: "rl-doi2", quantity: 0 }])
    const p = ((await goiCuoi("post_invoice"))!.body as { p: { lines: Array<Record<string, unknown>> } }).p
    expect(p.lines.filter((l) => l.is_exchange)).toHaveLength(0)
  } finally {
    await fetch(`${FAKE}/rest/v1/returns?id=eq.r-doi2`, { method: "DELETE" })
  }
})

/** Máy tính bấm "Xuất hàng" ở màn web → sang màn POS. */
test("xuất hàng trên web (máy tính) chuyển sang màn POS", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices/new?order=o-e2e-1")
  await expect(page).toHaveURL(/\/pos\/hoa-don\/moi\?order=o-e2e-1/)
})

test("tạo phiếu trả trên web (máy tính) chuyển sang màn POS", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/returns/new?invoiceId=${HOA_DON}&customerId=00000000-0000-4000-8000-0000000000c1`)
  await expect(page).toHaveURL(new RegExp(`/pos/tra-hang/moi\\?invoice=${HOA_DON}`))
})
