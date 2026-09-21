import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * HOÀN KHO KHI HUỶ HOÁ ĐƠN — `_wf2_restock`.
 *
 * ⚠ BỘ CHỐT NÀY THAY BỘ CHỐT CỦA MIGRATION 156, VÀ RÚT LẠI LUẬT CỦA NÓ.
 *
 * Chủ nhà gặp lỗi: `NO_BATCH_TO_RESTOCK … chưa từng có lô nào trong kho`
 * và tự đoán đúng: *"do cho xuất kho âm nên ko có lô -> ko hoàn được"*.
 *
 * Đã tái hiện qua đúng đường thật trên Postgres 16: bật `allow_oversell`,
 * bán một mặt hàng chưa từng nhập kho → `post_stock_export` ghi sổ bình
 * thường, KHÔNG trừ lô nào, KHÔNG ghi dấu vết nào, `batch_id` để rỗng.
 * Tồn trước khi bán 0, sau khi bán vẫn 0.
 *
 * Nên khi huỷ thì KHÔNG CÓ GÌ ĐỂ HOÀN. Bản vá 156 lại đi đoán "lô gần
 * nhất cùng sản phẩm" rồi cộng hàng vào đó — tức DỰNG RA hàng không có
 * thật để cho nút Huỷ bấm được. Migration 157 bỏ hẳn phép đoán ấy.
 *
 * ⚠ CHỐT ĐỌC SQL, VÌ KHÔNG CÓ CÁCH NÀO CHẠY PLPGSQL TRONG VITEST. Nên
 * mỗi chốt bám vào một LUẬT kiểm được bằng mắt trên câu SQL, và nói rõ
 * luật ấy hỏng thì mất gì. Năm cảnh chạy thật (bán âm toàn bộ, bán âm
 * một phần, chứng từ cũ có ghi lô, vòng đời bán–huỷ, và phép chọn xuất
 * FIFO) đã kiểm trên Postgres thật lúc viết bản vá.
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
  it("đọc được hàm, và nó nằm ở migration mới hơn 156", () => {
    expect(BAN.sql.length, "không đọc được thân hàm _wf2_restock").toBeGreaterThan(500)
    expect(
      Number(BAN.ten.slice(0, 3)),
      "bản mới nhất vẫn là 156 — bản vá chưa vào, phép đoán lô còn nguyên"
    ).toBeGreaterThan(156)
  })
})

describe("không dựng hàng không có thật", () => {
  /**
   * ⚠ LUẬT GỐC: KHÔNG ĐOÁN LÔ. Chỉ có đúng ba đường hợp lệ để biết hoàn
   * về đâu — dấu vết `stock_line_consumptions`, hoặc `batch_id` ghi trên
   * chính dòng xuất. Đi tìm một lô "cùng sản phẩm" rồi cộng hàng vào đó
   * là tự tạo tồn kho: nhánh ấy CHỈ chạy được khi dòng xuất không ghi lô,
   * mà không ghi lô nghĩa là lúc xuất chưa hề trừ lô nào.
   */
  it("không chọn lô theo product_id", () => {
    let i = CODE.indexOf("FROM batches")
    expect(i, "không thấy chỗ nào đụng bảng batches").toBeGreaterThan(-1)
    while (i > -1) {
      const khoi = CODE.slice(i, i + 250)
      expect(
        /product_id/.test(khoi),
        "lại đi đoán lô theo mã hàng — hoàn hàng vào một lô chưa hề bị trừ " +
          "là thổi tồn kho lên bằng số hàng bán âm"
      ).toBe(false)
      i = CODE.indexOf("FROM batches", i + 1)
    }
  })

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
   * ⚠ DÒNG NHẬP GHI SỐ THỰC HOÀN, KHÔNG GHI SỐ TRÊN HOÁ ĐƠN. Ghi đủ
   * `p_qty_base` trong khi chỉ hoàn được một phần là làm lệch sổ nhập
   * đúng bằng phần bán âm — cùng một cái sai, chỉ chuyển sang bảng khác.
   */
  it("dòng phiếu nhập không ghi thẳng số trên hoá đơn", () => {
    const i = CODE.lastIndexOf("VALUES (")
    expect(i, "không thấy câu chèn dòng phiếu nhập").toBeGreaterThan(-1)
    expect(
      /p_qty_base/.test(CODE.slice(i)),
      "ghi thẳng số hoá đơn vào phiếu nhập — phần bán âm thành hàng nhập khống"
    ).toBe(false)
  })

  /**
   * ⚠ VÀ PHẢI TRỪ ĐÚNG PHẦN KHÔNG HOÀN ĐƯỢC. Chốt trên chỉ canh "đừng
   * ghi p_qty_base"; một đột biến gán `v_back := p_qty_base` vẫn lọt qua
   * nó. Chốt này lần theo CHÍNH biến được chèn, nên đổi tên biến không
   * phá được nó.
   */
  it("số thực hoàn = số hoá đơn trừ phần chưa hề bị trừ kho", () => {
    const m = CODE.match(/(\w+)\s*:=\s*p_qty_base\s*-\s*(\w+)/)
    expect(m, "không thấy phép trừ phần không hoàn ra khỏi số ghi sổ nhập").toBeTruthy()
    const [, bienHoan, bienChuaTru] = m!
    expect(
      CODE.slice(CODE.lastIndexOf("VALUES (")),
      "biến vừa trừ xong lại không phải biến đem đi chèn"
    ).toContain(bienHoan)
    expect(
      CODE,
      "phần chưa bị trừ kho không được gán ở nhánh nào — nó luôn bằng 0, phép trừ thành vô nghĩa"
    ).toMatch(new RegExp(`${bienChuaTru}\\s*:=\\s*v_left`))
  })
})

