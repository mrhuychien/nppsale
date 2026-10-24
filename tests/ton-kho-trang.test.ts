/**
 * TỒN KHO HIỆN TẠI ĐỌC QUA RPC PHÂN TRANG (mig 255) — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → đợt 4 (24/10/2026
 * "lần lượt hoàn thành toàn bộ"): màn Kho hàng kéo cả bảng tồn theo khu + cả 2.500 mặt hàng kèm đơn vị (≈1 MB) về máy rồi
 * gộp / lọc / tìm / cộng / chia trang. Nay máy chủ làm hết (`ton_kho_trang`, SECURITY INVOKER); máy nhận trang đang xem kèm
 * tổng cộng của CẢ tập đã lọc; sổ chưa chạy 255 → lùi về cách cũ. SQL thật: scripts/sql/thu-255-ton-kho-trang.sql.
 * E2E: e2e/ton-kho-phan-trang.spec.ts (máy tính), e2e/kho-mobile-thiet-ke.spec.ts (điện thoại).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { TONG_RONG, TRAN_TRANG_TON, docTatCaTon, docTrangTon, thamSoRpc, type DongTon } from "@/lib/inventory/ton-kho-trang"
import { chuaCoRpc } from "@/lib/supabase/chua-co-rpc"
import { ghepTrang } from "@/lib/list/ghep-trang"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/255_ton_kho_trang.sql")
const BANG = read("src/components/inventory/stock-balance-table.tsx")
const dem = (s: string, tu: string) => s.split(tu).length - 1

type Loi = { message?: string; code?: string } | null
type Tra = { data: unknown; error: Loi }
function khachGia(tra: (fn: string, args: Record<string, unknown>) => Tra) {
  const goi: Array<{ fn: string; args: Record<string, unknown> }> = []
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      goi.push({ fn, args })
      return tra(fn, args)
    },
  }
  return { sb, goi }
}
const DONG_A = {
  product_id: "a", sku: "SP-0012", name: "Sữa đặc", base_unit: "hộp", status: "active",
  units: [{ unit_name: "thùng", conversion: "24" }],
  sale_qty: "10", sale_value: "10000", date_qty: 5, date_value: 10000, total_qty: "15", total_value: 20000,
  total_count: "2", sum_sale_qty: 10, sum_sale_value: 10000, sum_date_qty: 8, sum_date_value: "11500", sum_total_qty: 18, sum_total_value: 21500,
}
const DONG_C = {
  product_id: "c", sku: "SP-0014", name: "Bánh đậu xanh", base_unit: "hộp", status: "inactive", units: null,
  sale_qty: 0, sale_value: 0, date_qty: 3, date_value: 1500, total_qty: 3, total_value: 1500,
  total_count: 2, sum_sale_qty: 10, sum_sale_value: 10000, sum_date_qty: 8, sum_date_value: 11500, sum_total_qty: 18, sum_total_value: 21500,
}

describe("thamSoRpc — tham số gửi lên hàm", () => {
  it("tìm rỗng → null; offset âm → 0; limit kẹp 1..500; chuỗi tìm gửi nguyên (máy chủ tự bỏ dấu)", () => {
    expect(thamSoRpc({ tim: "  ", conTon: true, sapXep: "ten", offset: -3, limit: 0 })).toEqual({ p_tim: null, p_con_ton: true, p_sap: "ten", p_offset: 0, p_limit: 1 })
    expect(thamSoRpc({ tim: " Sữa Đặc ", conTon: false, sapXep: "gia-tri", offset: 40, limit: 9999 })).toEqual({ p_tim: "Sữa Đặc", p_con_ton: false, p_sap: "gia-tri", p_offset: 40, p_limit: 500 })
    expect(TRAN_TRANG_TON).toBe(500)
  })
})

describe("docTrangTon — gọi ton_kho_trang, đổi dòng thô về dòng màn, tổng cộng của cả tập", () => {
  it("dòng về (số dạng chuỗi, đơn vị jsonb) → DongTon; tong = total_count; tongCong = sum_* (không phải cộng của trang)", async () => {
    const { sb, goi } = khachGia(() => ({ data: [DONG_C, DONG_A], error: null }))
    const kq = await docTrangTon(sb, { tim: "", conTon: true, sapXep: "ten", offset: 0, limit: 20 })
    expect(goi).toEqual([{ fn: "ton_kho_trang", args: { p_tim: null, p_con_ton: true, p_sap: "ten", p_offset: 0, p_limit: 20 } }])
    expect(kq.tong).toBe(2)
    expect(kq.tongCong).toEqual({ saleQty: 10, saleValue: 10000, dateQty: 8, dateValue: 11500, totalQty: 18, totalValue: 21500 })
    expect(kq.rows.map((r) => r.product.id)).toEqual(["c", "a"])
    expect(kq.rows[1]).toEqual({
      product: { id: "a", sku: "SP-0012", name: "Sữa đặc", base_unit: "hộp", status: "active", units: [{ unit_name: "thùng", conversion: 24 }] },
      saleQty: 10, saleValue: 10000, dateQty: 5, dateValue: 10000, totalQty: 15, totalValue: 20000,
    })
    expect(kq.rows[0].product.units).toEqual([])
    expect(kq.rows[0].product.status).toBe("inactive")
  })

  it("trang rỗng: offset 0 → không có gì (tổng 0, tổng cộng 0); offset > 0 → không biết (giữ số cũ)", async () => {
    const { sb } = khachGia(() => ({ data: [], error: null }))
    expect(await docTrangTon(sb, { tim: "xyz", conTon: true, sapXep: "ten", offset: 0, limit: 20 })).toEqual({ rows: [], tong: 0, tongCong: TONG_RONG })
    expect(await docTrangTon(sb, { tim: "", conTon: true, sapXep: "ten", offset: 40, limit: 20 })).toEqual({ rows: [], tong: null, tongCong: null })
  })

  it("máy chủ báo lỗi → ném Error mang code; sổ chưa có hàm là PGRST202 (chuaCoRpc), lỗi quyền thì không", async () => {
    const { sb } = khachGia(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.ton_kho_trang" } }))
    await expect(docTrangTon(sb, { tim: "", conTon: true, sapXep: "ten", offset: 0, limit: 20 })).rejects.toSatisfy((e: unknown) => chuaCoRpc(e))
    const { sb: sb2 } = khachGia(() => ({ data: null, error: { code: "42501", message: "permission denied" } }))
    await expect(docTrangTon(sb2, { tim: "", conTon: true, sapXep: "ten", offset: 0, limit: 20 })).rejects.toSatisfy((e: unknown) => !chuaCoRpc(e) && (e as { code?: string }).code === "42501")
  })
})

describe("docTatCaTon — Xuất Excel đọc HẾT các trang của tập đang lọc", () => {
  const dongN = (n: number) => ({ ...DONG_A, product_id: `p${n}`, sku: `S${n}`, total_count: 5 })
  it("đọc từng trang tới hết (tổng 5, trang 2) → 3 lượt, đủ 5 dòng, cùng bộ lọc / sắp", async () => {
    const tat = [1, 2, 3, 4, 5].map(dongN)
    const { sb, goi } = khachGia((_, a) => ({ data: tat.slice(a.p_offset as number, (a.p_offset as number) + (a.p_limit as number)), error: null }))
    const ds = await docTatCaTon(sb, { tim: "sữa", conTon: false, sapXep: "gia-tri" }, 2)
    expect(ds.map((r) => r.product.id)).toEqual(["p1", "p2", "p3", "p4", "p5"])
    expect(goi.map((g) => [g.args.p_offset, g.args.p_limit, g.args.p_tim, g.args.p_con_ton, g.args.p_sap])).toEqual([
      [0, 2, "sữa", false, "gia-tri"], [2, 2, "sữa", false, "gia-tri"], [4, 2, "sữa", false, "gia-tri"],
    ])
  })
  it("ranh giới trang dịch (dòng lặp giữa hai trang) → không lặp mã; trang về ngắn → dừng", async () => {
    const trang = [[dongN(1), dongN(2)], [dongN(2), dongN(3)], [dongN(4)]]
    let i = 0
    const { sb, goi } = khachGia(() => ({ data: trang[i++] ?? [], error: null }))
    const ds = await docTatCaTon(sb, { tim: "", conTon: true, sapXep: "ten" }, 2)
    expect(ds.map((r) => r.product.id)).toEqual(["p1", "p2", "p3", "p4"])
    expect(goi).toHaveLength(3)
  })
  it("tập rỗng → một lượt, không dòng", async () => {
    const { sb, goi } = khachGia(() => ({ data: [], error: null }))
    expect(await docTatCaTon(sb, { tim: "xyz", conTon: true, sapXep: "ten" })).toEqual([])
    expect(goi).toHaveLength(1)
  })
})

describe("ghepTrang — khoá tuỳ chọn (dòng tồn khoá theo product.id)", () => {
  it("nối trang không lặp mã", () => {
    const d = (id: string): DongTon => ({ product: { id, sku: id, name: id, base_unit: "hộp" }, saleQty: 0, saleValue: 0, dateQty: 0, dateValue: 0, totalQty: 0, totalValue: 0 })
    expect(ghepTrang([d("a"), d("b")], [d("b"), d("c")], (r) => r.product.id).map((r) => r.product.id)).toEqual(["a", "b", "c"])
    expect(ghepTrang([{ id: "a" }], [{ id: "a" }, { id: "b" }]).map((r) => r.id), "khoá mặc định `id`").toEqual(["a", "b"])
  })
})

describe("stock-balance-table.tsx — đường RPC trước, lùi về cách cũ CHỈ khi sổ chưa có hàm", () => {
  it("hỏi RPC theo trang (máy tính: thanh trang; điện thoại: 20 dòng); PGRST202 lần đầu → đường cũ; đường cũ không hỏi lại khi đổi lọc", () => {
    expect(BANG).toContain("docTrangTon(supabase, {")
    expect(BANG).toContain("offset: dienThoai ? 0 : pg.from,")
    expect(BANG).toContain("limit: dienThoai ? BUOC_HIEN : pg.pageSize,")
    expect(BANG).toMatch(/if \(cheDo\.current === null && chuaCoRpc\(err\)\) \{\s+cheDo\.current = "cu"\s+setRpc\(false\)\s+taiCachCu\(supabase, \(\) => cancelled\)/)
    expect(BANG).toContain('if (cheDo.current === "cu") return')
    expect(BANG).toContain("setLoadError(`Không đọc được số liệu tồn kho: ${errorMessage(err)}`)")
  })
  it("ô tìm hỏi máy chủ sau 300 ms ngừng gõ; số dòng / tổng cộng là của cả tập (máy chủ), trang chỉ là phần vẽ", () => {
    expect(BANG).toContain("setTimeout(() => setTimTre(search.trim()), 300)")
    expect(BANG).toContain("if (rpc) return trang")
    expect(BANG).toContain("const soDong = rpc ? tongSo : pivot.length")
    expect(BANG).toContain("(rpc ? pivot : pivot.slice(pg.from, pg.from + pg.pageSize))")
    expect(BANG).toContain("pg.setTotal(soDong)")
    expect(BANG).toContain("if (rpc) return tongCong")
    expect(BANG).toContain("{soDong} sản phẩm — tổng giá trị")
    expect(BANG).toContain("{tongSo} SKU")
  })
  it("Xuất Excel đường RPC đọc hết các trang của tập đang lọc; điện thoại Xem thêm nối trang từ máy chủ không lặp mã", () => {
    expect(BANG).toContain('? await docTatCaTon(createClient(), { tim: timTre, conTon: onlyOnHand, sapXep: dienThoai ? sapXep : "ten" })')
    expect(BANG).toContain("onThem={rpc ? themTrang : undefined}")
    expect(BANG).toContain("setTrang((cu) => ghepTrang(cu, kq.rows, (r) => r.product.id))")
    expect(BANG).toContain("offset: trang.length, limit: BUOC_HIEN")
  })
  it("đường cũ còn nguyên: đọc đủ hai bảng có thứ tự, gộp trên máy (`gopTonTheoSanPham`), không lọc status khi đọc sản phẩm", () => {
    expect(BANG).toContain('.from("v_stock_balance_by_zone")')
    expect(BANG).toMatch(/\.order\("org_id"\)\s+\.order\("product_id"\)\s+\.order\("warehouse_zone"\)\s+\.range\(from, to\)/)
    expect(BANG).toContain("gopTonTheoSanPham(rows, products, onlyOnHand)")
    expect(dem(BANG, "fetchAllForAggregate<")).toBe(2)
  })
})

describe("mig 255 — RPC ton_kho_trang", () => {
  it("VÌ SAO; INVOKER (không definer); luật dòng như màn cũ; tìm theo tim_kd mọi từ; sắp theo tên vi-x-icu khi có; LIMIT 1..500; tổng cộng cửa sổ", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm"')
    expect(MIG).toContain("CREATE OR REPLACE FUNCTION public.ton_kho_trang(")
    expect(MIG).toContain("SECURITY INVOKER")
    expect(MIG).not.toContain("SECURITY DEFINER")
    expect(MIG).toContain("(coalesce(p.status, 'active') = 'active' OR coalesce(t.sale_qty, 0) <> 0 OR coalesce(t.date_qty, 0) <> 0)")
    expect(MIG).toContain("AND (NOT coalesce(p_con_ton, true) OR coalesce(t.sale_qty, 0) + coalesce(t.date_qty, 0) > 0)")
    expect(MIG).toContain("AND coalesce(p.tim_kd, public.khoa_tim_ds(p.sku, p.name, p.barcode)) NOT LIKE '%%' || tu.w || '%%'")
    expect(MIG).toContain("regexp_split_to_table(public.khong_dau(coalesce(p_tim, '')), ' ') AS t(w)")
    expect(MIG).toContain("WHERE collname = 'vi-x-icu') THEN ' COLLATE \"vi-x-icu\"' ELSE '' END")
    expect(MIG).toContain("s.name%s, s.id")
    expect(MIG).toContain("LIMIT least(greatest(coalesce(p_limit, 20), 1), 500);")
    expect(MIG).toContain("count(*) OVER () AS total_count")
    for (const c of ["sum_sale_qty", "sum_sale_value", "sum_date_qty", "sum_date_value", "sum_total_qty", "sum_total_value"]) {
      expect(MIG).toContain(`OVER () AS ${c}`)
    }
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.ton_kho_trang(text, boolean, text, integer, integer) TO authenticated;")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
  })
  it("khám sổ dòng 94; schema gộp; RPC giả e2e; luật ở CLAUDE.md", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 94, 'Mig 255 (RPC ton_kho_trang")
    expect(read("supabase/schema_full.sql")).toContain("CREATE OR REPLACE FUNCTION public.ton_kho_trang(")
    expect(read("e2e/fixture.mjs")).toContain("ton_kho_trang: ({ p_tim, p_con_ton, p_sap, p_offset, p_limit }, { db }) =>")
    expect(read("CLAUDE.md")).toContain("`ton_kho_trang`")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-255-ton-kho-trang.sql")
describe.skipIf(!BO_THU)("mig 255 trên Postgres thử", () => {
  it("10/10 bước đạt (lọc còn tồn / ngừng bán, số liệu, tổng cộng cả tập, tìm, sắp, phân trang, INVOKER, RLS)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("10|10|0")
  })
})
