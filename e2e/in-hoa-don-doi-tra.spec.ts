import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 13/10/2026: "Kiểm tra cho tao mẫu phiếu in hiện tại không in ra hàng đổi và hàng trả hóa đơn".
 *   Tờ in hoá đơn (POS `/in/hoa-don` và màn quản lý) phải in MỌI dòng đổi / trả của phiếu đã trừ vào tờ này:
 *   - hoá đơn chỉ có hàng ĐỔI (trừ 0đ) — lỗi cũ: khối đổi / trả chỉ in khi tiền trừ > 0, còn dòng đổi xuất đi bị
 *     lọc khỏi bảng, nên món đổi biến mất khỏi tờ giấy;
 *   - hoá đơn đã phát hành HĐĐT — lỗi cũ: cổng "đã phát hành thì không in thêm dòng nào".
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1" // HD-E2E-1: 2 thùng Sữa 900.000 + 1 gói Mì đổi (0đ)
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const chen = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (duong: string) => fetch(`${FAKE}/rest/v1/${duong}`, { method: "DELETE" })
const dong = (page: Page, chu: string) => page.locator("tr", { hasText: chu })

for (const [ten, duong] of [["POS", `/in/hoa-don/${HOA_DON}`], ["quản lý", `/sales-invoices/${HOA_DON}/print`]] as const) {
  test(`in hoá đơn (${ten}) chỉ có hàng ĐỔI: vẫn in dòng (Hàng đổi), không có dòng trừ tiền`, async ({ page }) => {
    await chen("returns", [{
      id: "r-chi-doi", org_id: "00000000-0000-4000-8000-0000000000a1", invoice_id: HOA_DON, customer_id: KHACH,
      status: "submitted", credit_with_invoice: true, credit_note_amount: 0,
      lines: [{ id: "rl-chi-doi", unit_name: "gói", quantity: 1, unit_price: 5000, line_total: 5000, is_exchange: true, product: { name: "Mì tôm" } }],
    }])
    try {
      await dangNhap(page)
      await page.goto(duong)
      const doi = dong(page, "(Hàng đổi)")
      await expect(doi, "mất dòng hàng đổi trên tờ in").toHaveCount(1)
      await expect(doi).toContainText("Mì tôm")
      await expect(doi).toContainText("gói")
      await expect(doi).toContainText("không trừ")
      // Đánh số tiếp bảng hàng bán (1 dòng Sữa — dòng Mì đổi xuất đi 0đ không in) → 2.
      await expect(doi.locator("td").first()).toHaveText("2")
      await expect(dong(page, "Tổng cộng")).toContainText("900.000")
      await expect(dong(page, "Trừ hàng trả"), "đổi hàng không trừ tiền").toHaveCount(0)
    } finally {
      await xoa("returns?id=eq.r-chi-doi")
    }
  })
}

test("in hoá đơn ĐÃ phát hành HĐĐT: vẫn in hàng đổi / hàng trả, dòng Trừ hàng trả và Còn phải thu", async ({ page }) => {
  await chen("invoices", [{
    id: "00000000-0000-4000-8000-00000000e1f1", org_id: "00000000-0000-4000-8000-0000000000a1", sales_invoice_id: HOA_DON,
    misa_inv_no: "0000123", status: "issued", created_at: "2026-09-23T09:00:00Z",
  }])
  await chen("returns", [{
    id: "r-hddt", org_id: "00000000-0000-4000-8000-0000000000a1", invoice_id: HOA_DON, customer_id: KHACH,
    status: "submitted", credit_with_invoice: true, credit_note_amount: 40000,
    lines: [
      { id: "rl-hddt-1", unit_name: "hộp", quantity: 2, unit_price: 20000, line_total: 40000, is_exchange: false, product: { name: "Sữa hộp" } },
      { id: "rl-hddt-2", unit_name: "gói", quantity: 1, unit_price: 5000, line_total: 5000, is_exchange: true, product: { name: "Mì tôm" } },
    ],
  }])
  try {
    await dangNhap(page)
    await page.goto(`/in/hoa-don/${HOA_DON}`)
    await expect(dong(page, "(Hàng trả)"), "HĐ đã phát hành HĐĐT mà mất hàng trả").toHaveCount(1)
    await expect(dong(page, "(Hàng trả)")).toContainText("−40.000")
    await expect(dong(page, "(Hàng đổi)")).toContainText("không trừ")
    // "Tổng cộng" vẫn là tiền hoá đơn (khớp HĐĐT); khoản trừ là hai dòng thêm ở dưới.
    await expect(dong(page, "Tổng cộng")).toContainText("900.000")
    await expect(dong(page, "Trừ hàng trả")).toContainText("−40.000")
    await expect(dong(page, "Còn phải thu")).toContainText("860.000")
  } finally {
    await xoa("returns?id=eq.r-hddt")
    await xoa(`invoices?sales_invoice_id=eq.${HOA_DON}`)
  }
})

test("in hoá đơn: phiếu chưa trừ vào hoá đơn (tự lập còn Nháp, phiếu đã huỷ) thì KHÔNG in", async ({ page }) => {
  await chen("returns", [
    {
      id: "r-nhap-tu-lap", org_id: "00000000-0000-4000-8000-0000000000a1", invoice_id: HOA_DON, customer_id: KHACH,
      status: "draft", credit_with_invoice: false, credit_note_amount: 20000,
      lines: [{ id: "rl-nhap", unit_name: "hộp", quantity: 1, unit_price: 20000, line_total: 20000, is_exchange: false, product: { name: "Sữa hộp NHÁP" } }],
    },
    {
      id: "r-da-huy", org_id: "00000000-0000-4000-8000-0000000000a1", invoice_id: HOA_DON, customer_id: KHACH,
      status: "cancelled", credit_with_invoice: true, credit_note_amount: 0,
      lines: [{ id: "rl-huy", unit_name: "gói", quantity: 1, unit_price: 5000, line_total: 5000, is_exchange: true, product: { name: "Mì tôm HUỶ" } }],
    },
    {
      id: "r-tu-lap-xong", org_id: "00000000-0000-4000-8000-0000000000a1", invoice_id: HOA_DON, customer_id: KHACH,
      status: "completed", credit_with_invoice: false, credit_note_amount: 20000,
      lines: [{ id: "rl-xong", unit_name: "hộp", quantity: 1, unit_price: 20000, line_total: 20000, is_exchange: false, product: { name: "Sữa hộp XONG" } }],
    },
  ])
  try {
    await dangNhap(page)
    await page.goto(`/in/hoa-don/${HOA_DON}`)
    await expect(dong(page, "Sữa hộp XONG"), "phiếu tự lập đã hoàn thành phải in").toHaveCount(1)
    await expect(dong(page, "Sữa hộp NHÁP"), "phiếu nháp chưa trừ tiền").toHaveCount(0)
    await expect(dong(page, "Mì tôm HUỶ"), "phiếu đã huỷ").toHaveCount(0)
    await expect(dong(page, "Trừ hàng trả")).toContainText("−20.000")
    await expect(dong(page, "Còn phải thu")).toContainText("880.000")
  } finally {
    for (const id of ["r-nhap-tu-lap", "r-da-huy", "r-tu-lap-xong"]) await xoa(`returns?id=eq.${id}`)
  }
})
