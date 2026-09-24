import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Những cái có trên pos -> cập nhật ngược về chi tiết.
 *   Pos có trường gì thì chi tiết đơn hàng có trường ấy". Máy chủ giả của e2e
 *   bỏ qua `select`, nên cột và bảng ghép trong câu truy vấn phải chốt ở đây.
 */
const DON = readFileSync("src/app/(dashboard)/orders/[id]/page.tsx", "utf8")
const HD = readFileSync("src/app/(dashboard)/sales-invoices/[id]/page.tsx", "utf8")
const TRA = readFileSync("src/app/(dashboard)/returns/[id]/page.tsx", "utf8")
const LIEN_QUAN = readFileSync("src/components/orders/related-docs.tsx", "utf8")

describe("chi tiết đơn hàng", () => {
  it("người tạo đọc RIÊNG (mig 178) — không ghép vào truy vấn đầu đơn", () => {
    const dau = DON.match(/from\("sales_orders"\)\.select\("id, org_id, order_code[^"]*"\)/)![0]
    expect(dau, "ghép created_by vào câu đầu: DB chưa chạy mig 178 là trắng cả trang").not.toContain("created_by")
    expect(DON).toContain('.select("created_by, creator:users!sales_orders_created_by_fkey(full_name)")')
    expect(DON).toMatch(/label: "Người tạo", value: nguoiTao/)
  })
  it("dòng hiện giảm giá dòng và quy đổi; tổng có Giảm giá đơn", () => {
    expect(DON).toContain("<LineExtra line={line} coCotGiam />")
    expect(DON).toContain("<LineExtra line={line} />")
    /* Bảng máy tính: cột Giảm giá như POS (24/09/2026). */
    expect(DON).toContain('<TableHead className="text-right">Giảm giá</TableHead>')
    expect(DON).toContain("formatCurrency(donGiaTruocGiam(line))")
    expect(DON).toMatch(/function LineExtra[\s\S]*line\.line_discount[\s\S]*giảm \{formatCurrency\(giam\)\}/)
    expect(DON).toMatch(/giamCuaChungTu\(lines\.map/)
    expect(DON).toContain('label="Giảm giá đơn"')
  })
  it("dòng hàng trả kèm đơn mang lý do và ghi chú", () => {
    expect(DON).toMatch(/lines:return_lines\([^)]*note, reason/)
    expect(DON).toMatch(/returnReasonLabel\(l\.reason\)/)
  })
})

describe("chi tiết hóa đơn", () => {
  it("người tạo + tính cho NV thành hai dòng riêng", () => {
    expect(HD).toContain("creator:users!sales_invoices_posted_by_fkey(full_name)")
    expect(HD).toMatch(/label="Tính cho NV" value=\{inv\.sales_user\?\.full_name/)
    expect(HD).toMatch(/label="Người tạo" value=\{inv\.creator\?\.full_name/)
  })
  it("dòng có giảm giá dòng và quy đổi về đơn vị cơ sở", () => {
    expect(HD).toContain("product:products(name, sku, base_unit)")
    expect(HD).toMatch(/Number\(l\.line_discount\) > 0/)
    expect(HD).toMatch(/Number\(l\.quantity\) \* Number\(l\.conversion_factor\)/)
  })
  it("khối hàng đổi trả dùng chung đọc và hiện lý do / ghi chú dòng", () => {
    expect(LIEN_QUAN).toMatch(/return_lines\([^)]*note, reason/)
    expect(LIEN_QUAN).toMatch(/returnReasonLabel\(l\.reason\)/)
  })
})

describe("chi tiết phiếu trả", () => {
  it("dòng mang lý do / ghi chú riêng", () => {
    expect(TRA).toMatch(/from\("return_lines"\)\.select\("[^"]*note, reason/)
    expect(TRA).toContain("Lý do: {RETURN_REASONS.find((x) => x.value === line.reason)")
    expect(TRA).toContain("Ghi chú: {line.note}")
  })
  it("kho nhận đã lưu thì mở ra đúng kho ấy", () => {
    expect(TRA).toMatch(/if \(kho === "sale" \|\| kho === "date"\) setZone\(kho\)/)
  })
})

describe("sửa đơn từ trang chi tiết (chủ nhà 24/09/2026)", () => {
  it("đơn sửa được ở màn làm đơn thì nút sửa dòng và nút sửa thanh toán sang đó", () => {
    expect(DON).toMatch(/isSellEditable\(order\.status\) \? \(\s*<Button[\s\S]{0,200}diHoacMoPos\(router\.push, `\/sell\/edit\/\$\{order\.id\}`\)[\s\S]{0,120}Sửa đơn/)
    expect(DON).toMatch(/isSellEditable\(order\.status\)\s*\?\s*diHoacMoPos\(router\.push, `\/sell\/edit\/\$\{order\.id\}`\)\s*:\s*setEditMode\(true\)/)
  })
  it("tiền hàng HĐ tách Giảm giá dòng như khối tiền POS", async () => {
    const T = readFileSync("src/components/orders/invoice-money-summary.tsx", "utf8")
    expect(T).toContain('label="Giảm giá dòng"')
    expect(HD).toMatch(/lineDiscount=\{lines\.filter\(\(l\) => !l\.is_exchange\)/)
  })
})
