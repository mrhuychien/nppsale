/**
 * Chủ nhà 05/10/2026: "xuất excel cho chi tiết 8 loại phiếu". Trang chi tiết xuất ĐÚNG MỘT phiếu với cùng tệp / cột
 * như nút ở danh sách. Bấm thật: e2e/xuat-excel-phieu.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import type { SupabaseClient } from "@supabase/supabase-js"
import { tenTepMotPhieu } from "@/lib/xuat-excel/phieu"
import { CHON_MOT_PHIEU, xuatMotPhieu, type LoaiPhieuXuat } from "@/lib/xuat-excel/mot-phieu"

type Dong = Record<string, unknown>

/** Sổ giả: from().select().eq/in().order().range()/maybeSingle() — đủ cho `xuatMotPhieu`. */
function soGia(bang: Record<string, Dong[]>, loi: Record<string, string> = {}) {
  const goi: Array<{ bang: string; loc: Array<[string, unknown]> }> = []
  const from = (ten: string) => {
    const loc: Array<[string, (r: Dong) => boolean]> = []
    const ghi = { bang: ten, loc: [] as Array<[string, unknown]> }
    goi.push(ghi)
    let tu = 0, den = Infinity
    const ketQua = () => {
      if (loi[ten]) return { data: null, error: { message: loi[ten] }, count: null }
      const rows = (bang[ten] ?? []).filter((r) => loc.every(([, f]) => f(r)))
      return { data: rows.slice(tu, den + 1), error: null, count: rows.length }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { ghi.loc.push([c, v]); loc.push([c, (r) => r[c] === v]); return q },
      in: (c: string, v: unknown[]) => { ghi.loc.push([c, v]); loc.push([c, (r) => v.includes(r[c])]); return q },
      order: () => q,
      range: (a: number, b: number) => { tu = a; den = b; return q },
      maybeSingle: async () => { const k = ketQua(); return { data: k.data?.[0] ?? null, error: k.error } },
      then: (ok: (v: unknown) => unknown, sai?: (e: unknown) => unknown) => Promise.resolve(ketQua()).then(ok, sai),
    }
    return q
  }
  return { sb: { from } as unknown as SupabaseClient, goi }
}

const SUA = { sku: "SUA1", name: "Sữa hộp", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] }
const doc = (rows: (string | number)[][]) => {
  const [dau, ...than] = rows
  return than.map((r) => Object.fromEntries(dau.map((t, i) => [String(t), r[i]])))
}

describe("tên tệp một phiếu", () => {
  const d = new Date("2026-10-05T13:00:00Z")
  it("tiền tố + mã + ngày VN", () => {
    expect(tenTepMotPhieu("tra-hang-ncc", "TN-0001", d)).toBe("tra-hang-ncc_TN-0001_2026-10-05.xlsx")
  })
  it("ký tự lạ / dấu tiếng Việt trong mã bị thay; không có mã thì như tên tệp danh sách", () => {
    expect(tenTepMotPhieu("chi-phi", "CP 01/Điện", d)).toBe("chi-phi_CP-01-Dien_2026-10-05.xlsx")
    expect(tenTepMotPhieu("tra-hang", "", d)).toBe("tra-hang_2026-10-05.xlsx")
  })
})

