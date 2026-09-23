import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { errorMessage } from "../src/lib/errors"

/**
 * LÀM ĐƠN HỘ NHÂN VIÊN — 42501, và cách chủ nhà chọn để sửa.
 *
 * Chủ nhà báo 22/09/2026: gán đơn cho nhân viên thì màn hình ném
 *   "Bạn không có quyền thực hiện thao tác này — new row violates
 *    row-level security policy for table sales_orders (mã 42501)"
 *
 * ⚠ NGUYÊN NHÂN: `INSERT … RETURNING` PHẢI ĐỌC LẠI HÀNG VỪA GHI.
 *   `sales_order_select` (mig 119) có vế
 *       AND (status <> 'draft' OR sales_user_id = auth.uid())
 *   nằm NGOÀI khối OR vai trò, tức áp cho MỌI vai trò — kể cả chủ NPP.
 *   Chủ NPP lập đơn đứng tên nhân viên rồi bấm "Lưu nháp": ghi xuống
 *   được, nhưng `RETURNING` đọc lại thì chính sách giấu hàng ấy đi và
 *   Postgres ném 42501. "Gửi đơn" (submitted) thì chạy bình thường.
 *
 * ⚠ TÔI ĐÃ ĐỀ XUẤT SỬA Ở CƠ SỞ DỮ LIỆU HAI LẦN, CHỦ NHÀ BÁC CẢ HAI —
 *   ghi ra vì bộ chốt này canh đúng CÁI KHÔNG ĐƯỢC LÀM:
 *     · bản 1 — thêm cột `created_by` + trigger, cho người đã gõ thấy
 *       nháp mình gõ;
 *     · bản 2 — nới quyền đọc nháp cho vai trò `owner` / `manager`.
 *   Chủ nhà chốt: "Tao vẫn muốn NPP ko thấy được đơn nháp của nhân
 *   viên. Khi làm đơn hộ nút lưu nháp cho mờ đi ko bấm được. chỉ gửi
 *   được luôn."
 *
 *   Tức là: luật nháp GIỮ NGUYÊN, và giao diện phải nói ra luật ấy
 *   TRƯỚC khi người ta bấm. Đúng về nghiệp vụ nữa — một tờ nháp đứng
 *   tên người khác thì người gõ không quản được nó, nên đừng tạo ra.
 *
 * Đã kiểm trên Postgres 16 thật sau khi lùi:
 *   · chủ NPP "Gửi đơn" hộ nhân viên  → đọc lại được
 *   · chủ NPP "Lưu nháp" hộ nhân viên → vẫn 42501 (đúng ý chủ nhà)
 *   · chủ NPP lưu nháp đơn đứng tên MÌNH → chạy
 *   · nháp của nhân viên: sổ có 1, chủ NPP đếm 0
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const boChuThichSql = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

const MIG = boChuThichSql(read("supabase/migrations/161_giu_don_nhap_kin.sql"))
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

    /* Và ô ấy phải THẬT SỰ nằm sau cái cổng. Từ 23/09/2026 ô gán nằm trong
       khối `DocPeople` (Người tạo · Người được gán): màn chỉ đưa `onAssign`
       khi `canPickSeller`, và khối tự che ô khỏi vai trò không phải chủ /
       quản lý. */
    expect(DON, "màn /pos không vẽ ô gán NVBH").toMatch(/<DocPeople[\s\S]*?onAssign=\{canPickSeller \? setNvbh : undefined\}/)
    const KHOI = readFileSync(resolve(__dirname, "../src/components/pos/doc-people.tsx"), "utf-8")
    expect(KHOI).toMatch(/role === "owner" \|\| role === "manager"/)
    expect(KHOI).toMatch(/const choGan = !!onAssign && coQuyenGan\(user\?\.role\)/)
    expect(KHOI).toMatch(/choGan \? \([\s\S]*?<SellerPicker/)
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

describe("migration 161 — lùi lại, giữ nguyên luật nháp của mig 119", () => {
  /**
   * ⚠ CHỐT NÀY CANH MỘT LỜI RÚT LẠI. Số 161 đã đi qua hai bản đều nới
   *   quyền đọc nháp; chủ nhà bác cả hai. Vế nháp phải về ĐÚNG hai điều
   *   kiện của mig 119 — không thiếu một, không thừa một.
   */
  it("vế nháp về đúng hai điều kiện của mig 119", () => {
    const i = MIG.indexOf("CREATE POLICY sales_order_select")
    expect(i, "migration không dựng lại chính sách đọc đơn").toBeGreaterThan(-1)
    const ve = layVeNhap(MIG.slice(i))
      .replace(/\s*\)\s*$/, "")
      .split(/\bOR\b/)
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter(Boolean)
    expect(ve, "vế nháp không còn là đúng hai điều kiện của mig 119").toEqual([
      "status <> 'draft'",
      "sales_user_id = auth.uid()",
    ])
  })

  /**
   * ⚠ DỌN SẠCH HAI BẢN TRƯỚC. Ai đã chạy một trong hai thì cơ sở dữ
   *   liệu của họ đang mang thêm một trigger và một chính sách nới
   *   rộng, mà không có gì gỡ ra.
   */
  it("dọn trigger của bản 161 đầu tiên, và không dựng lại gì", () => {
    expect(MIG, "không dọn trigger của bản 161 đầu tiên")
      .toContain("DROP TRIGGER IF EXISTS trg_orders_created_by")
    expect(MIG, "lại thêm cột cho một luật vai trò").not.toMatch(/ADD COLUMN[^\n]*created_by/i)
    expect(MIG, "lại dựng trigger điền cột ấy").not.toMatch(/CREATE TRIGGER trg_orders_created_by/)
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

  it("kết thúc bằng NOTIFY pgrst để PostgREST đọc lại chính sách", () => {
    expect(read("supabase/migrations/161_giu_don_nhap_kin.sql").trimEnd()
      .endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })
})

describe("làm đơn hộ thì KHÔNG lưu nháp được", () => {
  /**
   * ⚠ ĐÂY LÀ CHỖ LUẬT CỦA CƠ SỞ DỮ LIỆU PHẢI NGẤM LÊN GIAO DIỆN. Nháp
   *   đứng tên người khác thì người gõ không đọc lại được — nên đừng
   *   bày ra cái nút tạo ra nó.
   */
  for (const [ten, src] of [["/pos", DON], ["/sell/cart", CART]] as const) {
    it(`${ten}: có cờ "đang làm đơn hộ", so với chính mình chứ không so với rỗng`, () => {
      const m = src.match(/const donHo\s*=\s*([^\n]+)/)
      expect(m, `${ten} không có cờ làm đơn hộ`).not.toBeNull()
      /* Ô để TRỐNG nghĩa là đơn đứng tên mình — vẫn lưu nháp được. */
      expect(m![1], `${ten} coi ô trống là làm đơn hộ`).toMatch(/!==\s*user\?\.id/)
    })
  }

  it("/pos: nút Lưu nháp mờ đi, và nói vì sao", () => {
    const i = DON.indexOf("Lưu nháp (F6)")
    expect(i).toBeGreaterThan(-1)
    const nut = DON.slice(Math.max(0, i - 900), i)
    expect(nut, "nút Lưu nháp không tắt khi làm đơn hộ").toMatch(/disabled=\{[^}]*donHo/)
    /* ⚠ Nút mờ PHẢI nói lý do — nếu không người ta bấm mãi không ăn. */
    expect(nut, "nút mờ mà không nói vì sao").toMatch(/donHo\s*\n?\s*\?/)
  })

  /**
   * ⚠ PHÍM PHẢI THEO ĐÚNG ĐIỀU KIỆN CỦA NÚT. Nút mờ mà `F6` vẫn chạy
   *   thì cái mờ ấy chỉ là trang trí, và người dùng vẫn vấp 42501 —
   *   chỉ khác là bằng bàn phím.
   */
  it("/pos: phím F6 cũng chặn, không chỉ cái nút", () => {
    const i = DON.indexOf("F6: () =>")
    expect(i).toBeGreaterThan(-1)
    expect(DON.slice(i, DON.indexOf("\n", i)), "F6 vẫn lưu nháp được khi làm đơn hộ")
      .toContain("donHo")
  })

  it("/sell/cart: nút Lưu nháp mờ đi, và có lời giải thích NHÌN THẤY ĐƯỢC", () => {
    const i = CART.indexOf("Lưu nháp")
    expect(i).toBeGreaterThan(-1)
    const nut = CART.slice(Math.max(0, i - 900), i)
    /**
     * ⚠ `[^}]*` CHỨ KHÔNG `[\s\S]*?`. Bản trước dò lười qua nhiều dòng
     *   nên nó nhảy khỏi biểu thức `disabled` rồi bắt trúng `donHo` của
     *   thuộc tính `title` ngay bên cạnh — bỏ `donHo` khỏi `disabled`
     *   mà chốt vẫn xanh. Đã thử phá đúng kiểu đó một lần.
     */
    expect(nut, "nút Lưu nháp không tắt khi làm đơn hộ").toMatch(/disabled=\{[^}]*donHo/)
    /* ⚠ Trên điện thoại `title` KHÔNG hiện ra — phải có chữ trên màn. */
    expect(CART, "màn điện thoại chỉ có tooltip, người dùng không đọc được")
      .toMatch(/\{donHo && \(/)
  })

  /**
   * ⚠ VÀ "GỬI ĐƠN" THÌ KHÔNG ĐƯỢC CHẶN. Chủ nhà chốt "chỉ gửi được
   *   luôn" — chặn cả hai nút là khoá luôn việc lập đơn hộ.
   */
  it("nút Gửi đơn KHÔNG bị cờ làm đơn hộ chặn", () => {
    const i = DON.indexOf('variant="primary"')
    expect(i).toBeGreaterThan(-1)
    const nut = DON.slice(i, i + 400)
    expect(nut, "gửi đơn cũng bị chặn — hết đường lập đơn hộ").not.toContain("donHo")
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
