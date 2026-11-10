/**
 * Chủ nhà 10/11/2026: "thêm cho tao vào dưới bảng đơn hàng/hóa đơn : Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ
 * chuyển khoản vào số tài khoản của NPP: Ngân hàng Techcombank - … - CONG TY TNHH THUONG MAI GIA HIEU. Thêm vào cạnh ngày
 * hóa đơn giờ tạo hóa đơn."
 * - Câu "Lưu ý" là cài đặt của NPP (`organizations.settings.print_note`, Cài đặt → Cấu hình tổ chức) — in dưới bảng hàng của
 *   hoá đơn bán + đơn đặt hàng (tờ in và Excel "như mẫu in"); KHÔNG ghi cứng số tài khoản vào mã (kho dựng cho nhiều NPP).
 * - Tờ in hoá đơn: "Ngày <ngày HĐ> <giờ tạo>" (`ngayGioHoaDon`); ngày HĐ khác ngày lập thì ghi "(lập …)".
 * Bấm thật: e2e/in-gio-sua-cuoi.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as XLSX from "xlsx"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ngayGioHoaDon } from "@/lib/printing/doc-stamp"
import { tachNhanLuuY } from "@/lib/printing/luu-y-in"
import { orgHeaderFrom } from "@/lib/org/header"
import { SalesInvoice, type SalesInvoiceProps } from "@/components/printing/sales-invoice"
import { CHON_MOT_PHIEU, CO_LUU_Y_IN, xuatMotPhieu } from "@/lib/xuat-excel/mot-phieu"
import { dungMauIn, mauBanHang } from "@/lib/xuat-excel/mau-in"
import { nenXlsx, type SheetDinhDang } from "@/lib/xuat-excel/xlsx-dinh-dang"

const CAU =
  "Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ chuyển khoản vào số tài khoản của NPP: Ngân hàng Techcombank - " +
  "666888696 - CONG TY TNHH THUONG MAI GIA HIEU."
const THAN = CAU.slice("Lưu ý: ".length)

describe("ngày hoá đơn + giờ tạo hoá đơn (ngayGioHoaDon)", () => {
  it.each([
    ["lập cùng ngày → ngày HĐ + giờ lập (giờ VN)", "2026-11-10", "2026-11-10T02:15:00Z", "10/11/2026 09:15"],
    ["0h30 giờ VN — ngày UTC còn là hôm trước, vẫn CÙNG ngày", "2026-11-10", "2026-11-09T17:30:00Z", "10/11/2026 00:30"],
    ["23h59 giờ VN", "2026-11-10", "2026-11-10T16:59:00Z", "10/11/2026 23:59"],
    ["bài e2e: HD-E2E-1", "2026-09-23", "2026-09-23T08:00:00Z", "23/09/2026 15:00"],
    ["Sửa HĐ giữ ngày tờ cũ / chọn ngày cũ → ghi rõ lúc lập", "2026-11-08", "2026-11-10T03:30:00Z", "08/11/2026 (lập 10/11/2026 10:30)"],
    ["ngày HĐ sau ngày lập", "2026-11-11", "2026-11-10T03:30:00Z", "11/11/2026 (lập 10/11/2026 10:30)"],
    ["thiếu giờ tạo → chỉ ngày như trước", "2026-11-10", null, "10/11/2026"],
    ["giờ tạo hỏng → chỉ ngày", "2026-11-10", "hỏng", "10/11/2026"],
    ["ngày HĐ hỏng → ngày giờ lập", "hỏng", "2026-11-10T03:30:00Z", "10/11/2026 10:30"],
    ["không có gì", null, null, "—"],
  ])("%s", (_ten, ngay, lap, ra) => {
    expect(ngayGioHoaDon(ngay, lap)).toBe(ra)
  })
})

describe("tách nhãn câu Lưu ý (in đậm nhãn)", () => {
  it("câu của chủ nhà: nhãn 'Lưu ý:' + phần còn lại nguyên văn", () => {
    expect(tachNhanLuuY(CAU)).toEqual({ nhan: "Lưu ý:", than: THAN })
    expect(tachNhanLuuY(`  ${CAU}\n`)).toEqual({ nhan: "Lưu ý:", than: THAN })
    expect(tachNhanLuuY("Lưu ý : dòng 1\ndòng 2")).toEqual({ nhan: "Lưu ý:", than: "dòng 1\ndòng 2" })
    expect(tachNhanLuuY("Chuyển khoản: 666")).toEqual({ nhan: "Chuyển khoản:", than: "666" })
  })
  it("không có nhãn ngắn ở đầu → không in đậm gì; trống → không in", () => {
    for (const t of [
      "Khách hàng chỉ chuyển khoản vào tài khoản của NPP.",
      "Khách hàng thanh toán bằng tiền mặt và chỉ chuyển khoản vào số tài khoản của NPP: Ngân hàng",
      "https://npp.sale/tt",
      "8:30 mở cửa",
    ]) expect(tachNhanLuuY(t), t).toEqual({ nhan: null, than: t })
    expect(tachNhanLuuY("  \n ")).toBeNull()
    expect(tachNhanLuuY(null)).toBeNull()
    expect(tachNhanLuuY(undefined)).toBeNull()
  })
})

describe("câu Lưu ý là CÀI ĐẶT CỦA NPP (settings.print_note)", () => {
  it("đọc qua orgHeaderFrom — cắt khoảng trắng, trống / không phải chữ = không có", () => {
    expect(orgHeaderFrom({ name: "NPP", settings: { print_note: `  ${CAU}  ` } }).printNote).toBe(CAU)
    expect(orgHeaderFrom({ name: "NPP", settings: { print_note: "   " } }).printNote).toBeNull()
    expect(orgHeaderFrom({ name: "NPP", settings: { print_note: 5 } }).printNote).toBeNull()
    expect(orgHeaderFrom({ name: "NPP", settings: {} }).printNote).toBeNull()
    expect(orgHeaderFrom(null).printNote).toBeNull()
  })
  it("màn Cấu hình tổ chức sửa được câu, lưu GỘP vào settings (không xoá khoá khác)", () => {
    const s = readFileSync("src/app/(dashboard)/settings/org/page.tsx", "utf8")
    expect(s).toContain('<Label htmlFor="luu-y-in">Lưu ý in dưới bảng hàng</Label>')
    expect(s).toContain("setPrintNote(h.printNote ?? \"\")")
    expect(s).toMatch(/settings: \{\s*\.\.\.existing,[\s\S]*print_note: trimmed\(printNote\),/)
  })
  it("KHÔNG ghi cứng số tài khoản / tên chủ tài khoản vào mã hay migration (kho dựng cho nhiều NPP)", () => {
    const tep: string[] = []
    const di = (d: string) => {
      for (const t of readdirSync(d)) {
        const p = join(d, t)
        if (statSync(p).isDirectory()) di(p)
        else if (/\.(tsx?|sql|mjs|js|json)$/.test(t)) tep.push(p)
      }
    }
    di("src")
    di("supabase")
    const lo = tep.filter((p) => /666888696|THUONG MAI GIA HIEU/i.test(readFileSync(p, "utf8")))
    expect(lo).toEqual([])
  })
})

const LINE = { id: "1", name: "Sữa", spec: "SUA1", unitName: "thùng", quantity: 2, unitPrice: 450000, discount: 0, lineTotal: 900000 }
const veTo = (p: Partial<SalesInvoiceProps>) =>
  renderToStaticMarkup(createElement(SalesInvoice, {
    org: { name: "NPP Thử" }, invoiceNumber: "HD-1", issuedAt: new Date("2026-11-10T12:00:00+07:00"), issuedHasTime: false,
    customerName: "Cô Ba", lines: [LINE], total: 900000, ...p,
  }))

describe("tờ in SalesInvoice (hoá đơn + đơn đặt hàng)", () => {
  it("câu Lưu ý nằm NGAY DƯỚI BẢNG hàng (sau bảng, trước chân tờ / ô ký), nhãn đậm", () => {
    const html = veTo({ org: { name: "NPP Thử", printNote: CAU } })
    const ly = html.indexOf('data-testid="luu-y-in"')
    expect(ly).toBeGreaterThan(html.indexOf("</table>"))
    expect(ly).toBeLessThan(html.indexOf("Người nhận hàng"))
    expect(html).toContain(`<span class="font-bold">Lưu ý: </span>${THAN}`)
  })
  it("NPP chưa đặt câu → không in dòng nào", () => {
    expect(veTo({})).not.toContain("luu-y-in")
    expect(veTo({ org: { name: "NPP Thử", printNote: "  " } })).not.toContain("luu-y-in")
  })
  it("issuedText thay dòng ngày dưới tiêu đề; không có thì như cũ (đơn hàng: chỉ ngày)", () => {
    expect(veTo({ issuedText: "10/11/2026 09:15" })).toContain(">Ngày 10/11/2026 09:15</p>")
    expect(veTo({})).toContain(">Ngày 10/11/2026</p>")
    // Ngày ký ở chân tờ vẫn theo `issuedAt`.
    expect(veTo({ issuedText: "08/11/2026 (lập 10/11/2026 10:30)", issuedAt: new Date("2026-11-08T12:00:00+07:00") }))
      .toContain("Ngày 08 tháng 11 năm 2026")
  })
})

describe("hai màn in dùng đúng luật", () => {
  const HD = readFileSync("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx", "utf8")
  const DON = readFileSync("src/app/(dashboard)/orders/[id]/print/page.tsx", "utf8")
  it("hoá đơn: ngày HĐ + giờ tạo (đọc created_at), câu Lưu ý của NPP", () => {
    expect(HD).toContain("issuedText={ngayGioHoaDon(inv.invoice_date, inv.created_at)}")
    expect(HD).toContain("issuedAt={ngayChungTu(inv.invoice_date)}")
    expect(HD).toMatch(/\.from\("sales_invoices"\)\s*\.select\(\s*"[^"]*\bcreated_at\b/)
    expect(HD).toContain("printNote: org.printNote")
  })
  it("đơn đặt hàng: câu Lưu ý của NPP; ngày vẫn chỉ NGÀY đơn (chủ nhà chỉ nói giờ tạo HÓA ĐƠN)", () => {
    expect(DON).toContain("printNote: org.printNote")
    expect(DON).toContain("issuedAt={ngayChungTu(order.order_date)}")
    expect(DON).toContain("issuedHasTime={false}")
    expect(DON).not.toContain("issuedText")
  })
  it("tờ in POS /in/hoa-don là chính màn in hoá đơn", () => {
    expect(readFileSync("src/app/in/hoa-don/[id]/page.tsx", "utf8")).toContain(
      'export { default } from "@/app/(dashboard)/sales-invoices/[id]/print/page"'
    )
  })
})

/* ------------------------------------------------------------------ Excel "như mẫu in" */

