import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * HOÀN KHO KHI HUỶ HOÁ ĐƠN — `_wf2_restock`.
 *
 * ⚠ BỘ CHỐT NÀY SINH RA TỪ MỘT LỖI CHỦ NHÀ GẶP TRÊN SỔ THẬT:
 *     NO_BATCH_TO_RESTOCK: không tìm được lô để hoàn 1.000000 đơn vị
 *
 * Nấc cuối của `_wf2_restock` (migration 120) ghim cứng
 * `warehouse_zone = 'sale'`, trong khi phép XUẤT (`post_stock_export`,
 * migration 119) lấy hàng ở KHO NÀO CŨNG ĐƯỢC. Nên mặt hàng chỉ có lô
 * ở kho cận date bán ra bình thường mà huỷ hoá đơn thì không hoàn
 * được — và nó chỉ nổ trên dòng xuất KHÔNG CÓ DẤU VẾT LÔ, tức chứng từ
 * cũ trước migration 119.
 *
 * Đã tái hiện và đã vá trên Postgres 16 thật (migration 156).
 *
 * ⚠ CHỐT ĐỌC SQL, VÌ KHÔNG CÓ CÁCH NÀO CHẠY PLPGSQL TRONG VITEST. Nên
 * mỗi chốt bám vào một LUẬT kiểm được bằng mắt trên câu SQL, và nói rõ
 * luật ấy hỏng thì mất gì.
 */

const ROOT = resolve(__dirname, "..")
const DIR = resolve(ROOT, "supabase/migrations")

/** Bản `_wf2_restock` MỚI NHẤT — bản máy chủ thật sự đang chạy. */
function banMoiNhat(): { ten: string; sql: string } {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  let ten = ""
  let sql = ""
  for (const f of files) {
    const s = readFileSync(resolve(DIR, f), "utf-8")
    const i = s.indexOf("CREATE OR REPLACE FUNCTION public._wf2_restock")
    if (i < 0) continue
    /* `CREATE OR REPLACE` sau đè trước — bản cuối cùng mới là bản chạy. */
    ten = f
    sql = s.slice(i, s.indexOf("\n$$;", i))
  }
  return { ten, sql }
}

const BAN = banMoiNhat()
/** Bỏ chú thích — chốt không được khớp phải chính câu giải thích. */
const CODE = BAN.sql
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "")

describe("bản _wf2_restock đang chạy", () => {
  /** ⚠ Chốt mù là chốt nói dối — không đọc được hàm thì mọi phép dưới xanh. */
  it("đọc được hàm, và nó nằm ở migration mới hơn 120", () => {
    expect(BAN.sql.length, "không đọc được thân hàm _wf2_restock").toBeGreaterThan(500)
    expect(
      Number(BAN.ten.slice(0, 3)),
      "bản mới nhất vẫn là 120 — bản vá chưa vào"
    ).toBeGreaterThan(120)
  })
})

describe("nấc cuối: tìm lô để hoàn phần không có dấu vết", () => {
  /**
   * ⚠ KHÔNG GHIM CỨNG MỘT VÙNG KHO. Đây đúng là lỗi chủ nhà gặp: hàng
   * rời kho cận date, nấc cuối chỉ tìm ở kho bán, không thấy gì, và
   * người dùng không huỷ nổi tờ hoá đơn.
   */
  it("không còn LỌC cứng warehouse_zone = 'sale'", () => {
    /**
     * ⚠ LUẬT LÀ "KHÔNG LỌC THEO ZONE", KHÔNG PHẢI "KHÔNG NHẮC TỚI ZONE".
     * Bản đầu của chốt này cấm hẳn chuỗi `warehouse_zone = 'sale'` —
     * và nó đỏ oan ngay, vì bậc ưu tiên `CASE … THEN 1` dùng đúng chuỗi
     * ấy một cách hợp lệ. Soi đúng mệnh đề `WHERE` của phép chọn lô.
     */
    const i = CODE.indexOf("FROM batches")
    expect(i, "không thấy phép chọn lô").toBeGreaterThan(-1)
    const j = CODE.indexOf("ORDER BY", i)
    expect(j, "phép chọn lô không có ORDER BY").toBeGreaterThan(i)
    const where = CODE.slice(i, j)
    expect(
      /warehouse_zone/.test(where),
      "mệnh đề WHERE vẫn lọc theo vùng kho — mặt hàng chỉ có lô ở kho cận " +
        "date sẽ không huỷ được hoá đơn, đúng lỗi chủ nhà gặp"
    ).toBe(false)
  })

  /**
   * ⚠ HÀNG RỜI KHO NÀO THÌ VỀ KHO ẤY. Trả hàng cận hạn về kho bán là
   * nó được bán tiếp cho khách sau, và không ai thấy vì tổng tồn vẫn
   * đúng.
   */
  it("ưu tiên đúng vùng kho của phiếu xuất gốc", () => {
    expect(CODE, "không đọc vùng kho của phiếu xuất").toMatch(/se\.warehouse_zone/)
    expect(
      CODE,
      "không xếp ưu tiên theo vùng kho đã rời"
    ).toMatch(/warehouse_zone IS NOT DISTINCT FROM v_zone/)
  })

  /** ⚠ Và vẫn phải có bậc dự phòng, nếu không lại chặn người dùng như cũ. */
  it("có bậc dự phòng về kho bán rồi tới kho bất kỳ", () => {
    const i = CODE.indexOf("IS NOT DISTINCT FROM v_zone")
    expect(i).toBeGreaterThan(-1)
    const khoi = CODE.slice(i, i + 400)
    expect(khoi, "thiếu bậc kho bán").toMatch(/warehouse_zone\s*=\s*'sale'\s+THEN\s+1/)
    expect(khoi, "thiếu bậc kho bất kỳ").toMatch(/ELSE\s+2/)
  })

  /**
   * ⚠ LỌC `org_id`. Đây là hàm `SECURITY DEFINER` nên RLS KHÔNG đỡ hộ:
   * thiếu lọc là lô của đơn vị khác lọt vào phép chọn, và hàng hoàn về
   * kho của người khác.
   */
  it("lọc theo đơn vị", () => {
    const i = CODE.indexOf("FROM batches")
    expect(i).toBeGreaterThan(-1)
    const khoi = CODE.slice(i, i + 300)
    expect(khoi, "phép chọn lô thiếu lọc org_id").toMatch(/org_id\s*=\s*v_org/)
  })
})

