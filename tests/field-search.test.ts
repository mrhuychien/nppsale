import { describe, it, expect } from "vitest"
import { maTheoChuoi, dieuKienTruong, soTruongDangTim, chiaNganSach, KHONG_DONG_NAO, type TruongTim } from "../src/lib/search/field-search"
import { MATCH_CAP } from "../src/lib/search/list-search"

/** Client giả: mỗi bảng trả các dòng đã định; ghi lại lệnh để chốt đọc. */
function sbGia(bang: Record<string, Array<Record<string, string>>>) {
  const log: Array<{ bang: string; or?: string; in?: [string, string[]]; eq?: [string, string] }> = []
  const from = (t: string) => {
    const e: (typeof log)[number] = { bang: t }
    log.push(e)
    const q = {
      select: () => q,
      or: (f: string) => { e.or = f; return q },
      in: (c: string, ids: string[]) => { e.in = [c, ids]; return q },
      eq: (c: string, v: string) => { e.eq = [c, v]; return q },
      order: () => q,
      limit: () => q,
      then: (res: (v: unknown) => unknown) => {
        let rows = bang[t] ?? []
        if (e.in) rows = rows.filter((r) => e.in![1].includes(r[e.in![0]]))
        return Promise.resolve({ data: rows, error: null }).then(res)
      },
    }
    return q
  }
  return { sb: { from } as never, log }
}

const HANG: TruongTim = {
  key: "hang", nhan: "Theo mã, tên hàng",
  chuoi: [{
    cotDich: "id",
    buoc: [
      { bang: "products", cotTim: ["sku", "name"], layCot: "id", coOrg: true },
      { bang: "sales_order_lines", theoCot: "product_id", layCot: "order_id" },
    ],
  }],
}

describe("maTheoChuoi — tra theo chuỗi bảng", () => {
  it("sản phẩm → dòng đơn → mã đơn (bỏ trùng)", async () => {
    const { sb, log } = sbGia({
      products: [{ id: "p1" }, { id: "p2" }],
      sales_order_lines: [
        { product_id: "p1", order_id: "o1" }, { product_id: "p1", order_id: "o2" },
        { product_id: "p2", order_id: "o1" }, { product_id: "p9", order_id: "o9" },
      ],
    })
    const m = await maTheoChuoi(sb, HANG.chuoi![0].buoc, "sữa", "org1")
    expect(m).toEqual({ ids: ["o1", "o2"], truncated: false })
    expect(log[0]).toMatchObject({ bang: "products", eq: ["org_id", "org1"] })
    // Bảng hàng hoá có `tim_kd` (mig 177) → thêm vế bỏ dấu.
    expect(log[0].or).toBe('sku.ilike."%sữa%",name.ilike."%sữa%",tim_kd.ilike."%sua%"')
    // Bảng dòng không có org_id — RLS lo; không được lọc org ở đây.
    expect(log[1]).toMatchObject({ bang: "sales_order_lines", in: ["product_id", ["p1", "p2"]] })
    expect(log[1].eq).toBeUndefined()
  })

  it("bước đầu không khớp → dừng, không tra bảng dòng", async () => {
    const { sb, log } = sbGia({ products: [] })
    expect(await maTheoChuoi(sb, HANG.chuoi![0].buoc, "zzz", "org1")).toEqual({ ids: [], truncated: false })
    expect(log.map((l) => l.bang)).toEqual(["products"])
  })

  it("vượt trần mã → truncated (màn phải nói kết quả thiếu)", async () => {
    const nhieu = Array.from({ length: MATCH_CAP + 5 }, (_, i) => ({ product_id: "p1", order_id: `o${i}` }))
    const { sb } = sbGia({ products: [{ id: "p1" }], sales_order_lines: nhieu })
    const m = await maTheoChuoi(sb, HANG.chuoi![0].buoc, "x", "org1")
    expect(m.truncated).toBe(true)
    expect(m.ids).toHaveLength(MATCH_CAP)
  })
})

describe("dieuKienTruong", () => {
  const MA: TruongTim = { key: "ma", nhan: "Theo mã đơn", cotRieng: ["order_code"] }
  it("cột riêng → ilike", () => {
    expect(dieuKienTruong(MA, "DH-01", [])).toBe('order_code.ilike."%DH-01%"')
  })
  it("chuỗi khớp → id.in.(…)", () => {
    expect(dieuKienTruong(HANG, "sữa", [{ ids: ["o1", "o2"], truncated: false }])).toBe("id.in.(o1,o2)")
  })
  /** ⚠ Có chữ mà không khớp gì thì KHÔNG được bỏ qua điều kiện — bỏ qua là ra cả danh sách. */
  it("có chữ mà không khớp gì → điều kiện không dòng nào thoả", () => {
    expect(dieuKienTruong(HANG, "zzz", [{ ids: [], truncated: false }])).toBe(KHONG_DONG_NAO)
  })
  it("ô trống → không có điều kiện", () => {
    expect(dieuKienTruong(HANG, "  ", [])).toBeNull()
  })
  it("ký tự đại diện trong chữ gõ được thoát", () => {
    expect(dieuKienTruong(MA, "50%", [])).toBe('order_code.ilike."%50\\\\%%"')
  })
  /**
   * ⚠ DẤU PHẨY / NGOẶC TRONG CHỮ GÕ. `or=` của PostgREST tách ở `,` và
   *   `(`/`)` — không đặt giá trị trong ngoặc kép thì "DH,01 (x)" làm vỡ
   *   cả câu truy vấn. `"` và `\` trong ngoặc kép phải thoát.
   */
  it("giá trị đặt trong ngoặc kép; \" và \\ được thoát", () => {
    expect(dieuKienTruong(MA, "DH,01 (x)", [])).toBe('order_code.ilike."%DH,01 (x)%"')
    expect(dieuKienTruong(MA, 'a"b', [])).toBe('order_code.ilike."%a\\"b%"')
  })
  it("đếm trường đang tìm", () => {
    expect(soTruongDangTim({ ma: "x", hang: " ", khach: "Minh" })).toBe(2)
  })
})

/** ⚠ Hai trường cùng chạm trần → đường dẫn quá dài. Ngân sách mã là CHUNG. */
describe("chiaNganSach", () => {
  const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`)
  it("tổng mã mọi trường không vượt ngân sách; trường bị cắt đánh dấu thiếu", () => {
    const out = chiaNganSach(
      { hang: [{ ids: ids(100, "o"), truncated: false }], khach: [{ ids: ids(100, "c"), truncated: false }] },
      ["ma", "hang", "khach"], 150
    )
    expect(out.hang[0]).toEqual({ ids: ids(100, "o"), truncated: false })
    expect(out.khach[0].ids).toHaveLength(50)
    expect(out.khach[0].truncated).toBe(true)
  })
  it("dưới ngân sách thì giữ nguyên", () => {
    const k = { hang: [{ ids: ["a"], truncated: false }] }
    expect(chiaNganSach(k, ["hang"], 150)).toEqual(k)
  })
})
