import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * THU TIỀN PHẢI ĐI QUA MỘT GIAO DỊCH, VÀ BÁO CÁO PHẢI CỘNG ĐỦ.
 *
 * ⚠ LỖI TIỀN ĐÃ ĐO (22/09/2026, Postgres 16, đăng nhập bằng NVBH đúng
 *   người phụ trách đơn, chạy đúng hai lệnh màn Thu tiền chạy):
 *
 *     [1] NVBH ghi phiếu thu 100.000 → ĐƯỢC
 *     [2] trừ vào công nợ: UPDATE trả về 0 dòng, KHÔNG ném lỗi
 *
 *     phai_thu | da_thu | status | tien_da_ghi_phieu
 *       800000 |      0 |  open  |            100000
 *
 *   Khách trả rồi, sổ không ghi, màn hình báo "Đã thu". Nguyên nhân:
 *   `payments` INSERT cho sales/driver nhưng `receivables` UPDATE chỉ
 *   cho owner/accountant — mà RLS từ chối là LỌC chứ không ném.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("màn thu tiền đi qua RPC, không tự ghi hai bảng", () => {
  const MAN: Array<[string, string]> = [
    ["màn Thu tiền", "src/app/(dashboard)/receivables/collect/page.tsx"],
    ["màn chi tiết công nợ", "src/app/(dashboard)/receivables/[id]/page.tsx"],
  ]

  it.each(MAN)("%s lập phiếu thu qua create_cash_receipt", (_ten, tep) => {
    expect(code(read(tep)), "không còn đi qua RPC").toContain("createCashReceipt(")
  })

  /**
   * ⚠ ĐÂY LÀ CHỐT CHÍNH. Quay lại tự `UPDATE receivables` từ trình
   *   duyệt là dựng lại nguyên lỗi: NVBH bị RLS lọc trong im lặng, tiền
   *   thu rồi mà công nợ không trừ.
   */
  it.each(MAN)("%s KHÔNG tự sửa receivables để trừ tiền", (_ten, tep) => {
    const s = code(read(tep))
    /* Cho phép `UPDATE receivables` ĐỔI TRẠNG THÁI tay (đó là việc của
       owner/accountant và khớp đúng chính sách); cấm đụng vào `paid`. */
    for (const m of Array.from(s.matchAll(/\.from\("receivables"\)[\s\S]{0,260}?\.update\(([\s\S]{0,200}?)\)/g))) {
      expect(
        /\bpaid\b/.test(m[1]),
        "màn thu tiền lại tự trừ `paid` — RLS chặn NVBH mà không ném"
      ).toBe(false)
    }
  })

  it.each(MAN)("%s không tự chèn dòng payments nữa", (_ten, tep) => {
    const s = code(read(tep))
    expect(
      /\.from\("payments"\)\s*\.?\s*\n?\s*\.insert\(/.test(s),
      "vẫn tự chèn phiếu thu ngoài giao dịch của RPC"
    ).toBe(false)
  })
})

describe("migration 164 — đối soát tiền đã thu mà sổ chưa ghi", () => {
  const MIG = read("supabase/migrations/164_doi_soat_tien_da_thu_ma_cong_no_chua_tru.sql")
  const MA = MIG.replace(/^\s*--.*$/gm, "")

  /**
   * ⚠ CHỈ VÁ MỘT CHIỀU. `tổng phiếu thu > paid` là dấu vết của lỗi này:
   *   tiền đã cầm, sổ chưa ghi. Chiều ngược lại migration không biết vì
   *   sao có, và đoán bừa ở đó là tự tay xoá tiền của ai đó.
   */
  it("chỉ vá chiều tiền đã thu > sổ ghi; chiều ngược chỉ BÁO", () => {
    const iVa = MA.indexOf("UPDATE receivables")
    expect(iVa, "migration không vá gì cả").toBeGreaterThan(-1)
    const truoc = MA.slice(0, iVa)
    /* Vòng lặp vá phải lọc bằng `>`, không phải `<>`. */
    expect(truoc, "vá cả hai chiều — sẽ xoá tiền ở chiều không hiểu").toMatch(
      /HAVING COALESCE\(sum\(p\.amount\), 0\) > COALESCE\(rc\.paid, 0\)/
    )
    expect(MA, "chiều ngược không được báo ra").toContain("RAISE WARNING")
    /* Và chiều ngược KHÔNG được đi kèm một lệnh ghi nào. */
    const iNguoc = MA.indexOf("< COALESCE(rc.paid, 0)")
    expect(iNguoc, "không còn vòng soi chiều ngược").toBeGreaterThan(-1)
    expect(
      MA.slice(iNguoc, MA.indexOf("RAISE WARNING", iNguoc)),
      "chiều ngược có lệnh ghi — migration đang đoán bừa"
    ).not.toMatch(/UPDATE |DELETE |INSERT /)
  })

  /**
   * ⚠ KHÔNG KẸP `paid` THEO `amount`. Từ Q11 một khoản thu dư thành số
   *   dư có của khách; kẹp lại là nuốt mất phần dư ấy.
   */
  it("không kẹp paid theo amount", () => {
    const i = MA.indexOf("UPDATE receivables")
    const khoi = MA.slice(i, MA.indexOf("WHERE id = r.id", i))
    expect(khoi, "kẹp paid theo amount — nuốt mất phần khách trả dư").not.toMatch(
      /LEAST\([^)]*amount/i
    )
    expect(khoi, "không đặt paid bằng đúng tổng phiếu thu").toContain("paid = r.tong")
  })

  /**
   * ⚠ TỰ KIỂM TRÊN DỮ LIỆU THẬT SAU KHI VÁ. Một trigger có thể ghi đè
   *   lại giá trị vừa đặt, và khi ấy migration báo "đã vá N khoản"
   *   trong khi sổ không đổi một đồng — đúng loại im lặng đang đi sửa.
   */
  it("vá xong kiểm lại và NÉM nếu vẫn còn lệch", () => {
    /* ⚠ NEO VÀO KHỐI TỰ KIỂM, KHÔNG NEO VÀO "LẦN CUỐI". Bản trước dùng
       `lastIndexOf("FROM receivables")`; khi tệp mọc thêm một câu SELECT
       tóm tắt ở cuối thì "lần cuối" rơi vào câu ấy và chốt đỏ oan — cùng
       cái bẫy đã gặp ở chốt mig 163. */
    const i = MA.indexOf("$kiem$")
    expect(i, "migration không còn khối tự kiểm").toBeGreaterThan(-1)
    const khoi = MA.slice(i, MA.indexOf("$kiem$;", i + 6))
    expect(khoi, "khối tự kiểm không soi lại công nợ").toContain("FROM receivables")
    expect(khoi, "kiểm xong không ném").toContain("RAISE EXCEPTION")
  })

  it("kết thúc bằng NOTIFY pgrst", () => {
    expect(MIG, "thiếu lệnh nạp lại schema").toContain("NOTIFY pgrst, 'reload schema';")
  })
})

/**
 * MIGRATION BÁO CÁO PHẢI TRẢ VỀ BẢNG, KHÔNG CHỈ `RAISE NOTICE`.
 *
 * ⚠ ĐÂY LÀ MỘT LỖI CỦA TÔI, CHỦ NHÀ GẶP PHẢI. Mig 163 và 164 báo cáo
 *   hoàn toàn bằng `RAISE NOTICE`. Trình soạn SQL của Supabase KHÔNG
 *   hiện NOTICE — nó chỉ hiện BẢNG KẾT QUẢ. Chủ nhà chạy 164 xong chỉ
 *   thấy "Success. No rows returned", nên không biết sổ vừa được vá bao
 *   nhiêu đồng. Và vì migration idempotent, chạy lại cũng KHÔNG lấy lại
 *   được con số ấy — nó mất hẳn.
 *
 * ⚠ LUẬT NÀY CHỈ RÀNG TỪ 163 TRỞ ĐI, và đó là cố ý. 42 migration trước
 *   đó cũng báo bằng NOTICE; sửa lại cả 42 là đi sửa lịch sử đã chạy
 *   xong trên máy thật, không được gì mà rủi ro thật. Luật buộc phần
 *   còn viết tiếp.
 */
describe("migration báo cáo phải trả về bảng cho người chạy đọc", () => {
  const DIR = resolve(ROOT, "supabase/migrations")
  /** ⚠ Mốc có lý do, không phải con số tuỳ tiện — xem chú thích trên. */
  const TU_SO = 163

  it("mọi migration từ 163 kết thúc bằng một câu SELECT", () => {
    const pham: string[] = []
    for (const ten of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
      const so = Number(ten.slice(0, 3))
      if (!Number.isFinite(so) || so < TU_SO) continue
      const sql = readFileSync(join(DIR, ten), "utf-8")
      /* Chỉ ràng những tệp CÓ báo cáo cho người chạy đọc — migration chỉ
         dựng bảng/hàm thì không có gì để mà in ra. */
      if (!/RAISE (NOTICE|WARNING) '-{3}/.test(sql)) continue
      const than = sql
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("--"))
        .join("\n")
      if (!/\bSELECT\b[\s\S]*;\s*$/.test(than)) pham.push(ten)
    }
    expect(
      pham,
      "báo cáo chỉ bằng RAISE NOTICE — trình soạn SQL của Supabase không hiện, người chạy không đọc được gì"
    ).toEqual([])
  })
})

/**
 * ⚠ `db.max_rows` CỦA DỰ ÁN LÀ 1.000, và khi vượt trần API trả 200 kèm
 *   đúng 1.000 dòng, KHÔNG có lỗi nào — xem `@/lib/supabase/aggregate`.
 *   Trang vẫn hiện một con số trông hoàn toàn bình thường, chỉ là nó
 *   thiếu. Với giá vốn thì con số thiếu ấy đẩy lợi nhuận lên giả, và
 *   hoa hồng tính theo lợi nhuận giả.
 */
const MIEN_TRU_BAO_CAO: Array<[string, string]> = [
  [
    "reports/end-of-day/page.tsx",
    "cả hai truy vấn đều `.eq(..., date)` — gói gọn trong MỘT ngày, không có NPP nào lập 1.000 phiếu thu hay 1.000 khoản chi trong một ngày",
  ],
]

describe("màn báo cáo cộng đủ số dòng", () => {
  const BANG = new Set([
    "sales_orders", "sales_order_lines", "sales_invoices", "sales_invoice_lines",
    "receivables", "payments", "returns", "return_lines", "stock_entry_lines",
    "stock_entries", "expenses", "cash_receipts", "cash_receipt_lines", "payables",
    "purchase_order_lines", "purchase_invoice_lines",
  ])

  function tepBaoCao(dir: string, out: string[] = []): string[] {
    for (const ten of readdirSync(dir)) {
      const p = join(dir, ten)
      if (statSync(p).isDirectory()) tepBaoCao(p, out)
      else if (ten.endsWith(".tsx")) out.push(p)
    }
    return out
  }

  it("không màn nào cộng tiền trên một truy vấn chưa phân trang", () => {
    const goc = resolve(ROOT, "src/app/(dashboard)")
    const tep = [
      ...tepBaoCao(join(goc, "reports")),
      ...tepBaoCao(join(goc, "analytics")),
    ]
    const pham: string[] = []
    for (const p of tep) {
      const rel = p.slice(resolve(ROOT, "src/app/(dashboard)").length + 1)
      if (MIEN_TRU_BAO_CAO.some(([t]) => rel === t)) continue
      const b = code(readFileSync(p, "utf-8"))
      if (!b.includes("reduce(")) continue
      for (const m of Array.from(b.matchAll(/\.from\("([a-z_]+)"\)/g))) {
        if (!BANG.has(m[1])) continue
        const seg = b.slice(m.index, m.index + 450)
        if (seg.includes(".single()") || seg.includes(".maybeSingle()") || seg.includes("count:")) continue
        const truoc = b.slice(Math.max(0, m.index - 400), m.index)
        if (truoc.includes("fetchAllForAggregate") || seg.includes(".range(") || seg.includes(".limit(")) continue
        pham.push(`${rel} → ${m[1]}`)
      }
    }
    expect(
      Array.from(new Set(pham)),
      "đọc trần rồi cộng: quá 1.000 dòng là API trả đúng 1.000, không lỗi, và con số thiếu"
    ).toEqual([])
  })

  /** ⚠ Miễn trừ phải còn lý do thật, và lý do phải là một câu. */
  it("mọi miễn trừ đều còn trỏ vào một màn có thật", () => {
    for (const [t, lyDo] of MIEN_TRU_BAO_CAO) {
      expect(() => read(`src/app/(dashboard)/${t}`), `${t} không còn — bỏ miễn trừ đi`).not.toThrow()
      expect(lyDo.length, `${t}: miễn trừ không có lý do`).toBeGreaterThan(40)
    }
  })

  /**
   * ⚠ TRONG CHÍNH MỘT `Promise.all` CỦA `reports/employees` từng có ba
   *   bảng dòng mà chỉ một bảng phân trang. Chốt này giữ cho ba bảng
   *   ấy đi cùng một đường.
   */
  it("ba bảng dòng của báo cáo nhân viên đi cùng một hàm", () => {
    const s = code(read("src/app/(dashboard)/reports/employees/page.tsx"))
    for (const ham of ["fetchOrderLines(", "fetchStockEntryLines(", "fetchReturnLines("]) {
      expect(s, `báo cáo nhân viên không dùng ${ham}`).toContain(ham)
    }
  })
})
