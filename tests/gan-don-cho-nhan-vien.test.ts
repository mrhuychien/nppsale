import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { errorMessage } from "../src/lib/errors"

/**
 * GÁN ĐƠN CHO NHÂN VIÊN — hai lỗi đứng cạnh nhau.
 *
 * Chủ nhà báo 22/09/2026: gán đơn cho nhân viên thì màn hình ném
 *   "Bạn không có quyền thực hiện thao tác này — new row violates
 *    row-level security policy for table sales_orders (mã 42501)"
 *
 * Đã dựng lại trên Postgres 16 thật, và hoá ra là HAI lỗi:
 *
 * ⚠ LỖI 1 — máy chủ từ chối ĐÚNG. `"Sales can update own open orders"`
 *   (mig 119) có `WITH CHECK (… sales_user_id = auth.uid() …)`; NVBH mở
 *   đơn của chính mình rồi gán sang đồng nghiệp thì hàng cũ lọt `USING`
 *   còn hàng mới trượt `WITH CHECK`. Đó đúng là luật mig 153. Lỗi nằm ở
 *   GIAO DIỆN: màn `/pos` vẽ ô "Gán đơn cho NVBH" cho mọi vai trò,
 *   trong khi `/sell/cart` đã che khỏi NVBH từ mig 153.
 *
 * ⚠ LỖI 2 — im hơn nhiều, và chỉ lộ ra khi lỗi 1 được sửa. Chủ nhà bấm
 *   "Lưu nháp" cho một đơn đứng tên nhân viên: đơn GHI XUỐNG ĐƯỢC nhưng
 *   chính người vừa lập KHÔNG ĐỌC LẠI ĐƯỢC, vì `sales_order_select`
 *   (mig 119) giấu mọi đơn nháp không đứng tên mình.
 *   `createOrderRecords` đọc lại bằng `.single()` → 0 dòng → một câu lỗi
 *   chẳng liên quan gì tới việc người ta vừa làm, còn đơn thì nằm thật
 *   trong sổ, ngoài tầm nhìn của người tạo ra nó.
 *
 * Đã kiểm bốn nhánh trên Postgres 16 thật, đổi đúng một biến (có/không
 * có migration 161):
 *   · không có 161 → chủ nhà lưu nháp hộ nhân viên, `RETURNING` ra 0 dòng;
 *   · có 161      → ra 1 dòng; nhân viên đứng tên vẫn thấy; nháp riêng
 *                   của NVBH vẫn KÍN với NPP; NVBH gán sang đồng nghiệp
 *                   vẫn bị chặn.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const boChuThichSql = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

const MIG = boChuThichSql(read("supabase/migrations/161_npp_thay_don_minh_lap.sql"))
const DON = code(read("src/components/pos/order-screen.tsx"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))

describe("giao diện không mời người ta bấm nút máy chủ sẽ từ chối", () => {
  /**
   * ⚠ ĐÂY LÀ LỖI ĐÃ XẢY RA THẬT, và nó là loại lỗi tệ nhất: người dùng
   * làm đúng thứ màn hình bày ra rồi nhận một câu tiếng Anh.
   */
  it("/pos che ô gán NVBH khỏi nhân viên bán hàng", () => {
    const m = DON.match(/const canPickSeller\s*=\s*([^\n]+)/)
    expect(m, "màn /pos không còn cổng vai trò cho ô gán NVBH").not.toBeNull()
    expect(m![1]).toContain('"owner"')
    expect(m![1]).toContain('"manager"')
    expect(m![1]).not.toContain('"sales"')

    /* Và ô ấy phải THẬT SỰ nằm sau cái cổng. */
    const i = DON.indexOf("<SellerPicker")
    expect(i, "màn /pos không vẽ ô gán NVBH").toBeGreaterThan(-1)
    expect(DON.slice(Math.max(0, i - 500), i), "ô gán NVBH vẽ ngoài cổng vai trò")
      .toContain("canPickSeller &&")
  })

  /**
   * ⚠ HAI MÀN LẬP ĐƠN PHẢI CÙNG MỘT CỔNG. Lệch nhau là lại đúng chỗ
   * hôm nay: một màn che, một màn quên, và cái quên chỉ lộ ra khi có
   * người dùng thật vấp phải.
   */
  it("/pos và /sell/cart dùng cùng một bộ vai trò", () => {
    const a = DON.match(/const canPickSeller\s*=\s*([^\n]+)/)![1].replace(/\s/g, "")
    const b = CART.match(/const canPickSeller\s*=\s*([^\n]+)/)![1].replace(/\s/g, "")
    expect(a, "hai màn lập đơn gài hai bộ vai trò khác nhau").toBe(b)
  })
})

