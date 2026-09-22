import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * MỌI CHÍNH SÁCH GHI PHẢI HỎI "DÒNG NÀY THUỘC NPP NÀO".
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 THẬT (22/09/2026). Dựng NPP thứ hai, một nhà
 *   cung cấp của NPP ấy, rồi đăng nhập bằng QUẢN LÝ của NPP thứ nhất:
 *
 *     org người đăng nhập = a0000000-…-0001, vai = manager
 *     sửa NCC của NPP KHÁC: 1 dòng
 *     xoá NCC của NPP KHÁC: 1 dòng
 *
 *   Sau mig 163, cùng phép đo ấy: đọc 0, sửa 0, xoá 0, chèn bị chặn
 *   42501 — mà trong nhà mình thì quản lý vẫn đọc và sửa được.
 *
 * ⚠ VÌ SAO LỌT: chính sách chỉ hỏi VAI TRÒ. `public.user_role()` nói về
 *   NGƯỜI đang đăng nhập và không nói gì về DÒNG đang bị đụng, nên nó
 *   đúng với mọi dòng trong bảng.
 *
 * ⚠ VÀ ĐÃ CÓ NGƯỜI VÁ RỒI MÀ VÁ KHÔNG ĂN — đây là phần đáng nhớ nhất.
 *   `suppliers`, `payables`, `purchase_orders`, `purchase_invoices` đều
 *   đã được thêm một chính sách "view" hỏi đúng org. Nhưng CHÍNH SÁCH
 *   PERMISSIVE CỘNG BẰNG "HOẶC": thêm một cái chặt hơn không bao giờ
 *   thu hẹp được cái đang rộng. Phải VIẾT LẠI cái rộng.
 */

const ROOT = resolve(__dirname, "..")
const DIR = resolve(ROOT, "supabase/migrations")

/**
 * ⚠ SOI BẢN SẼ NẰM LẠI SAU KHI CHẠY HẾT, không soi tệp đầu tiên tìm
 *   thấy. Migration sau ghi đè migration trước; đọc bản cũ là chốt xanh
 *   trong khi thứ đang chạy trên máy thật đã khác từ lâu.
 */
function chinhSachCuoiCung(bang: string, ten: string): string {
  const neo = `CREATE POLICY "${ten}"`
  const tep = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ f, sql: readFileSync(resolve(DIR, f), "utf-8") }))
    .filter((m) => m.sql.includes(neo) && m.sql.includes(bang))
  expect(
    tep.length,
    `không migration nào dựng chính sách "${ten}" trên ${bang} — chốt đang soi chỗ trống`
  ).toBeGreaterThan(0)
  const sql = tep[tep.length - 1].sql
  const i = sql.indexOf(neo)
  // Tới dấu `;` kết câu CREATE POLICY.
  return sql.slice(i, sql.indexOf(";", i))
}

/** Tám bảng có cột org_id — hỏi thẳng cột ấy. */
const HOI_THANG: Array<[string, string]> = [
  ["suppliers", "Owner/Manager can manage suppliers"],
  ["payables", "Manage payables"],
  ["purchase_orders", "Manage POs"],
  ["purchase_invoices", "Manage purchase invoices"],
  ["hr_payroll", "Manage payroll"],
  ["hr_payroll", "View own payroll"],
  ["hr_attendance", "Manage attendance"],
  ["hr_attendance", "View attendance"],
  ["hr_monthly_bonus", "Manage monthly bonus"],
  ["hr_monthly_bonus", "View monthly bonus"],
  ["hr_salary_config", "Manage salary config"],
  ["hr_salary_config", "View salary config"],
]

/** Năm bảng CON, không có cột org_id — hỏi qua bảng cha. */
const HOI_QUA_CHA: Array<[string, string, string]> = [
  ["purchase_invoice_lines", "Manage pinv lines", "purchase_invoices"],
  ["purchase_order_lines", "Manage PO lines", "purchase_orders"],
  ["supplier_return_lines", "Manage supplier return lines", "supplier_returns"],
  ["payable_payments", "Manage payable payments", "payables"],
  ["merged_orders", "Owner/Manager can manage merged orders", "sales_orders"],
]

describe("mười ba chính sách đều hỏi NPP", () => {
  it.each(HOI_THANG)("%s · %s hỏi thẳng org_id", (bang, ten) => {
    const sql = chinhSachCuoiCung(bang, ten)
    expect(sql, `"${ten}" không hỏi org_id — đúng với mọi dòng trong bảng`).toContain(
      "org_id = public.user_org_id()"
    )
  })

  it.each(HOI_QUA_CHA)("%s · %s hỏi org_id của %s", (bang, ten, cha) => {
    const sql = chinhSachCuoiCung(bang, ten)
    expect(sql, `"${ten}" không đi qua bảng cha`).toMatch(
      new RegExp(`EXISTS[\\s\\S]*?FROM ${cha}\\b`)
    )
    expect(sql, `"${ten}" có EXISTS nhưng không hỏi org_id của cha`).toContain(
      `org_id = public.user_org_id()`
    )
  })

  /**
   * ⚠ ĐƯỜNG GHI PHẢI CÓ `WITH CHECK`. Thiếu nó thì `USING` được dùng
   *   lại — thường là đủ, nhưng khi đã đụng tới thì phải nói rõ cả hai,
   *   vì một `USING` đúng mà `WITH CHECK` sai là chèn được một dòng
   *   mang `org_id` của NPP khác rồi không đọc lại được chính nó.
   */
  it.each([...HOI_THANG, ...HOI_QUA_CHA.map(([b, t]) => [b, t] as [string, string])].filter(
    ([, t]) => t.startsWith("Manage") || t.startsWith("Owner/Manager")
  ))("%s · %s có WITH CHECK", (bang, ten) => {
    const sql = chinhSachCuoiCung(bang, ten)
    expect(sql, `"${ten}" là chính sách GHI mà không có WITH CHECK`).toContain("WITH CHECK")
  })
})

