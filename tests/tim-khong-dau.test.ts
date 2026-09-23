import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { dieuKienTim, BANG_TIM_KHONG_DAU } from "../src/lib/search/list-search"
import { viNormalize } from "../src/lib/search"
import { TRUONG_DON_HANG, TRUONG_HOA_DON, TRUONG_TRA_HANG } from "../src/lib/search/doc-fields"

const MIG = readFileSync(join(__dirname, "../supabase/migrations/177_tim_khong_dau.sql"), "utf8")

/** Bảng → các cột trigger ghép vào `tim_kd` (đọc từ mig 177). */
function cotTrigger(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const re = /ON public\.(\w+)\s+FOR EACH ROW EXECUTE FUNCTION public\._trg_tim_kd\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(MIG)) !== null) {
    out[m[1]] = m[2].split(",").map((x: string) => x.trim().replace(/'/g, ""))
  }
  return out
}

describe("dieuKienTim — gõ không dấu vẫn ra chữ có dấu", () => {
  it("bảng có tim_kd: thêm điều kiện đã bỏ dấu", () => {
    expect(dieuKienTim("products", ["name", "sku"], "Bánh  Đậu")).toBe(
      'name.ilike."%Bánh  Đậu%",sku.ilike."%Bánh  Đậu%",tim_kd.ilike."%banh dau%"'
    )
  })
  it("bảng không có tim_kd: giữ nguyên điều kiện cũ", () => {
    expect(dieuKienTim("sales_orders", ["order_code"], "DH-01")).toBe('order_code.ilike."%DH-01%"')
  })
  it("ký tự đại diện và ngoặc kép vẫn được thoát ở vế bỏ dấu", () => {
    expect(dieuKienTim("customers", [], 'Mẹ "Tú" 50%')).toBe('tim_kd.ilike."%me \\"tu\\" 50\\\\%%"')
  })
})

/**
 * ⚠ LUẬT BỎ DẤU CỦA HAI BÊN PHẢI TRÙNG. Các cặp dưới đây cũng là đầu vào của
 *   /tmp/pgtest/t177.sql, nơi `khong_dau()` trên Postgres thật phải ra đúng
 *   từng chuỗi. Đổi `viNormalize` mà cặp nào lệch là phải sửa cả mig 177.
 */
describe("viNormalize — cặp mẫu dùng chung với khong_dau()", () => {
  const CAP: Array<[string, string]> = [
    ["Bánh Đậu Xanh H25", "banh dau xanh h25"],
    ["  Kẹo   mút ĐẦU to ", "keo mut dau to"],
    ["Ỷ Ỵ ỹ Ứ ự ổ Ờ", "y y y u u o o"],
    ["ưƠơĂâÊêÔô", "uooaaeeoo"],
    ["Bánh Đậu", "banh dau"],
    ["Kẹo dẻo\tbắp\n400g", "keo deo bap 400g"],
    ["Tạp hoá Minh Châu", "tap hoa minh chau"],
  ]
  it.each(CAP)("%j → %j", (vao, mong) => {
    expect(viNormalize(vao)).toBe(mong)
  })
})

describe("mig 177 khớp với chỗ tìm", () => {
  const trg = cotTrigger()
  it("mọi bảng trong BANG_TIM_KHONG_DAU đều có trigger tim_kd", () => {
    expect(Object.keys(trg).sort()).toEqual(Array.from(BANG_TIM_KHONG_DAU).sort())
  })
  it("cột tìm của các ô 'Theo tên hàng / khách' đều nằm trong tim_kd", () => {
    const buoc = [...TRUONG_DON_HANG, ...TRUONG_HOA_DON, ...TRUONG_TRA_HANG]
      .flatMap((t) => t.chuoi ?? [])
      .map((c) => c.buoc[0])
      .filter((b) => BANG_TIM_KHONG_DAU.has(b.bang))
    expect(buoc.length).toBeGreaterThan(0)
    for (const b of buoc) {
      for (const c of b.cotTim ?? []) expect(trg[b.bang], `${b.bang}.${c}`).toContain(c)
    }
  })
  it("luật SQL có đủ các bước của viNormalize", () => {
    expect(MIG).toMatch(/normalize\(COALESCE\(p, ''\), NFC\)/)
    expect(MIG).toMatch(/'đ', 'd'\), 'Đ', 'D'/)
    expect(MIG).toMatch(/lower\(/)
    expect(MIG).toContain("\\u00a0")
    expect(MIG).toMatch(/btrim\(regexp_replace/)
  })
})

/** Không màn nào tự dựng `ilike` trên bảng có tim_kd — phải qua `dieuKienTim`. */
describe("không còn chỗ tìm bỏ qua dieuKienTim", () => {
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f)) files.push(p)
    }
  }
  walk(join(__dirname, "../src"))
  it("ilike thô (`.ilike.%`) không còn trong src", () => {
    const hit = files.filter((f) => /\.ilike\.%\$\{/.test(readFileSync(f, "utf8")))
    expect(hit).toEqual([])
  })
  it("ilikeDk chỉ dùng trong lib/search và màn hoá đơn điện tử", () => {
    const hit = files
      .filter((f) => !f.includes("/lib/search/") && !f.endsWith("/invoices/page.tsx"))
      .filter((f) => /ilikeDk\(/.test(readFileSync(f, "utf8")))
    expect(hit).toEqual([])
  })
})