describe("migration 161 — người gõ đơn còn thấy đơn nháp mình gõ", () => {
  it("thêm cột người gõ, tách khỏi người đứng tên", () => {
    expect(MIG).toMatch(/ALTER TABLE sales_orders\s+ADD COLUMN IF NOT EXISTS created_by uuid/)
    /* ⚠ Hai cột trả lời hai câu khác nhau — gộp là mất dấu vết người
       thao tác, thứ duy nhất lần ra được khi một đơn bị lập sai. */
    expect(MIG).not.toMatch(/DROP COLUMN[^\n]*sales_user_id/i)
    expect(MIG).not.toMatch(/RENAME COLUMN\s+sales_user_id/i)
  })

  it("điền bằng trigger, không đợi client gửi", () => {
    /* Đơn sinh ra ở nhiều đường (/sell, /pos, hàng đợi ngoại tuyến,
       RPC); bắt từng đường nhớ gửi là chắc chắn sót một đường. */
    expect(MIG).toMatch(/CREATE TRIGGER trg_orders_created_by[\s\S]{0,120}BEFORE INSERT ON sales_orders/)
    const i = MIG.indexOf("FUNCTION public.set_order_created_by")
    const than = MIG.slice(i, MIG.indexOf("$$;", i))
    expect(than).toMatch(/NEW\.created_by := auth\.uid\(\)/)
    /* ⚠ CHỈ ĐIỀN KHI CÒN RỖNG — ghi đè là xoá dấu vết người gõ thật ở
       những đường đã truyền sẵn. */
    expect(than, "trigger ghi đè cả giá trị đã có").toMatch(/IF NEW\.created_by IS NULL THEN/)
  })

  it("nới ĐÚNG MỘT vế của luật nháp, và nới theo NGƯỜI chứ không theo VAI TRÒ", () => {
    const i = MIG.indexOf("CREATE POLICY sales_order_select")
    expect(i, "migration không dựng lại chính sách đọc đơn").toBeGreaterThan(-1)
    const pol = MIG.slice(i)
    const j = pol.indexOf("status <> 'draft'")
    expect(j, "mất hẳn luật nháp").toBeGreaterThan(-1)
    const veNhap = pol.slice(j, pol.indexOf("AND (", j))
    expect(veNhap, "người gõ vẫn không thấy đơn nháp mình gõ").toContain("created_by = auth.uid()")
    expect(veNhap, "vẫn phải giữ người đứng tên").toContain("sales_user_id = auth.uid()")
    /**
     * ⚠ KHÔNG ĐƯỢC NỚI CHO CẢ VAI TRÒ. Nới kiểu ấy là xoá thẳng luật
     *   mig 119 ("nháp là sổ tay riêng của NVBH"): mọi nháp dở dang của
     *   mọi nhân viên lại hiện ra hết cho NPP. Chủ nhà chưa bảo bỏ luật
     *   ấy — và một luật riêng tư bị bỏ thì không ai nhận ra.
     */
    expect(veNhap, "nháp của NVBH lại hở ra cho cả vai trò owner/manager")
      .not.toMatch(/user_role\(\)/)
  })

  /**
   * ⚠ CHÉP LẠI MỘT CHÍNH SÁCH LÀ CHỖ DỄ LÀM MẤT MIẾNG VÁ NHẤT. Chính
   * sách này có năm nhánh quyền đọc; chép thiếu một nhánh là âm thầm
   * cắt quyền của một vai trò, và RLS từ chối thì màn hình chỉ thấy
   * danh sách ngắn đi chứ không thấy lỗi nào.
   */
  it("giữ đủ năm nhánh quyền đọc của mig 119", () => {
    const pol = MIG.slice(MIG.indexOf("CREATE POLICY sales_order_select"))
    for (const nhanh of [
      "'owner', 'manager', 'accountant', 'warehouse'",
      "customer.view_all",
      "customer_assignments",
      "'driver'",
      "delivery_lines",
    ]) {
      expect(pol, `chép thiếu nhánh quyền đọc: ${nhanh}`).toContain(nhanh)
    }
  })

  it("không backfill — đơn cũ để rỗng", () => {
    /* Đoán ngược "đơn này chắc do ai gõ" là ghi một phỏng đoán vào sổ
       rồi quên mất rằng nó là phỏng đoán. Rỗng đọc đúng là "không rõ". */
    expect(MIG).not.toMatch(/UPDATE\s+sales_orders\s+SET\s+created_by/i)
    expect(MIG).not.toMatch(/created_by[^\n;]*NOT NULL/i)
  })

  it("kết thúc bằng NOTIFY pgrst để PostgREST thấy cột mới", () => {
    expect(read("supabase/migrations/161_npp_thay_don_minh_lap.sql").trimEnd()
      .endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })
})

describe("câu lỗi RLS nói được người ta phải làm gì", () => {
  const LOI = {
    code: "42501",
    message: 'new row violates row-level security policy for table "sales_orders"',
  }

  /**
   * ⚠ ĐÂY LÀ CHỐT CHẠY THẬT. `errorMessage` là hàm thuần nên hỏi thẳng
   * nó, đừng soi mã nguồn.
   */
  it("từ chối trên đơn hàng thì nói về việc gán đơn, không nói suông", () => {
    const s = errorMessage(LOI)
    expect(s, "vẫn là câu chung chung cũ").not.toMatch(/^Bạn không có quyền thực hiện thao tác này/)
    expect(s).toContain("chủ nhà phân phối hoặc quản lý")
  })

  /**
   * ⚠ KỂ RA CÁC LÝ DO, ĐỪNG CHỌN HỘ MỘT LÝ DO. Một câu lỗi RLS không
   * cho biết vế nào của chính sách đã trượt.
   */
  it("không chốt hạ một nguyên nhân duy nhất", () => {
    expect(errorMessage(LOI)).toMatch(/Hai lý do thường gặp|hoặc/)
  })

  /** ⚠ NGUYÊN VĂN VẪN PHẢI ĐI KÈM — dịch xong vứt bản gốc là đoán trượt
      thì không còn gì để lần. */
  it("vẫn kèm nguyên văn và mã lỗi", () => {
    const s = errorMessage(LOI)
    expect(s).toContain("row-level security")
    expect(s).toContain("42501")
  })

  it("bảng khác vẫn ra câu của bảng ấy, không lây câu của đơn hàng", () => {
    const s = errorMessage({
      code: "42501",
      message: 'new row violates row-level security policy for table "returns"',
    })
    expect(s).toContain("phiếu trả")
    expect(s, "câu của đơn hàng lây sang phiếu trả").not.toContain("ghi đơn này")
  })

  it("bảng chưa có câu riêng thì lùi về câu chung, không im lặng", () => {
    const s = errorMessage({
      code: "42501",
      message: 'new row violates row-level security policy for table "deliveries"',
    })
    expect(s).toContain("Bạn không có quyền thực hiện thao tác này")
    expect(s).toContain("deliveries")
  })
})