type Dong = Record<string, unknown>
function soGia(bang: Record<string, Dong[]>) {
  const from = (ten: string) => {
    const loc: Array<(r: Dong) => boolean> = []
    const ketQua = () => ({ data: (bang[ten] ?? []).filter((r) => loc.every((f) => f(r))), error: null, count: null })
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { loc.push((r) => r[c] === v); return q },
      neq: (c: string, v: unknown) => { loc.push((r) => r[c] !== v); return q },
      in: (c: string, v: unknown[]) => { loc.push((r) => v.includes(r[c])); return q },
      order: () => q,
      limit: () => q,
      range: () => q,
      maybeSingle: async () => ({ data: ketQua().data[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, sai?: (e: unknown) => unknown) => Promise.resolve(ketQua()).then(ok, sai),
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}
function luoi(sh: SheetDinhDang): string[] {
  const wb = XLSX.read(nenXlsx(XLSX, [sh]))
  return XLSX.utils
    .sheet_to_json<Array<string | number>>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
    .map((r) => r.filter((x) => x !== "").join(" | "))
}
const ORG = { id: "o1", name: "NPP Thử", settings: { print_note: CAU } }
const SUA = { sku: "SUA1", name: "Sữa hộp" }
const so = {
  organizations: [ORG],
  sales_invoices: [{ id: "hd", org_id: "o1", invoice_code: "HD-1", invoice_date: "2026-10-02", created_at: "2026-10-02T03:05:00Z", status: "posted", subtotal: 900000, total: 900000 }],
  sales_invoice_lines: [{ id: "x1", invoice_id: "hd", unit_name: "thùng", quantity: 2, unit_price: 450000, line_total: 900000, product: SUA }],
  sales_orders: [{ id: "d", org_id: "o1", order_code: "DH-1", order_date: "2026-10-01", status: "confirmed", subtotal: 300000, vat: 0, total: 300000 }],
  sales_order_lines: [{ id: "l", order_id: "d", unit_name: "hộp", quantity: 10, unit_price: 30000, line_total: 300000, product: SUA }],
  returns: [{ id: "r1", org_id: "o1", return_code: "TH-1", created_at: "2026-10-01T02:00:00Z", return_date: "2026-10-01", status: "completed", credit_note_amount: 0, customer: { store_name: "Cô Ba" } }],
  return_lines: [],
}

describe("Excel \"như mẫu in\" giống tờ in", () => {
  it("hoá đơn: dòng Ngày có giờ tạo; câu Lưu ý ngay dưới bảng (sau Bằng chữ, trước chân tờ / ô ký)", async () => {
    expect(CHON_MOT_PHIEU["hoa-don"].chon).toMatch(/\bcreated_at\b/)
    const g = luoi((await xuatMotPhieu(soGia(so), "hoa-don", "hd")).sheets[0])
    expect(g).toContain("Ngày 02/10/2026 10:05")
    const ly = g.indexOf(CAU)
    expect(ly, g.join("\n")).toBeGreaterThan(g.findIndex((r) => r.startsWith("Bằng chữ:")))
    expect(ly).toBeLessThan(g.findIndex((r) => r.startsWith("Theo đơn") || r.includes("tháng 10 năm 2026")))
  })
  it("đơn đặt hàng có câu Lưu ý; phiếu trả khách thì không (chủ nhà chỉ nói đơn hàng / hoá đơn)", async () => {
    expect([...CO_LUU_Y_IN].sort()).toEqual(["don", "hoa-don"])
    expect(luoi((await xuatMotPhieu(soGia(so), "don", "d")).sheets[0])).toContain(CAU)
    expect(luoi((await xuatMotPhieu(soGia(so), "tra-khach", "r1")).sheets[0])).not.toContain(CAU)
  })
  it("NPP chưa đặt câu → tệp không có dòng Lưu ý", async () => {
    const g = luoi(dungMauIn(mauBanHang({
      ten: "HD-1", org: { name: "NPP" }, tieuDe: "HÓA ĐƠN BÁN HÀNG", nhanSo: "Số HĐ", so: "HD-1", ngay: null, khach: "Cô Ba",
      lines: [LINE], total: 900000,
    })))
    expect(g.some((r) => r.startsWith("Lưu ý"))).toBe(false)
  })
})