describe("migration 163 tự canh lấy mình", () => {
  const MIG = readFileSync(resolve(DIR, "163_khoa_chinh_sach_theo_npp.sql"), "utf-8")
  const MA = MIG.replace(/^\s*--.*$/gm, "")

  /**
   * ⚠ SIẾT CHÍNH SÁCH CÓ THỂ GIẤU DÒNG. Một bảng có dòng `org_id IS
   *   NULL` thì thêm vế `org_id = user_org_id()` là dòng ấy biến mất
   *   khỏi mắt mọi người, âm thầm — đúng loại lỗi migration này đang đi
   *   sửa. Phải dừng lại chứ không được lặng lẽ siết.
   */
  it("dừng lại nếu có dòng không mang org_id", () => {
    expect(MA, "không kiểm dòng mồ côi org_id trước khi siết").toContain("ORG_NULL")
    const i = MA.indexOf("ORG_NULL")
    expect(MA.slice(Math.max(0, i - 400), i), "phát hiện mà không ném").toContain(
      "RAISE EXCEPTION"
    )
  })

  /**
   * ⚠ VIẾT LẠI CHÍNH SÁCH RỘNG, KHÔNG THÊM CHÍNH SÁCH HẸP. Đây là chỗ
   *   lần vá trước đã sai. Mỗi `CREATE POLICY` phải có một `DROP POLICY
   *   IF EXISTS` cùng tên đứng trước.
   */
  it("mỗi chính sách đều được DROP trước khi CREATE", () => {
    const tao = Array.from(MA.matchAll(/CREATE POLICY "([^"]+)" *\n? *ON (\w+)/g))
    expect(tao.length, "migration không dựng chính sách nào").toBeGreaterThan(10)
    for (const m of tao) {
      expect(
        MA,
        `"${m[1]}" trên ${m[2]} được THÊM chứ không thay — chính sách cũ còn đó thì lỗ vẫn mở`
      ).toContain(`DROP POLICY IF EXISTS "${m[1]}" ON ${m[2]};`)
    }
  })

  /**
   * ⚠ TỰ SOI LẠI `pg_policy` SAU KHI CHẠY — sót một cái là lỗ vẫn mở,
   *   và không có gì báo vì chính sách rộng không kêu, nó chỉ cho qua.
   *
   * ⚠ NEO VÀO PHÉP KIỂM CHẶT, KHÔNG NEO VÀO CÁI CUỐI CÙNG. Khối tự
   *   kiểm có HAI vòng đọc `pg_policy`: vòng đầu soi 13 bảng migration
   *   này hứa và NÉM; vòng sau quét rộng cả schema và chỉ BÁO. Bản
   *   trước của chốt này neo vào `lastIndexOf` nên nó soi phải vòng
   *   quét rộng rồi đỏ oan — chốt đọc nhầm chỗ, không phải luật sai.
   */
  it("tự kiểm 13 bảng trên bản đang chạy, và NÉM khi còn sót", () => {
    const dau = MA.indexOf("FROM pg_policy")
    expect(dau, "không tự kiểm lại").toBeGreaterThan(-1)
    const sau = MA.indexOf("FROM pg_policy", dau + 1)
    const chat = MA.slice(dau, sau > -1 ? sau : undefined)
    expect(chat, "vòng kiểm chặt không soi đúng bộ bảng migration này hứa").toContain(
      "purchase_invoice_lines"
    )
    expect(chat, "kiểm xong không ném khi còn sót").toContain("RAISE EXCEPTION")
  })

  /**
   * ⚠ QUÉT RỘNG CHỈ BÁO, KHÔNG NÉM. Ném là migration của người ta gãy
   *   vì một bảng migration này không hứa gì; im lặng thì lần sau lại
   *   phải có ai đó tình cờ đi tìm mới thấy.
   */
  it("quét rộng cả schema và BÁO những chính sách còn lại", () => {
    expect(MA, "không quét rộng — lần sau lại phải tình cờ mới thấy").toContain("RAISE WARNING")
  })

  /**
   * ⚠ LUẬT LÀ "CÓ NẠP LẠI SCHEMA", KHÔNG PHẢI "ĐỨNG Ở DÒNG CUỐI". Bản
   *   trước đòi tệp KẾT THÚC bằng câu ấy; khi tệp mọc thêm một câu
   *   SELECT tóm tắt ở cuối (để trình soạn SQL của Supabase có gì mà
   *   hiện) thì chốt đỏ oan — mã dời chỗ, luật không đổi.
   *
   * ⚠ NHƯNG `NOTIFY` PHẢI ĐỨNG SAU MỌI LỆNH ĐỔI CHÍNH SÁCH, nếu không
   *   PostgREST nạp lại bản cũ. Chốt giữ đúng thứ tự ấy.
   */
  it("có nạp lại schema, và nạp SAU khi đã đổi xong chính sách", () => {
    expect(MIG, "thiếu lệnh nạp lại schema").toContain("NOTIFY pgrst, 'reload schema';")
    const cuoiPolicy = MA.lastIndexOf("CREATE POLICY")
    const notify = MA.indexOf("NOTIFY pgrst")
    expect(notify, "nạp lại schema TRƯỚC khi đổi xong — PostgREST giữ bản cũ").toBeGreaterThan(
      cuoiPolicy
    )
  })
})
