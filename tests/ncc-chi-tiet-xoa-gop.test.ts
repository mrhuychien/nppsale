import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  bangGiaNhap, CHUA_CAP_NHAT, duocGopNcc, duocXoaNcc, giaTriNhapThang, hoSoNcc, lichSuGiaoDich, loiNcc, moTaChungTu,
  nhanHanMuc, phapLyNcc, viecCanHoanThien, VAI_TRO_GOP_NCC, type NccHoSo, type PhieuNhapTom,
} from "@/lib/suppliers/chi-tiet"
import { nccFormRong, nccFormTu, nccPayload } from "@/lib/suppliers/form"

/**
 * Chủ nhà 05/10/2026: "Viết lại giao diện nhà cung cấp chi tiết" · "Xem lại phần xóa NCC?" · "Thêm chức năng gộp NCC".
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
/** Bỏ dòng chú thích (quét từng dòng — xem SKILL "Testing UI by reading source"). */
function code(src: string): string {
  const out: string[] = []
  let trongKhoi = false
  for (const line of src.split("\n")) {
    const t = line.trim()
    if (trongKhoi) {
      if (t.includes("*/")) trongKhoi = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) trongKhoi = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}
const cat = (s: string, dau: string, cuoi: string) => {
  const i = s.indexOf(dau)
  expect(i, `không thấy mốc ${dau}`).toBeGreaterThan(-1)
  const j = s.indexOf(cuoi, i + dau.length)
  expect(j, `không thấy mốc ${cuoi}`).toBeGreaterThan(i)
  return s.slice(i, j)
}

const ncc = (p: Partial<NccHoSo> = {}): NccHoSo => ({
  id: "n1", name: "Chị Huyền", code: "NCC-0001", category: null, contact_name: null, phone: null, email: null,
  address: null, tax_code: null, bank_account: null, bank_name: null, payment_terms: "NET30", notes: null,
  is_active: true, created_at: "2026-09-01T03:00:00Z", ...p,
})
const pn = (p: Partial<PhieuNhapTom> & { id: string }): PhieuNhapTom => ({
  receipt_code: p.id.toUpperCase(), invoice_date: "2026-09-20", status: "completed", total: 0, created_at: "2026-09-20T03:00:00Z", ...p,
})

describe("giaTriNhapThang — Σ phiếu nhập HOÀN THÀNH trong tháng (giờ VN, theo invoice_date)", () => {
  const rows = [
    pn({ id: "a", invoice_date: "2026-10-01", total: 500000 }),
    pn({ id: "b", invoice_date: "2026-10-03", total: 200000, status: "draft" }),
    pn({ id: "c", invoice_date: "2026-10-04", total: 9000000, status: "cancelled" }),
    pn({ id: "d", invoice_date: "2026-09-30", total: 700000 }),
  ]
  it("01:00 ngày 01/10 giờ VN (= 18:00 UTC 30/09) đã là tháng 10 — chỉ phiếu a", () => {
    expect(giaTriNhapThang(rows, new Date("2026-09-30T18:00:00Z"))).toEqual({ tong: 500000, so: 1 })
  })
  it("16:00 UTC 30/09 (23:00 VN) vẫn tháng 9 — chỉ phiếu d", () => {
    expect(giaTriNhapThang(rows, new Date("2026-09-30T16:00:00Z"))).toEqual({ tong: 700000, so: 1 })
  })
})

describe("lichSuGiaoDich — phiếu nhập + phiếu trả NCC + phiếu chi, mới trước", () => {
  const ls = lichSuGiaoDich(
    [pn({ id: "pi1", invoice_date: "2026-09-20", total: 300000 })],
    [{ id: "sr1", return_code: "TN-1", return_date: "2026-09-25", status: "completed", total: 50000, created_at: "2026-09-25T03:00:00Z" }],
    [{ id: "pp1", payable_id: "pay1", amount: 100000, method: "cash", paid_at: "2026-09-22T03:00:00Z" }]
  )
  it("thứ tự theo ngày giảm dần, dẫn về đúng chứng từ", () => {
    expect(ls.map((g) => g.href)).toEqual(["/purchase-returns/sr1", "/payables/pay1", "/purchasing/receipts/pi1"])
  })
  it("phiếu trả NCC hiện số ÂM (làm giảm phải trả), phiếu nhập số dương", () => {
    expect(ls.find((g) => g.loai === "tra")?.soTien).toBe(-50000)
    expect(ls.find((g) => g.loai === "nhap")?.soTien).toBe(300000)
    expect(ls.find((g) => g.loai === "nhap")?.trangThai).toBe("Hoàn thành")
  })
})

describe("bangGiaNhap — giá nhập lần cuối theo mặt hàng × đơn vị", () => {
  const sp = [
    { id: "p1", sku: "SP1", name: "Sữa hộp", base_unit: "hộp" },
    { id: "p2", sku: "SP2", name: "Bánh", base_unit: "gói" },
  ]
  const phieu = [
    pn({ id: "cu", invoice_date: "2026-08-01" }),
    pn({ id: "moi", invoice_date: "2026-09-15" }),
    pn({ id: "nhap", invoice_date: "2026-10-01", status: "draft" }),
  ]
  const dong = [
    { invoice_id: "cu", product_id: "p1", unit_name: "thùng", unit_price: 400000 },
    { invoice_id: "moi", product_id: "p1", unit_name: "thùng", unit_price: 420000 },
    { invoice_id: "cu", product_id: "p1", unit_name: "hộp", unit_price: 18000 },
    { invoice_id: "nhap", product_id: "p1", unit_name: "thùng", unit_price: 999999 },
  ]
  const bg = bangGiaNhap(sp, phieu, dong)
  it("thùng lấy phiếu mới nhất (420.000), bỏ phiếu nháp; hộp tách dòng riêng (không nhân hệ số)", () => {
    expect(bg.find((d) => d.productId === "p1" && d.donVi === "thùng")).toMatchObject({ gia: 420000, phieuId: "moi" })
    expect(bg.find((d) => d.productId === "p1" && d.donVi === "hộp")).toMatchObject({ gia: 18000, phieuId: "cu" })
  })
  it("mặt hàng gắn NCC chưa nhập lần nào vẫn hiện, giá trống", () => {
    expect(bg.find((d) => d.productId === "p2")).toMatchObject({ gia: null, donVi: "gói" })
    expect(bg).toHaveLength(3)
  })
})

describe("hồ sơ / pháp lý / cần hoàn thiện", () => {
  it("ô trống hiện 'Chưa cập nhật' (xám); hạn mức trống = 'Không đặt hạn mức' (không xám)", () => {
    const hs = hoSoNcc(ncc(), null, null)
    expect(hs.find((f) => f.label === "Điện thoại")).toEqual({ label: "Điện thoại", value: CHUA_CAP_NHAT, trong: true })
    expect(hs.find((f) => f.label === "Hạn mức công nợ")).toEqual({ label: "Hạn mức công nợ", value: "Không đặt hạn mức", trong: false })
    expect(hs.find((f) => f.label === "Điều khoản thanh toán")?.value).toBe("Công nợ 30 ngày")
    expect(hs.find((f) => f.label === "Đang phụ trách")?.trong).toBe(true)
    expect(nhanHanMuc(0)).toBe("0đ")
    expect(nhanHanMuc(5000000)).toBe("5.000.000đ")
  })
  it("pháp lý gộp số TK + ngân hàng", () => {
    const pl = phapLyNcc(ncc({ bank_account: "0123", bank_name: "VCB", legal_name: "Cty A" }))
    expect(pl.find((f) => f.label === "Tài khoản ngân hàng")?.value).toBe("0123 · VCB")
    expect(pl.find((f) => f.label === "Tên pháp nhân")?.value).toBe("Cty A")
    expect(pl.map((f) => f.label)).toEqual([
      "Tên pháp nhân", "Mã số thuế", "Loại hình", "Người đại diện", "Số giấy phép ĐKKD", "Ngày cấp", "Địa chỉ đăng ký", "Tài khoản ngân hàng",
    ])
  })
  it("cần hoàn thiện: thiếu MST / SĐT / địa chỉ…, khoảng trắng coi như trống", () => {
    expect(viecCanHoanThien(ncc({ phone: "  ", tax_code: "0312" })).map((v) => v.key)).toEqual(
      ["phone", "address", "contact_name", "bank_account", "legal_name"]
    )
  })
})

describe("xoá / gộp — luật màn hình", () => {
  it("moTaChungTu kể số chứng từ bằng tiếng Việt, bỏ bảng 0 dòng", () => {
    expect(moTaChungTu([{ bang: "purchase_invoices", so: 2 }, { bang: "payables", so: 0 }, { bang: "products", so: 1, nhan: "mặt hàng" }]))
      .toBe("2 phiếu nhập, 1 mặt hàng")
  })
  it("chỉ xoá được khi tong = 0", () => {
    expect(duocXoaNcc({ tong: 0 })).toBe(true)
    expect(duocXoaNcc({ tong: 1 })).toBe(false)
    expect(duocXoaNcc(null)).toBe(false)
  })
  it("gộp: Chủ NPP / Quản lý / Kế toán — không NVBH / thủ kho", () => {
    expect(["owner", "manager", "accountant"].every(duocGopNcc)).toBe(true)
    expect(duocGopNcc("sales")).toBe(false)
    expect(duocGopNcc("warehouse")).toBe(false)
    expect(duocGopNcc(undefined)).toBe(false)
  })
  it("loiNcc bỏ mã máy ở đầu, dịch mã quyền / không tìm thấy", () => {
    expect(loiNcc('NCC_CO_CHUNG_TU: không xoá được nhà cung cấp "A" — đã có 1 phiếu nhập.')).toBe('không xoá được nhà cung cấp "A" — đã có 1 phiếu nhập.')
    expect(loiNcc("KHONG_DU_QUYEN: chỉ Chủ NPP")).toMatch(/không có quyền/)
    expect(loiNcc("KHONG_TIM_THAY_NCC")).toMatch(/Không tìm thấy/)
  })
})

describe("nccPayload — cột mig 232 chỉ gửi khi có giá trị (mã lên trước migration không vỡ)", () => {
  it("tạo mới không điền ô pháp lý → không có khoá mới nào", () => {
    const { payload, loi } = nccPayload({ ...nccFormRong("NCC A") })
    expect(loi).toBeNull()
    for (const k of ["legal_name", "business_type", "representative", "business_license_no", "business_license_date", "registered_address", "credit_limit"]) {
      expect(payload).not.toHaveProperty(k)
    }
    expect(payload).not.toHaveProperty("code")
  })
  it("điền thì gửi; sửa xoá trắng ô đang có → gửi null", () => {
    const f = { ...nccFormRong("NCC A"), legal_name: " Cty A ", credit_limit: 0 as const, business_license_date: "2026-01-02" }
    expect(nccPayload(f).payload).toMatchObject({ legal_name: "Cty A", credit_limit: 0, business_license_date: "2026-01-02" })
    const goc = nccFormTu({ ...ncc({ legal_name: "Cty A", credit_limit: 1000 }) })
    const { payload } = nccPayload({ ...goc, legal_name: "", credit_limit: "" }, goc)
    expect(payload.legal_name).toBeNull()
    expect(payload.credit_limit).toBeNull()
    expect(payload).not.toHaveProperty("representative")
  })
  it("tên trống / hạn mức âm → lỗi, không ghi", () => {
    expect(nccPayload(nccFormRong("  ")).loi).toMatch(/tên/)
    expect(nccPayload({ ...nccFormRong("A"), credit_limit: -1 }).loi).toMatch(/âm/)
  })
})

describe("nguồn: màn chi tiết / vùng nguy hiểm / danh sách / migration", () => {
  const P = code(doc("src/app/(dashboard)/suppliers/[id]/page.tsx"))
  const DZ = code(doc("src/components/suppliers/supplier-danger-zone.tsx"))
  const M = doc("supabase/migrations/232_nha_cung_cap_chi_tiet_xoa_gop.sql")

  it("chi tiết: 5 tab đúng nhãn, mặc định Lịch sử, ?tab=debt vẫn mở Công nợ", () => {
    const nhan = cat(P, "const NHAN_TAB", "}")
    for (const t of ["Lịch sử giao dịch", "Tổng quan", "Bảng giá", "Công nợ", "Thông tin pháp lý"]) expect(nhan).toContain(t)
    expect(P).toContain('const TAB = ["history", "overview", "price_list", "debt", "legal"] as const')
    expect(P).toMatch(/includes\(tabUrl \?\? ""\) \? \(tabUrl as Tab\) : "history"/)
  })
  it("chi tiết: không còn xoá thẳng từ trang; xoá đi qua vùng nguy hiểm", () => {
    expect(P).not.toMatch(/from\("suppliers"\)\s*\.delete\(/)
    expect(P).toContain("<SupplierDangerZone")
  })
  it("vùng nguy hiểm: hỏi so_chung_tu_ncc TRƯỚC, chỉ xoá khi tong = 0, còn lại mời Ngừng hợp tác / Gộp", () => {
    const hoi = cat(DZ, "const hoiXoa = async", "const xoa = async")
    expect(hoi).toContain('supabase.rpc("so_chung_tu_ncc"')
    expect(hoi).toContain("const buoc = buocXoaNcc(so)")
    expect(hoi).toContain(': { b: "co-chung-tu", so }')
    const khoi = cat(DZ, 'tt.b === "co-chung-tu" ?', ") : (")
    expect(khoi).toContain("Ngừng hợp tác")
    expect(khoi).toContain("Gộp vào NCC khác…")
    expect(khoi).not.toContain("xoa(")
    // Mig 233: xoá qua RPC, không xoá thẳng bảng.
    expect(cat(DZ, "const xoa = async", "const ngung = async")).toContain('supabase.rpc("xoa_nha_cung_cap", { p_id: supplier.id, p_xoa_hang: xoaHang })')
    expect(DZ).not.toMatch(/from\("suppliers"\)\s*\.delete\(/)
  })
  it("danh sách: nút Gộp khi chọn ≥ 2, chọn NCC giữ lại trong các NCC đã chọn", () => {
    const L = code(doc("src/app/(dashboard)/suppliers/page.tsx"))
    const nut = cat(L, 'key: "merge"', "}]")
    expect(nut).toContain("disabled: daChon.length < 2")
    expect(cat(L, "<MergeSupplierDialog", "/>")).toContain("chonTrongNguon")
  })
  it("ô chọn NCC trên chứng từ chỉ hiện NCC đang hợp tác", () => {
    for (const f of [
      "src/app/(dashboard)/purchasing/receipts/new/page.tsx",
      "src/app/(dashboard)/purchase-returns/new/page.tsx",
      "src/app/(dashboard)/payables/new/page.tsx",
      "src/lib/pos/load.ts",
    ]) expect(code(doc(f)), f).toMatch(/\.eq\("is_active", true\)/)
    expect(code(doc("src/components/products/product-form.tsx"))).toContain(
      ".filter((s) => s.is_active !== false || s.id === form.primary_supplier_id)"
    )
  })
  it("migration: VÌ SAO, thẻ dollar ASCII, REVOKE hàm nội bộ, chặn xoá BEFORE DELETE, quyền gộp khớp màn hình", () => {
    expect(M).toMatch(/VÌ SAO — chủ nhà 05\/10\/2026/)
    expect(M).not.toMatch(/\$\$/)
    for (const fn of ["_ncc_dem_chung_tu(uuid)", "_ncc_chan_xoa()", "_ncc_nguoi_tao()"]) {
      expect(M).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
    }
    expect(cat(M, "CREATE TRIGGER trg_ncc_chan_xoa", ";")).toContain("BEFORE DELETE ON suppliers")
    const gop = cat(M, "CREATE OR REPLACE FUNCTION public.gop_nha_cung_cap", "$fn$;")
    const vaiTro = /user_role\(\) NOT IN \(([^)]*)\)/.exec(gop)?.[1].replace(/'/g, "").split(",").map((x) => x.trim())
    expect(vaiTro).toEqual([...VAI_TRO_GOP_NCC])
    expect(M).toContain("NOTIFY pgrst, 'reload schema';")
  })
})
