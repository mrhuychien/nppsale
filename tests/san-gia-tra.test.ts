import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import {
  GIAM_TOI_DA_GIA_TRA_PCT,
  cauGiaTraSai,
  duoiSanGiaTra,
  giaDaBanThapNhat,
  returnCeilingFor,
  returnFloorFor,
  returnPriceViolation,
  sanGiaTra,
} from "../src/lib/sell/returns"
import { errorMessage } from "../src/lib/errors"
import { explainInvoiceError } from "../src/lib/orders/post-invoice"
import { formatCurrency } from "../src/lib/utils"

/**
 * Chủ nhà 15/11/2026: "Em xử lý thêm phần hàng trả lại, giá trả không được thấp quá 20% giá niêm yết" — sàn giá trả
 * (app `sanGiaTra` + máy chủ mig 263). Trước đó hạ giá trả luôn được, kể cả xuống 0.
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
/** Bỏ chú thích — soát mã, không soát lời giải thích. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const MIG = read("supabase/migrations/263_san_gia_tra.sql")

describe("sanGiaTra — 80% giá niêm yết, hoá đơn bán rẻ hơn thì giá đã bán", () => {
  it("20% là con số của chủ nhà", () => {
    expect(GIAM_TOI_DA_GIA_TRA_PCT).toBe(20)
  })
  it("sàn = round(niêm yết × 80%) — đúng đơn vị (lon 10.000 → 8.000; thùng 228.000 → 182.400; số lẻ làm tròn)", () => {
    expect(sanGiaTra(10_000)).toBe(8_000)
    expect(sanGiaTra(228_000)).toBe(182_400)
    expect(sanGiaTra(12_345)).toBe(9_876)
    expect(sanGiaTra(10_001)).toBe(8_001)
  })
  it("chưa có giá niêm yết (0 / âm / không phải số) → không có sàn", () => {
    expect(sanGiaTra(0)).toBe(0)
    expect(sanGiaTra(-5)).toBe(0)
    expect(sanGiaTra(Number.NaN)).toBe(0)
  })
  it("hoá đơn gắn phiếu bán RẺ hơn sàn → sàn là giá đã bán (kể cả hàng tặng 0đ); bán cao hơn sàn → giữ 80%", () => {
    expect(sanGiaTra(10_000, 5_000)).toBe(5_000)
    expect(sanGiaTra(10_000, 0)).toBe(0)
    expect(sanGiaTra(10_000, 9_500)).toBe(8_000)
    expect(sanGiaTra(10_000, null)).toBe(8_000)
    expect(sanGiaTra(10_000, -1)).toBe(8_000)
  })
})

describe("returnPriceViolation — sàn đi cùng trần", () => {
  it("dưới sàn quá 1 đồng → below_floor; đúng sàn / dung sai 1đ → hợp lệ (như máy chủ)", () => {
    expect(returnPriceViolation({ price: 7_998 }, 10_000)).toBe("below_floor")
    expect(returnPriceViolation({ price: 7_999 }, 10_000)).toBeNull()
    expect(returnPriceViolation({ price: 8_000 }, 10_000)).toBeNull()
    expect(returnPriceViolation({ price: 0 }, 10_000)).toBe("below_floor")
  })
  it("trần vẫn như cũ", () => {
    expect(returnPriceViolation({ price: 10_001 }, 10_000)).toBe("above_ceiling")
    expect(returnPriceViolation({ price: 10_500 }, 10_000, { maxIncreasePct: 5 })).toBeNull()
  })
  it("dòng HÀNG ĐỔI không tính tiền → không trần, không sàn; giá âm vẫn chặn", () => {
    expect(returnPriceViolation({ price: 0, isExchange: true }, 10_000)).toBeNull()
    expect(returnPriceViolation({ price: 99_999, isExchange: true }, 10_000)).toBeNull()
    expect(returnPriceViolation({ price: -1, isExchange: true }, 10_000)).toBe("negative")
  })
  it("chủ NPP / kế toán (free) → không sàn", () => {
    expect(returnPriceViolation({ price: 0 }, 10_000, { maxIncreasePct: 0, free: true })).toBeNull()
    expect(returnFloorFor(10_000, { maxIncreasePct: 0, free: true })).toBe(0)
    expect(returnFloorFor(10_000, { maxIncreasePct: 0 })).toBe(8_000)
  })
  it("phiếu gắn hoá đơn: trần theo giá đã bán, sàn theo giá niêm yết riêng + ngoại lệ giá đã bán", () => {
    // Bán 12.000 (trên bảng) → trần 12.000; sàn vẫn 80% niêm yết 10.000 = 8.000.
    expect(returnPriceViolation({ price: 8_000 }, 12_000, { maxIncreasePct: 0 }, { niemYet: 10_000 })).toBeNull()
    expect(returnPriceViolation({ price: 7_000 }, 12_000, { maxIncreasePct: 0 }, { niemYet: 10_000 })).toBe("below_floor")
    // Bán 5.000 (khuyến mãi) → trả đúng 5.000 được, 4.000 không.
    expect(returnPriceViolation({ price: 5_000 }, 5_000, { maxIncreasePct: 0 }, { niemYet: 10_000, daBan: 5_000 })).toBeNull()
    expect(returnPriceViolation({ price: 4_000 }, 5_000, { maxIncreasePct: 0 }, { niemYet: 10_000, daBan: 5_000 })).toBe("below_floor")
  })
  it("chưa có giá niêm yết → không sàn, không trần", () => {
    expect(returnPriceViolation({ price: 1 }, 0)).toBeNull()
  })
})

describe("duoiSanGiaTra — chỉ sàn (màn POS: trần do máy chủ chốt theo giá đã bán)", () => {
  it("không đụng trần dù giá rất cao; dưới sàn → true", () => {
    expect(duoiSanGiaTra({ price: 1_000_000_000 }, 10_000, { free: false })).toBe(false)
    expect(duoiSanGiaTra({ price: 5_000 }, 10_000, { free: false })).toBe(true)
    expect(duoiSanGiaTra({ price: 5_000 }, 10_000, { free: false }, 5_000)).toBe(false)
  })
  it("dòng đổi / chủ-kế toán / chưa có giá → false", () => {
    expect(duoiSanGiaTra({ price: 0, isExchange: true }, 10_000, { free: false })).toBe(false)
    expect(duoiSanGiaTra({ price: 0 }, 10_000, { free: true })).toBe(false)
    expect(duoiSanGiaTra({ price: 0 }, 0, { free: false })).toBe(false)
  })
})

describe("giaDaBanThapNhat — như min(unit_price) của máy chủ", () => {
  const dong = [
    { productId: "a", unit: "lon", price: 9_500 },
    { productId: "a", unit: "lon", price: 9_000 },
    { productId: "a", unit: "lon", price: 0, isExchange: true },
    { productId: "a", unit: "thùng", price: 1_000 },
    { productId: "b", unit: "lon", price: 100 },
  ]
  it("đúng mặt hàng + ĐÚNG đơn vị, bỏ dòng hàng đổi 0đ, lấy số thấp nhất", () => {
    expect(giaDaBanThapNhat(dong, "a", "lon")).toBe(9_000)
    expect(giaDaBanThapNhat(dong, "a", "thùng")).toBe(1_000)
  })
  it("không có dòng nào → null", () => {
    expect(giaDaBanThapNhat(dong, "c", "lon")).toBeNull()
    expect(giaDaBanThapNhat([], "a", "lon")).toBeNull()
  })
})

describe("câu báo nói đúng con số", () => {
  it("sàn: tối thiểu bao nhiêu + vì sao", () => {
    const c = cauGiaTraSai("below_floor", { san: 8_000 }, formatCurrency)
    expect(c).toContain("tối thiểu " + formatCurrency(8_000))
    expect(c).toContain("không dưới giá niêm yết quá 20%")
  })
  it("trần: tối đa bao nhiêu", () => {
    expect(cauGiaTraSai("above_ceiling", { tran: returnCeilingFor(10_000, { maxIncreasePct: 5 }) }, formatCurrency))
      .toBe("Giá trả vượt trần — tối đa " + formatCurrency(10_500))
  })
  it("lỗi máy chủ dịch ra tiếng Việt, giữ câu gốc có số", () => {
    const goc = "RETURN_PRICE_BELOW_FLOOR: Giá trả 5.000 thấp hơn mức tối thiểu 8.000 (giá niêm yết 10.000, không được thấp hơn quá 20%)."
    const m = errorMessage({ message: goc, code: "P0001" })
    expect(m).toContain("Máy chủ từ chối: giá trả thấp hơn mức tối thiểu")
    expect(m).toContain("thấp hơn mức tối thiểu 8.000")
    expect(explainInvoiceError(goc)).toBe(
      "Hàng trả: Giá trả 5.000 thấp hơn mức tối thiểu 8.000 (giá niêm yết 10.000, không được thấp hơn quá 20%)."
    )
  })
})

describe("mig 263 — trigger sàn trên return_lines", () => {
  it("khối VÌ SAO trích lời chủ nhà + ngày", () => {
    expect(MIG).toContain("VÌ SAO — chủ nhà 15/11/2026")
    expect(MIG).toContain("giá trả không được thấp quá 20% giá niêm yết")
  })
  it("cùng con số 20 với app", () => {
    expect(MIG).toContain(`v_san := round(v_ny * (100 - ${GIAM_TOI_DA_GIA_TRA_PCT}) / 100);`)
  })
  it("trigger tên xếp SAU trg_don_vi_rong_la_co_so (đơn vị rỗng quy về cơ sở trước khi tra giá)", () => {
    expect(MIG).toContain("CREATE TRIGGER trg_gia_san_dong_tra")
    expect("trg_gia_san_dong_tra" > "trg_don_vi_rong_la_co_so").toBe(true)
  })
  it("hàm trigger SECURITY DEFINER đã REVOKE; kết thúc bằng NOTIFY + câu SELECT tóm tắt", () => {
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._chot_gia_san_dong_tra() FROM PUBLIC, anon, authenticated;")
    const sau = MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))
    expect(sau).toMatch(/^NOTIFY pgrst, 'reload schema';\s+(--[^\n]*\n)*WITH duoi_san AS \(/)
  })
  it("câu khám sổ thật có dòng 102; tệp gộp đã dựng lại", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 102, 'Mig 263 (Sàn giá trả: không dưới giá niêm yết quá 20%)'")
    expect(read("supabase/schema_full.sql")).toContain("CREATE TRIGGER trg_gia_san_dong_tra")
  })
})

describe("mọi màn nhập giá trả báo + chặn lưu khi dưới sàn", () => {
  it("POS đơn hàng: ô giá đỏ + chặn Lưu nháp / Gửi / Lưu / F6 / F9 + kiểm trong hàm lưu", () => {
    const s = code(read("src/components/pos/order-screen.tsx"))
    expect(s).toContain("duoi: duoiSanGiaTra(l, niemYet, { free: giaTuDo })")
    expect(s).toContain("if (soTraDuoiSan > 0) { toast({ title: \"Giá hàng trả thấp quá\"")
    expect(s).toContain("disabled={dangLuu || lines.length === 0 || donHo || soTraDuoiSan > 0}")
    expect(s).toContain("disabled={lines.length === 0 || !khach || coGiaXau || soTraDuoiSan > 0 || dangLuu}")
    expect(s).toContain("disabled={!chuaLuuThayDoi || lines.length === 0 || !khach || coGiaXau || soTraDuoiSan > 0 || dangLuu}")
    expect(s).toContain("!daGui && soTraDuoiSan === 0) void luuDon(true)")
    expect(s).toContain("if (dangLuu || lines.length === 0 || !khach || coGiaXau || soTraDuoiSan > 0) return")
  })
  it("POS hoá đơn: dòng trả mới + dòng cũ đổi đơn vị; ngoại lệ giá đã bán theo dòng bán của CHÍNH tờ; chặn Xuất hàng", () => {
    const s = code(read("src/components/pos/invoice-screen.tsx"))
    expect(s).toContain("const daBan = giaDaBanThapNhat(dongBanTo, productId, unit)")
    expect(s).toContain("l.suaDuoc && soTraCu(l) > 0 && dvTraCu(l) !== l.unit")
    expect(s).toContain("if (soTraDuoiSan > 0) { toast({ title: \"Giá hàng trả thấp quá\"")
    expect(s).toContain("disabled={!!khoa || soDong === 0 || dangLuu || dangTai || !!loi || soTraDuoiSan > 0}")
  })
  it("POS trả hàng: ngoại lệ theo dòng hoá đơn gốc (kể cả khi mở lại phiếu cũ); chặn Lưu nháp + Ghi nhận", () => {
    const s = code(read("src/components/pos/return-screen.tsx"))
    expect(s).toContain("const daBan = invoiceId ? giaDaBanThapNhat(dongHdGoc, l.productId, l.unit) : null")
    expect(s).toContain("loadInvoiceLinesForReturn(sb, r.invoice_id)")
    expect(s).toContain("if (soDuoiSan > 0) { toast({ title: \"Giá trả thấp quá\"")
    expect(s).toContain("(mode !== \"sua\" && soDuoiSan > 0)")
    expect(s).toContain("!khach || soDuoiSan > 0}")
  })
  it("điện thoại: phiếu trả mới, giỏ hàng, màn hàng trả, tấm sửa dòng", () => {
    expect(code(read("src/app/(dashboard)/returns/new/page.tsx"))).toContain("Có dòng trả dưới giá tối thiểu")
    expect(code(read("src/components/returns/phieu-tra-khach-mobile.tsx"))).toContain("Giá trả thấp quá — tối thiểu")
    expect(code(read("src/app/(dashboard)/sell/cart/page.tsx"))).toContain("returnPriceBad > 0")
    expect(code(read("src/components/sell/return-line-sheet.tsx"))).toContain('bad === "below_floor"')
  })
})

function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(ROOT, tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-263-san-gia-tra.sql")
describe.skipIf(!BO_THU)("mig 263 trên Postgres thử", () => {
  it("12/12 dòng đạt (sàn đúng đơn vị + nhóm giá, hàng đổi, vai, gắn hoá đơn, sửa dòng, lập đơn kèm trả, Xuất hàng thêm trả)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("12|12|0")
  })
})
