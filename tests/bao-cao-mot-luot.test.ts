/**
 * Chủ nhà 27/09/2026 "muốn nhanh hơn nữa" — mig 204: báo cáo đọc dòng thô MỘT LƯỢT qua hàm máy
 * chủ; phần tính vẫn là mã cũ nên số y hệt. Chưa chạy 204 thì lùi về đọc từng bảng.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { laThieuHam, goiMotLuot } from "@/lib/bao-cao/mot-luot"
import { tuMotLuot, dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { tinhTonTuTho } from "@/lib/bao-cao/nap-kho"
import { giaVonBinhQuanCoSo } from "@/lib/analytics/sales"
import { congBan, danhMucRong } from "@/lib/bao-cao/cong"
import type { SupabaseClient } from "@supabase/supabase-js"

const sbGia = (kq: { data: unknown; error: unknown }) => ({ rpc: vi.fn(async () => kq) }) as unknown as SupabaseClient

describe("gọi hàm máy chủ: chưa có hàm thì lùi, lỗi khác thì NÉM", () => {
  it("nhận ra lỗi chưa có hàm", () => {
    expect(laThieuHam({ code: "PGRST202", message: "Could not find the function public.bao_cao_so_ban" })).toBe(true)
    expect(laThieuHam({ code: "42883", message: "function x does not exist" })).toBe(true)
    expect(laThieuHam({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false)
    expect(laThieuHam(null)).toBe(false)
  })
  it("chưa có hàm → null (nơi gọi đọc từng bảng); lỗi khác → ném, không thành số 0", async () => {
    expect(await goiMotLuot(sbGia({ data: null, error: { code: "PGRST202", message: "x" } }), "f", {}, "đọc")).toBeNull()
    await expect(goiMotLuot(sbGia({ data: null, error: { code: "57014", message: "hết giờ" } }), "f", {}, "đọc số bán")).rejects.toThrow("đọc số bán: hết giờ")
    expect(await goiMotLuot(sbGia({ data: { hd: [] }, error: null }), "f", {}, "đọc")).toEqual({ hd: [] })
  })
})

describe("kết quả một lượt → cùng dạng dòng như đọc từng bảng", () => {
  const dm = danhMucRong()
  dm.sp.set("sua", { ten: "Sữa", sku: "S", thuongHieu: "", ncc: "", donViCoSo: "hộp", donViLon: { ten: "thùng", heSo: 24 }, donVi: [{ ten: "thùng", heSo: 24 }] })
  const mot = {
    hd: [{ id: "h1", invoice_code: "HD1", invoice_date: "2026-09-10", order_id: null, status: "posted", total: "1100", subtotal: "1000", vat: "100", customer_id: "k1", sales_user_id: null, posted_by: "u1", payment_terms: "COD" }],
    dong_hd: [{ id: "l1", invoice_id: "h1", product_id: "sua", unit_name: "thùng", conversion_factor: 24, quantity: 1, unit_price: 1000, line_total: 1000, is_exchange: false }],
    tra: [{ id: "r1", status: "completed", customer_id: "k1", invoice_id: "h1", credit_note_amount: -100, created_at: "2026-09-12T03:00:00+00:00", revenue_date: "2026-09-11", sales_user_id: null, reason: "Hỏng", credit_with_invoice: true, ma: "TH-1" }],
    dong_tra: [{ return_id: "r1", product_id: "sua", unit_name: "hộp", quantity: 2, line_total: 100 }],
    gv: [{ product_id: "sua", sl: 48, tien: 960 }],
    gv_tra: [{ return_id: "r1", product_id: "sua", tien: 40 }],
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tho = tuMotLuot(mot as any)
  it("chuẩn hoá như fetchRevenueInvoicesDu / fetchReturnsRowsDu", () => {
    expect(tho.hd[0]).toMatchObject({ total: 1100, subtotal: 1000, vat: 100, sales_user_id: "" })
    expect(tho.tra[0]).toMatchObject({ credit_note_amount: -100, created_at: "2026-09-11", sales_user_id: null, invoice_id: "h1" })
    expect(tho.traThem.get("r1")).toEqual({ ma: "TH-1", lyDo: "Hỏng", tuSinh: true })
    expect(tho.thieu).toBe(false)
  })
  it("giá vốn bình quân = như giaVonBinhQuanCoSo trên chính các dòng phiếu xuất", () => {
    const cu = giaVonBinhQuanCoSo([
      { product_id: "sua", quantity: 24, qty_in_base_uom: 24, conversion_factor_snapshot: 24, unit_cost: 20 },
      { product_id: "sua", quantity: 24, qty_in_base_uom: 24, conversion_factor_snapshot: 24, unit_cost: 20 },
    ])
    expect(tho.giaVonCoSo.get("sua")).toBe(cu.get("sua"))
    expect(tho.giaVonTra.get("r1")!.total).toBe(40)
  })
  it("dựng dòng bán ra đúng doanh thu thuần / giá vốn", () => {
    const out = dungDongBan({ hoaDon: tho.hd, dongHd: tho.dongHd, tra: tho.tra, dongTra: tho.dongTra, giaVonCoSo: tho.giaVonCoSo, giaVonTra: tho.giaVonTra, nvTra: new Map(), dm })
    const t = congBan(out.dong)
    expect([t.rev, t.ret, t.net, t.cost]).toEqual([1100, 100, 1000, 24 * 20 - 40])
  })
  it("tồn kho: bán 30 ngày + ngày bán gần nhất từ dòng một lượt, bỏ hàng đổi", () => {
    const r = tinhTonTuTho(
      {
        lo: { rows: [{ id: "b1", product_id: "sua", batch_code: "L1", qty_on_hand: 240, unit_cost: 20, expires_at: null, created_at: null }] },
        dong: [
          { ngay: "2026-09-20", invoice_id: "h1", product_id: "sua", unit_name: "thùng", conversion_factor: 24, quantity: 1, is_exchange: false },
          { ngay: "2026-09-25", invoice_id: "h2", product_id: "sua", unit_name: "hộp", conversion_factor: 1, quantity: 5, is_exchange: true },
        ],
        thieu: false,
      },
      "2026-09-27",
      dm
    )
    expect(r.ton[0]).toMatchObject({ sp: "sua", sl: 240, banCuoi: "2026-09-20" })
  })
})

describe("mig 204 đúng luật đọc cũ", () => {
  const sql = readFileSync("supabase/migrations/204_bao_cao_mot_luot.sql", "utf8")
  it("chạy với quyền người gọi (RLS như đọc bảng), trả một jsonb", () => {
    expect((sql.match(/LANGUAGE sql STABLE SECURITY INVOKER/g) || []).length).toBe(3)
    expect(sql).not.toMatch(/LANGUAGE[^\n]*SECURITY DEFINER/)
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })
  it("cùng điều kiện với các hàm đọc cũ", () => {
    expect(sql).toMatch(/i\.status = 'posted'\s+AND i\.invoice_date BETWEEN p_tu AND p_den/)
    expect(sql).toMatch(/r\.revenue_date BETWEEN p_tu AND p_den/)
    expect(sql).toMatch(/l\.is_exchange = false/)
    expect(sql).toMatch(/'Nhập lại từ phiếu trả ' \|\| t\.id::text/)
    expect(sql).toMatch(/p\.status <> 'paid'/)
    expect(sql).toMatch(/T00:00:00\+07:00/)
  })
  it("ba màn dùng đường một lượt, có đường lùi", () => {
    for (const [f, ham] of [["nap-ban-hang", "bao_cao_so_ban"], ["nap-cong-no", "bao_cao_cong_no"], ["nap-kho", "bao_cao_ton_kho"]]) {
      const s = readFileSync(`src/lib/bao-cao/${f}.ts`, "utf8")
      expect(s).toContain(`"${ham}"`)
      expect(s).toMatch(/mot\s*\?/)
    }
  })
})

describe("hồ sơ người dùng đọc song song (mọi trang đều đợi)", () => {
  it("hai câu đọc users trong fetchProfile chạy cùng lúc, không nối đuôi", () => {
    const s = readFileSync("src/hooks/use-auth.tsx", "utf8")
    const f = s.slice(s.indexOf("async function fetchProfile"), s.indexOf("onAuthStateChange"))
    expect(f).toMatch(/await Promise\.all\(\[\s*supabase\s*\.from\("users"\)/)
    expect(f).not.toMatch(/const gg = await supabase/)
  })
})