describe("không chặn người dùng huỷ hoá đơn", () => {
  /**
   * ⚠ HOÀN KHO KHÔNG ĐƯỢC NÉM LỖI. Đây đúng là thứ giam tờ hoá đơn của
   * chủ nhà: không có gì để hoàn, mà hàm lại coi đó là lỗi và chặn.
   * Cấm cả cụm `RAISE EXCEPTION` chứ không chỉ cấm đúng chữ
   * `NO_BATCH_TO_RESTOCK` — đổi tên câu lỗi thì vẫn chặn y như cũ.
   */
  it("thân hàm không còn câu lỗi nào", () => {
    expect(
      /RAISE\s+EXCEPTION/i.test(CODE),
      "hoàn kho lại ném lỗi — người dùng không huỷ nổi hoá đơn, đúng lỗi đã báo"
    ).toBe(false)
    expect(/NO_BATCH_TO_RESTOCK/.test(CODE)).toBe(false)
  })

  /**
   * ⚠ NHƯNG KHÔNG ĐƯỢC IM LẶNG. Không hoàn gì mà sổ không nói ra thì
   * người kiểm kê thấy một phiếu nhập 0 đơn vị và không hiểu vì sao.
   */
  it("ghi chú nói ra phần bán âm", () => {
    expect(CODE, "không ghi chú gì về phần không hoàn được").toMatch(/bán âm/)
  })
})

describe("hai đường hoàn hàng hợp lệ — không được đụng", () => {
  /**
   * ⚠ TRỪ DẦN DẤU VẾT. Không trừ thì lần hoàn sau lại thấy đủ số cũ:
   * sửa đơn giảm 4 rồi huỷ đơn sẽ hoàn thêm cả 10, kho dôi ra 4 thùng
   * không có thật.
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

  /**
   * ⚠ CHỨNG TỪ THỜI 107..118 CÓ GHI LÔ MÀ CHƯA CÓ BẢNG DẤU VẾT. Hàng ấy
   * ĐÃ bị trừ thật, nên phải hoàn — và hoàn về ĐÚNG lô ghi trên dòng
   * xuất, không phải lô nào khác.
   */
  it("vẫn hoàn về đúng lô ghi trên dòng xuất", () => {
    expect(CODE, "mất nhánh dòng xuất có ghi lô").toMatch(/v_batch IS NOT NULL/)
    expect(
      CODE,
      "không cộng hàng về chính lô ghi trên dòng xuất — hàng đã trừ thật mà không được hoàn"
    ).toMatch(/UPDATE batches SET qty_on_hand\s*=\s*qty_on_hand\s*\+\s*v_left\s+WHERE id\s*=\s*v_batch/)
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

  /**
   * ⚠ HEADER PHẢI NÓI VÌ SAO, và phải nói rõ nó RÚT LẠI bản vá trước.
   * Người đọc migration 156 rồi đọc bản này mà không thấy vế ấy sẽ tưởng
   * hai bản bổ sung cho nhau, rồi chép nhầm phép đoán lô về.
   */
  it("header nói rõ nguyên nhân và nói rõ nó rút lại 156", () => {
    const header = SQL.slice(0, SQL.indexOf("CREATE OR REPLACE"))
    expect(header, "header không nhắc câu lỗi chủ nhà gặp").toContain("NO_BATCH_TO_RESTOCK")
    expect(header, "header không nói bản vá trước sai ở đâu").toContain("156")
    expect(header.length, "header quá ngắn để giải thích vì sao").toBeGreaterThan(800)
  })
})
