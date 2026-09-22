import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { errorMessage } from "../src/lib/errors"

/**
 * GÁN ĐƠN CHO NHÂN VIÊN — 42501.
 *
 * Chủ nhà báo 22/09/2026: gán đơn cho nhân viên thì màn hình ném
 *   "Bạn không có quyền thực hiện thao tác này — new row violates
 *    row-level security policy for table sales_orders (mã 42501)"
 *
 * ⚠ BẢN ĐẦU TÔI ĐOÁN SAI NGUYÊN NHÂN, ghi ra đây vì cái sai ấy dạy đúng
 *   một bài. Tôi đoán là NVBH sửa đơn của mình rồi gán sang đồng nghiệp
 *   (`"Sales can update own open orders"` có `WITH CHECK (… sales_user_id
 *   = auth.uid() …)`), rồi dừng lại ở đó. Đo tiếp mới ra chỗ thật.
 *
 * ⚠ NGUYÊN NHÂN THẬT: `INSERT … RETURNING` PHẢI ĐỌC LẠI HÀNG VỪA GHI.
 *   `sales_order_select` (mig 119) có vế
 *       AND (status <> 'draft' OR sales_user_id = auth.uid())
 *   nằm NGOÀI khối OR vai trò, tức áp cho MỌI vai trò — kể cả chủ NPP.
 *   Chủ NPP lập đơn đứng tên nhân viên rồi bấm "Lưu nháp":
 *     · ghi xuống được;
 *     · `RETURNING` đọc lại thì chính sách SELECT giấu hàng ấy đi;
 *     · Postgres ném đúng câu 42501 trên.
 *   Còn "Gửi đơn" (status submitted) thì chạy bình thường — nên nhìn từ
 *   ngoài, cơ chế "gán đơn" trông như đang dùng được.
 *
 * ⚠ VÀ MỘT CÂU HỎI TƯỞNG LÀ HIỂN NHIÊN THÌ KHÔNG HIỂN NHIÊN. Chủ nhà
 *   nói "chủ NPP đương nhiên nhìn thấy mọi đơn rồi" — hôm nay KHÔNG
 *   đúng, vì mig 119 cố ý giấu nháp khỏi mọi vai trò. Mig 161 làm cho
 *   câu ấy thành đúng, và đó là cách sửa đơn giản nhất.
 *
 * Đã kiểm trên Postgres 16 thật, đổi đúng một biến (có/không có 161):
 *   · không có 161 → chủ NPP "Gửi đơn" hộ nhân viên: CHẠY;
 *                    chủ NPP "Lưu nháp" hộ nhân viên: 42501;
 *                    danh sách của chủ NPP đếm 0 trong khi sổ có 2 nháp.
 *   · có 161      → lưu nháp ra 1 dòng; quản lý cũng thấy; kế toán VẪN
 *                    không thấy; NVBH vẫn chỉ thấy nháp của mình; NVBH
 *                    gán sang đồng nghiệp vẫn bị chặn.
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

/**
 * Lát cắt của VẾ NHÁP trong chính sách `sales_order_select`: khối
 * `AND ( … )` ĐẦU TIÊN sau `USING (`.
 *
 * ⚠ CẮT THEO CẤU TRÚC, KHÔNG CẮT THEO MỘT CHỮ NẰM GIỮA. Neo vào một
 *   chữ giữa vế là mọi thứ chèn trước nó đều tàng hình với chốt.
 */
function layVeNhap(pol: string): string {
  const u = pol.indexOf("USING (")
  const a1 = pol.indexOf("AND (", u)
  const a2 = pol.indexOf("AND (", a1 + 5)
  expect(u, "chính sách không còn khối USING").toBeGreaterThan(-1)
  expect(a1, "mất hẳn luật nháp — mọi đơn nháp hở cho cả đơn vị").toBeGreaterThan(-1)
  expect(a2, "chính sách mất khối quyền theo vai trò").toBeGreaterThan(a1)
  return pol.slice(a1 + 5, a2)
}

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

describe("migration 161 — chủ NPP / quản lý thấy được đơn nháp", () => {
  it("nới ĐÚNG MỘT vế của luật nháp, và nới cho đúng hai vai trò", () => {
    const i = MIG.indexOf("CREATE POLICY sales_order_select")
    expect(i, "migration không dựng lại chính sách đọc đơn").toBeGreaterThan(-1)
    const pol = MIG.slice(i)
    /**
     * ⚠ CẮT TỪ CHỖ MỞ VẾ, KHÔNG CẮT TỪ CHỮ `status <> 'draft'`. Bản
     *   trước neo vào chính chữ ấy, nên một mutation chèn `true OR` vào
     *   ĐẦU vế nằm ngoài lát cắt và chốt vẫn xanh — trong khi nó vừa mở
     *   toang mọi đơn nháp cho cả đơn vị. Đã thử phá đúng kiểu đó.
     *
     * ⚠ VÀ SO BẰNG TẬP HỢP, KHÔNG SO BẰNG "CÓ CHỨA": vế nháp phải là
     *   ĐÚNG ba điều kiện này, không thiếu một, không thừa một.
     */
    const veNhap = layVeNhap(pol)
    const ve = veNhap
      .replace(/\s*\)\s*$/, "")
      .split(/\bOR\b/)
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter(Boolean)
    expect(ve, "vế nháp không còn là đúng ba điều kiện đã chốt").toEqual([
      "status <> 'draft'",
      "sales_user_id = auth.uid()",
      "public.user_role() IN ('owner', 'manager')",
    ])
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

  /**
   * ⚠ KHÔNG THÊM CỘT, KHÔNG THÊM TRIGGER. Bản đầu của migration này
   *   dựng hẳn một cột `created_by` để "chỉ người đã gõ mới thấy nháp
   *   mình gõ". Chủ nhà bác, và bác đúng: người gõ đơn hộ LUÔN LÀ chủ
   *   NPP hoặc quản lý, nên cả bộ máy ấy chỉ để nói lại đúng câu "chủ
   *   NPP thì thấy". Chốt canh cho nó đừng mọc lại.
   */
  it("không dựng thêm cột hay trigger cho một việc một dòng làm xong", () => {
    expect(MIG, "lại thêm cột cho một luật vai trò").not.toMatch(/ADD COLUMN[^\n]*created_by/i)
    expect(MIG, "lại dựng trigger điền cột ấy").not.toMatch(/CREATE TRIGGER trg_orders_created_by/)
    /* Nhưng phải DỌN bản đầu, phòng ai đã chạy nó rồi. */
    expect(MIG, "không dọn trigger của bản 161 đầu tiên")
      .toContain("DROP TRIGGER IF EXISTS trg_orders_created_by")
  })

  it("kết thúc bằng NOTIFY pgrst để PostgREST đọc lại chính sách", () => {
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
