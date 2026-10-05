import { test, expect, type Page } from "@playwright/test"
import * as XLSX from "xlsx"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 05/10/2026: "Thêm phần xuất excel cho phiếu trả hàng ncc và các phiếu khác tương tự". Nút "Xuất Excel"
 *   trên danh sách chứng từ xuất MỌI phiếu khớp bộ lọc (không chỉ trang đang xem) — sheet "Phiếu" + "Chi tiết dòng".
 *   Logic: tests/xuat-excel-phieu.test.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const SUA = { sku: "SUA1", name: "Sữa hộp", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] }

const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

/** Bấm nút của thanh công cụ máy tính, đọc tệp tải về. */
async function xuat(page: Page) {
  const nut = page.locator('[data-testid="xuat-excel"]:visible').first()
  await expect(nut).toBeEnabled()
  const [tai] = await Promise.all([page.waitForEvent("download"), nut.click()])
  const buf = Buffer.concat((await (await tai.createReadStream()).toArray()) as Buffer[])
  const wb = XLSX.read(buf)
  const bang = (ten: string) => XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets[ten])
  return { ten: tai.suggestedFilename(), sheets: wb.SheetNames, bang }
}

/* 25 phiếu trả NCC — danh sách 20 phiếu/trang; tệp phải có ĐỦ 25 (lỗi dễ mắc: xuất `trang`). */
const PHIEU_NCC = Array.from({ length: 25 }, (_, i) => ({
  id: `srx-${i}`, org_id: ORG, supplier_id: "00000000-0000-4000-8000-0000000000e1", return_code: `TRN-${String(i).padStart(3, "0")}`,
  return_date: "2026-09-29", warehouse_zone: "sale", status: i === 24 ? "draft" : "completed", reason: "Hàng lỗi", notes: null,
  subtotal: 100000, vat: 10000, discount: 0, total: 110000, created_by: OWNER,
  created_at: `2026-09-29T0${i % 10}:${String(i).padStart(2, "0")}:00Z`,
  supplier: { id: "00000000-0000-4000-8000-0000000000e1", name: "Vinamilk", code: "NCC1" },
}))
const DONG_NCC = [
  { id: "srl-1", return_id: "srx-3", sort_order: 0, unit_name: "thùng", quantity: 2, unit_price: 450000, line_discount: 0, vat_rate: 0.1, conversion_factor: 24, line_total: 990000, notes: "móp", product: SUA },
  { id: "srl-2", return_id: "srx-3", sort_order: 1, unit_name: "hộp", quantity: 5, unit_price: 20000, line_discount: 0, vat_rate: 0, conversion_factor: 1, line_total: 100000, notes: null, product: SUA },
]

test.describe("Xuất Excel danh sách chứng từ", () => {
  test.beforeAll(async () => {
    await them("supplier_returns", PHIEU_NCC)
    await them("supplier_return_lines", DONG_NCC)
  })
  test.afterAll(async () => {
    for (const p of PHIEU_NCC) await xoa("supplier_returns", "id", p.id)
    for (const l of DONG_NCC) await xoa("supplier_return_lines", "id", l.id)
  })

  test("Trả hàng NCC: xuất ĐỦ mọi phiếu khớp bộ lọc (không chỉ trang 20 dòng) + chi tiết dòng; lọc tab thì xuất theo tab", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/purchase-returns")
    await expect(page.getByText("TRN-003", { exact: true }).first()).toBeVisible()

    const tep = await xuat(page)
    expect(tep.ten).toBe("tra-hang-ncc_2026-09-30.xlsx")
    expect(tep.sheets).toEqual(["Phiếu", "Chi tiết dòng"])
    const phieu = tep.bang("Phiếu")
    expect(phieu).toHaveLength(25)
    expect(phieu.find((r) => r["Mã phiếu"] === "TRN-003")).toMatchObject({
      Ngày: "29/09/2026", "Nhà cung cấp": "Vinamilk", "Trạng thái": "Đã gửi", "Tổng tiền": 110000, "Người lập": "Chủ NPP",
    })
    expect(tep.bang("Chi tiết dòng")).toEqual([
      expect.objectContaining({ "Mã phiếu": "TRN-003", "Tên hàng": "Sữa hộp", ĐVT: "thùng", SL: 2, "SL quy đổi": 48, "Đơn giá": 450000, "VAT %": 10, "Thành tiền": 990000, "Ghi chú dòng": "móp" }),
      expect.objectContaining({ "Mã phiếu": "TRN-003", ĐVT: "hộp", SL: 5, "SL quy đổi": 5 }),
    ])

    // Chỉ chọn "Nháp" (bấm "Tất cả" để bỏ hết, rồi bấm "Nháp" — chọn nhiều, chủ nhà 25/09/2026) → tệp chỉ còn phiếu nháp.
    await page.locator('[data-status-chip="all"]').first().click()
    await page.locator('[data-status-chip="draft"]').first().click()
    await expect(page.getByText("TRN-003", { exact: true })).toHaveCount(0)
    const nhap = await xuat(page)
    expect(nhap.bang("Phiếu").map((r) => r["Mã phiếu"])).toEqual(["TRN-024"])
  })

  test("Hóa đơn bán: tiền là SỐ CÒN LẠI sau hàng trả (CLAUDE.md); có sheet chi tiết dòng", async ({ page }) => {
    const TRA = { id: "rx-hd-1", org_id: ORG, customer_id: "00000000-0000-4000-8000-0000000000c1", invoice_id: HOA_DON, status: "submitted", credit_with_invoice: true, credit_note_amount: 200000, reason: "damaged", created_at: "2026-09-23T09:00:00Z" }
    await them("returns", [TRA])
    try {
      await dangNhap(page)
      await page.goto("/sales-invoices")
      await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
      const tep = await xuat(page)
      expect(tep.ten).toBe("hoa-don-ban_2026-09-30.xlsx")
      const hd = tep.bang("Phiếu").find((r) => r["Mã hóa đơn"] === "HD-E2E-1")
      expect(hd).toMatchObject({ "Tổng hóa đơn": 900000, "Hàng trả": 200000, "Tổng tiền (còn lại)": 700000, "Khách hàng": "Tạp hoá Cô Ba" })
      const dong = tep.bang("Chi tiết dòng").filter((r) => r["Mã hóa đơn"] === "HD-E2E-1")
      expect(dong.map((r) => [r["Loại dòng"], r.ĐVT, r.SL, r["SL quy đổi"]])).toEqual([["Bán", "thùng", 2, 48], ["Hàng đổi", "gói", 1, 1]])
    } finally {
      await xoa("returns", "id", TRA.id)
    }
  })
})