describe("nấc 1 — hoàn theo dấu vết lô — không được đụng", () => {
  /**
   * ⚠ TRỪ DẦN DẤU VẾT. Không trừ thì lần hoàn sau lại thấy đủ số cũ:
   * sửa đơn giảm 4 rồi huỷ đơn sẽ hoàn thêm cả 10, kho dôi ra 4 thùng
   * không có thật. Bản vá 156 chép nguyên văn khối này — chốt canh
   * rằng nó còn nguyên.
   */
  it("vẫn trừ dần stock_line_consumptions", () => {
    expect(CODE).toMatch(/UPDATE stock_line_consumptions/)
    expect(CODE).toMatch(/qty_in_base_uom\s*=\s*qty_in_base_uom\s*-\s*v_give/)
  })

  /** ⚠ Và vẫn khoá dòng dấu vết khi đọc — hai lượt huỷ song song là hoàn đôi. */
  it("vẫn FOR UPDATE khi đọc dấu vết", () => {
    const i = CODE.indexOf("FROM stock_line_consumptions")
    expect(i).toBeGreaterThan(-1)
    expect(CODE.slice(i, i + 220)).toMatch(/FOR UPDATE/)
  })

  /** ⚠ Lô ghi trên chính dòng xuất vẫn được ưu tiên trước mọi phép đoán. */
  it("vẫn dùng batch_id của dòng xuất trước khi đoán", () => {
    expect(CODE).toMatch(/IF v_batch IS NULL THEN/)
  })
})

describe("khi không còn lô nào để hoàn", () => {
  /**
   * ⚠ KHÔNG TỰ TẠO LÔ. Đó là dựng hàng từ không khí kèm một giá vốn do
   * máy đoán — quyết định của chủ nhà, không phải của bản vá.
   */
  it("không chèn lô mới vào bảng batches", () => {
    expect(
      /INSERT\s+INTO\s+batches/i.test(CODE),
      "hàm tự tạo lô — hàng dựng từ không khí, giá vốn do máy đoán"
    ).toBe(false)
  })

  /**
   * ⚠ CÂU LỖI PHẢI GỌI TÊN MẶT HÀNG. Bản cũ chỉ có con số, nên người
   * dùng đọc "không tìm được lô để hoàn 1.000000 đơn vị" và không có
   * cách nào biết là mặt hàng nào trong cả tờ hoá đơn.
   */
  it("câu lỗi nói tên mặt hàng và việc cần làm", () => {
    const i = CODE.indexOf("NO_BATCH_TO_RESTOCK")
    expect(i).toBeGreaterThan(-1)
    const khoi = CODE.slice(i - 200, i + 400)
    expect(khoi, "câu lỗi không gọi tên mặt hàng").toMatch(/v_pname/)
    expect(khoi, "câu lỗi không nói việc cần làm").toMatch(/phiếu nhập/)
  })
})

describe("vệ sinh migration", () => {
  const SQL = readFileSync(resolve(DIR, BAN.ten), "utf-8")

  /** ⚠ PostgREST giữ bản đồ schema trong bộ nhớ — không gọi là RPC cũ còn chạy. */
  it("kết thúc bằng NOTIFY pgrst", () => {
    expect(SQL.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  /** ⚠ Chạy lại lần hai không được nổ. */
  it("idempotent — CREATE OR REPLACE, không CREATE trần", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\._wf2_restock/)
    expect(
      /CREATE FUNCTION public\._wf2_restock/.test(SQL),
      "CREATE trần — chạy lại lần hai là nổ 42723"
    ).toBe(false)
  })

  /** ⚠ Header phải nói VÌ SAO, không chỉ nói SỬA GÌ. */
  it("header nói rõ nguyên nhân", () => {
    const header = SQL.slice(0, SQL.indexOf("CREATE OR REPLACE"))
    expect(header, "header không nhắc câu lỗi chủ nhà gặp").toContain("NO_BATCH_TO_RESTOCK")
    expect(header.length, "header quá ngắn để giải thích vì sao").toBeGreaterThan(800)
  })
})