describe("xuatMotPhieu — đọc đúng một phiếu theo id, cùng cột với danh sách", () => {
  it("Trả hàng NCC: chỉ phiếu này + dòng của nó; người lập đọc riêng", async () => {
    const { sb, goi } = soGia({
      supplier_returns: [
        { id: "a", return_code: "TN-1", return_date: "2026-10-01", status: "completed", total: 110000, created_by: "u1", supplier: { name: "Vinamilk", code: "NCC1" } },
        { id: "b", return_code: "TN-2", return_date: "2026-10-01", status: "draft", total: 5, created_by: "u1" },
      ],
      supplier_return_lines: [
        { id: "l1", return_id: "a", sort_order: 0, unit_name: "thùng", quantity: 2, unit_price: 450000, conversion_factor: 24, line_total: 990000, product: SUA },
        { id: "l2", return_id: "b", sort_order: 0, unit_name: "hộp", quantity: 1, unit_price: 1, line_total: 1, product: SUA },
      ],
      users: [{ id: "u1", full_name: "Chủ NPP" }],
    })
    const kq = await xuatMotPhieu(sb, "tra-ncc", "a")
    expect(kq.ma).toBe("TN-1")
    expect(kq.sheets.map((s) => s.ten)).toEqual(["Phiếu", "Chi tiết dòng"])
    expect(doc(kq.sheets[0].rows)).toEqual([expect.objectContaining({ "Mã phiếu": "TN-1", "Tổng tiền": 110000, "Người lập": "Chủ NPP", "Nhà cung cấp": "Vinamilk" })])
    expect(doc(kq.sheets[1].rows)).toEqual([expect.objectContaining({ "Mã phiếu": "TN-1", ĐVT: "thùng", "SL quy đổi": 48 })])
    expect(goi[0]).toEqual({ bang: "supplier_returns", loc: [["id", "a"]] })
  })

  it("Hóa đơn bán: tiền là SỐ CÒN LẠI sau hàng trả (phiếu tự sinh Chờ xử lý vẫn trừ), dòng đổi tách riêng", async () => {
    const { sb } = soGia({
      sales_invoices: [{ id: "hd", invoice_code: "HD-1", invoice_date: "2026-10-02", status: "posted", subtotal: 900000, vat: 0, total: 900000, customer: { store_name: "Cô Ba" } }],
      sales_invoice_lines: [
        { id: "x1", invoice_id: "hd", sort_order: 0, unit_name: "thùng", quantity: 2, unit_price: 450000, line_total: 900000, conversion_factor: 24, product: SUA },
        { id: "x2", invoice_id: "hd", sort_order: 1, unit_name: "hộp", quantity: 1, unit_price: 0, line_total: 0, is_exchange: true, product: SUA },
      ],
      returns: [
        { invoice_id: "hd", status: "submitted", credit_with_invoice: true, credit_note_amount: 200000 },
        { invoice_id: "hd", status: "draft", credit_with_invoice: false, credit_note_amount: 999 },
      ],
    })
    const kq = await xuatMotPhieu(sb, "hoa-don", "hd")
    expect(kq.ma).toBe("HD-1")
    expect(doc(kq.sheets[0].rows)[0]).toMatchObject({ "Tổng hóa đơn": 900000, "Hàng trả": 200000, "Tổng tiền (còn lại)": 700000 })
    expect(doc(kq.sheets[1].rows).map((r) => r["Loại dòng"])).toEqual(["Bán", "Hàng đổi"])
  })

  it("Trả hàng khách: dòng hàng đổi tính nợ 0; mã TH- đọc riêng", async () => {
    const { sb } = soGia({
      returns: [{ id: "r1", return_code: "TH-0007", created_at: "2026-10-01T02:00:00Z", status: "completed", credit_note_amount: 50000, reason: "damaged" }],
      return_lines: [
        { id: "rl1", return_id: "r1", unit_name: "hộp", quantity: 2, unit_price: 25000, line_total: 50000, product: SUA },
        { id: "rl2", return_id: "r1", unit_name: "hộp", quantity: 1, unit_price: 25000, line_total: 25000, is_exchange: true, product: SUA },
      ],
    })
    const kq = await xuatMotPhieu(sb, "tra-khach", "r1")
    expect(kq.ma).toBe("TH-0007")
    expect(doc(kq.sheets[1].rows).map((r) => r["Tiền tính nợ"])).toEqual([50000, 0])
  })

  it("Phiếu kho: giá vốn chỉ khi được xem", async () => {
    const so = {
      stock_entries: [{ id: "k", entry_code: "PK-1", type: "import", status: "posted", created_at: "2026-10-01T02:00:00Z" }],
      stock_entry_lines: [{ id: "kl", entry_id: "k", unit_name: "thùng", quantity: 1, qty_in_base_uom: 24, unit_cost: 1000, product: SUA }],
    }
    const co = await xuatMotPhieu(soGia(so).sb, "kho", "k", { giaVon: true })
    expect(doc(co.sheets[1].rows)[0]).toMatchObject({ "SL quy đổi": 24, "Giá trị": 24000 })
    const khong = await xuatMotPhieu(soGia(so).sb, "kho", "k")
    expect(khong.sheets[1].rows[0]).not.toContain("Giá trị")
  })

  it("Chi phí: một sheet, không có dòng", async () => {
    const { sb } = soGia({ expenses: [{ id: "e", expense_date: "2026-10-03", amount: 300000, reference_code: "CP-9", is_paid: true, category: { name: "Xăng", bucket: "operating" } }] })
    const kq = await xuatMotPhieu(sb, "chi", "e")
    expect(kq.ma).toBe("CP-9")
    expect(kq.sheets).toHaveLength(1)
    expect(doc(kq.sheets[0].rows)).toEqual([expect.objectContaining({ "Số tiền": 300000, "Danh mục": "Xăng", Nhóm: "Vận hành" })])
  })

  it.each<[LoaiPhieuXuat, string, Dong]>([
    ["nhap", "PN-1", { receipt_code: "PN-1", status: "completed", total: 1 }],
    ["thu", "PT-1", { receipt_code: "PT-1", receipt_date: "2026-10-01", status: "confirmed", expected_amount: 1 }],
    ["don", "DH-1", { order_code: "DH-1", status: "completed", total: 1 }],
  ])("%s: đọc đúng bảng, ra mã %s", async (loai, ma, p) => {
    const { sb } = soGia({ [CHON_MOT_PHIEU[loai].bang]: [{ id: "z", ...p }] })
    const kq = await xuatMotPhieu(sb, loai, "z")
    expect(kq.ma).toBe(ma)
    expect(kq.sheets[0].rows).toHaveLength(2)
  })

  it("không thấy phiếu / đọc lỗi → NÉM (nút báo đỏ, không ra tệp rỗng)", async () => {
    await expect(xuatMotPhieu(soGia({}).sb, "don", "khong-co")).rejects.toThrow("Không tìm thấy đơn hàng")
    await expect(xuatMotPhieu(soGia({}, { sales_orders: "hết giờ" }).sb, "don", "x")).rejects.toThrow(/hết giờ/)
    const loiDong = soGia({ sales_orders: [{ id: "x", order_code: "DH", status: "draft" }] }, { sales_order_lines: "mạng" })
    await expect(xuatMotPhieu(loiDong.sb, "don", "x")).rejects.toThrow()
  })
})

describe("8 trang chi tiết có nút Xuất Excel của chính phiếu", () => {
  it.each([
    ["src/app/(dashboard)/purchase-returns/[id]/page.tsx", "tra-ncc"],
    ["src/app/(dashboard)/purchasing/receipts/[id]/page.tsx", "nhap"],
    ["src/app/(dashboard)/returns/[id]/page.tsx", "tra-khach"],
    ["src/app/(dashboard)/finance/cash-receipts/[id]/page.tsx", "thu"],
    /* Chi phí không có trang riêng — xem nhanh là chi tiết. */
    ["src/app/(dashboard)/finance/expenses/page.tsx", "chi"],
    ["src/app/(dashboard)/inventory/entries/[id]/page.tsx", "kho"],
    ["src/app/(dashboard)/orders/[id]/page.tsx", "don"],
    ["src/app/(dashboard)/sales-invoices/[id]/page.tsx", "hoa-don"],
  ])("%s", (tep, loai) => {
    expect(readFileSync(tep, "utf8")).toMatch(new RegExp(`<XuatExcelPhieu loai="${loai}" id=\\{`))
  })
})
