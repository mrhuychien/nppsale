import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * PHIẾU TRẢ ĐỨNG TÊN NHÂN VIÊN.
 *
 * Chủ nhà chốt 22/09/2026, nguyên văn: "yêu cầu phần Trả hàng: phiếu do
 * NPP lập có thể gán được cho nhân viên".
 *
 * ⚠ CÁI CỘT NÀY LÀ CON SỐ TRỪ DOANH SỐ. `reports/employees` đang ĐOÁN
 * nhân viên của phiếu trả bằng đường vòng — lấy đơn gần nhất của cùng
 * khách rồi mượn `sales_user_id` của đơn. Khách mua của hai nhân viên là
 * phép đoán ấy sai, và nó sai vào đúng chỗ trừ tiền của người ta.
 *
 * ⚠ PHIẾU TRẢ SINH RA Ở NĂM CHỖ, chỉ MỘT chỗ có ô chọn người:
 *     · màn `/returns/new`     — có ô chọn (chủ nhà / quản lý).
 *     · `createOrderRecords`   — hàng trả gõ kèm lúc lập đơn.
 *     · `order-edit.ts`        — hàng trả thêm lúc sửa đơn.
 *     · màn bàn giao chuyến    — tài xế ghi hàng khách trả tại cửa.
 *     · `reissue_invoice`      — mig 152 tự dựng phiếu khi xuất lại.
 *   Bốn chỗ sau không truyền cột này. Lấy NGƯỜI GÕ làm người đứng tên ở
 *   đó thì đơn tính cho nhân viên còn phiếu trả tính cho NPP hay tài
 *   xế — tệ hơn cả phép đoán cũ. Nên luật điền mặc định là: theo ĐƠN
 *   GỐC trước, không có đơn mới theo người gõ, và chỉ khi người gõ có
 *   bán hàng.
 *
 * Đã kiểm trên Postgres 16 thật, tám nhánh (`/tmp/pgtest/g160*.sql`):
 *   A để trống → đứng tên chính mình · B nhân viên gán sang đồng nghiệp
 *   → chặn · C cửa sau UPDATE → chặn · D NPP gán cho NVBH → được ·
 *   E NPP gán cho tài khoản kho → chặn · F thủ kho gõ phiếu GẮN ĐƠN →
 *   về nhân viên của đơn · G thủ kho gõ phiếu KHÔNG gắn đơn → để rỗng ·
 *   H NPP chọn đích danh → thắng nhân viên của đơn gốc.
 */

const ROOT = resolve(__dirname, "..")
const DIR = resolve(ROOT, "supabase/migrations")
const doc = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/** Bỏ chú thích — chốt không được khớp phải chính câu giải thích. */
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

/** Bản MỚI NHẤT của một hàm SQL — `CREATE OR REPLACE` sau đè trước. */
function banMoiNhat(fn: string): { ten: string; sql: string } {
  let ten = ""
  let sql = ""
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const s = readFileSync(resolve(DIR, f), "utf-8")
    const i = s.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)
    if (i < 0) continue
    ten = f
    sql = s.slice(i, s.indexOf("\n$$;", i))
  }
  return { ten, sql }
}

/** Mọi tệp migration, để hỏi "có ai đụng lại chỗ này về sau không". */
const moiMigration = () =>
  readdirSync(DIR)
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((f) => ({ ten: f, sql: readFileSync(resolve(DIR, f), "utf-8") }))

describe("cột sales_user_id trên phiếu trả", () => {
  it("migration thêm cột idempotent và không đụng requested_by", () => {
    const sql = boChuThich(doc("supabase/migrations/160_return_sales_user.sql"))
    expect(sql).toMatch(/ALTER TABLE returns\s+ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES users\(id\)/)
    /**
     * ⚠ HAI CỘT TRẢ LỜI HAI CÂU KHÁC NHAU: ai GÕ phiếu (`requested_by`)
     *   và phiếu tính cho AI. Gộp làm một là mất dấu vết người thao tác
     *   — thứ duy nhất lần ra được khi một phiếu bị lập sai.
     */
    expect(sql).not.toMatch(/DROP COLUMN[^\n]*requested_by/i)
    expect(sql).not.toMatch(/RENAME COLUMN\s+requested_by/i)
  })

  it("cột để RỖNG được — phiếu cũ không bị đoán ngược rồi ghi vào sổ", () => {
    const sql = boChuThich(doc("supabase/migrations/160_return_sales_user.sql"))
    expect(sql).not.toMatch(/sales_user_id[^\n;]*NOT NULL/i)
    /* Backfill là ghi một con số phỏng đoán vào sổ rồi quên mất rằng nó
       là phỏng đoán — đúng cái đường vòng migration này sinh ra để bỏ. */
    expect(sql).not.toMatch(/UPDATE\s+returns\s+SET\s+sales_user_id/i)
  })

  it("migration kết thúc bằng NOTIFY pgrst để PostgREST thấy cột mới", () => {
    const sql = doc("supabase/migrations/160_return_sales_user.sql")
    expect(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })
})

describe("trigger canh người đứng tên", () => {
  const { sql: than } = banMoiNhat("guard_return_sales_user")
  const body = boChuThich(than)

  it("canh CẢ lúc chèn lẫn lúc sửa cột — cửa sau UPDATE rộng y như cửa trước", () => {
    /**
     * ⚠ Bài học mig 155: chặn mỗi lúc chèn thì nhân viên lập phiếu đứng
     *   tên mình rồi `UPDATE` một phát sang tên đồng nghiệp.
     *
     * Đọc ở BẤT KỲ migration nào định nghĩa trigger ấy lần cuối, không
     * ghim vào tệp 160 — mai này dời sang tệp khác thì chốt vẫn đúng.
     */
    const dinhNghia = moiMigration()
      .map((m) => boChuThich(m.sql))
      .filter((s) => s.includes("CREATE TRIGGER trg_returns_guard_sales_user"))
    expect(dinhNghia.length).toBeGreaterThan(0)
    const cuoi = dinhNghia[dinhNghia.length - 1]
    const i = cuoi.indexOf("CREATE TRIGGER trg_returns_guard_sales_user")
    const khai = cuoi.slice(i, cuoi.indexOf(";", i))
    expect(khai).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+sales_user_id\s+ON\s+returns/i)
    expect(khai).toMatch(/FOR EACH ROW/i)
  })

  it("ĐIỀN MẶC ĐỊNH chạy TRƯỚC lối thoát npp.via_rpc", () => {
    /**
     * ⚠ Cờ `npp.via_rpc` miễn phần KIỂM QUYỀN, KHÔNG miễn phần điền.
     *   `reissue_invoice` (mig 152) dựng phiếu trả bên trong RPC mà
     *   không truyền cột này; khối điền nằm sau cờ thì mọi phiếu sinh ra
     *   theo đường ấy rỗng vĩnh viễn, và không ai thấy để mà sửa.
     */
    const iDien = body.indexOf("IF NEW.sales_user_id IS NULL THEN")
    const iCo = body.indexOf("npp.via_rpc")
    expect(iDien).toBeGreaterThanOrEqual(0)
    expect(iCo).toBeGreaterThanOrEqual(0)
    expect(iDien).toBeLessThan(iCo)
  })

  it("để trống + có đơn gốc → lấy nhân viên CỦA ĐƠN, không lấy người gõ", () => {
    const iDien = body.indexOf("IF NEW.sales_user_id IS NULL THEN")
    const khoiDien = body.slice(iDien, body.indexOf("npp.via_rpc"))
    /* Đây không phải phỏng đoán: đơn đã ghi sẵn tên, phiếu chỉ đọc lại. */
    expect(khoiDien).toMatch(/NEW\.order_id IS NOT NULL/)
    expect(khoiDien).toMatch(/FROM\s+sales_orders/i)
    expect(khoiDien).toMatch(/sales_orders\s+\w+\s+WHERE\s+\w+\.id\s*=\s*NEW\.order_id/i)
  })

  it("không có đơn gốc → chỉ lấy người gõ KHI người gõ có bán hàng", () => {
    /**
     * ⚠ Mặc định sang tài khoản kho / kế toán là dựng ra đúng "dòng trừ
     *   doanh số không ai nhận" mà khối kiểm bên dưới đang chặn. Không
     *   ai nhận thì để rỗng, và rỗng đọc đúng là "chưa gán".
     */
    const iDien = body.indexOf("IF NEW.sales_user_id IS NULL THEN")
    const khoiDien = body.slice(iDien, body.indexOf("npp.via_rpc"))
    const iGan = khoiDien.indexOf("NEW.sales_user_id := v_me")
    expect(iGan).toBeGreaterThan(0)
    /* Điều kiện gác phải nằm NGAY TRƯỚC phép gán, trong cùng một IF. */
    const truoc = khoiDien.slice(0, iGan)
    const dieuKien = truoc.slice(truoc.lastIndexOf("IF "))
    expect(dieuKien).toMatch(/user_role\(\)\s+IN\s*\(([^)]*)\)/i)
    const bo = dieuKien.match(/user_role\(\)\s+IN\s*\(([^)]*)\)/i)![1]
    for (const vt of ["sales", "manager", "owner"]) expect(bo).toContain(`'${vt}'`)
    for (const vt of ["warehouse", "accountant", "driver"]) expect(bo).not.toContain(`'${vt}'`)
  })

  it("đặt tay tên người KHÁC: chỉ chủ nhà / quản lý, và phải ném lỗi", () => {
    const iKhac = body.indexOf("NEW.sales_user_id = v_me")
    expect(iKhac).toBeGreaterThan(0)
    const sau = body.slice(iKhac)
    /* Ai được phép */
    const m = sau.match(/v_role\s+NOT IN\s*\(([^)]*)\)/i)
    expect(m).not.toBeNull()
    expect(m![1]).toContain("'owner'")
    expect(m![1]).toContain("'manager'")
    expect(m![1]).not.toContain("'sales'")
    /* Và từ chối phải là NÉM, không phải lặng lẽ sửa về chính mình. */
    const iRole = sau.indexOf("v_role")
    expect(sau.slice(iRole, iRole + 600)).toMatch(/RAISE EXCEPTION/)
  })

  it("người ĐƯỢC GÁN phải cùng đơn vị và phải có vai trò bán hàng", () => {
    const iKhac = body.indexOf("NEW.sales_user_id = v_me")
    const sau = body.slice(iKhac)
    /* Cùng org — gán sang người của NPP khác là ghi doanh số ra ngoài sổ. */
    expect(sau).toMatch(/org_id\s*<>\s*NEW\.org_id/i)
    /* Và đúng bộ vai trò có bán hàng. */
    const m = sau.match(/u\.role\s+NOT IN\s*\(([^)]*)\)/i)
    expect(m).not.toBeNull()
    for (const vt of ["sales", "manager", "owner"]) expect(m![1]).toContain(`'${vt}'`)
    expect(m![1]).not.toContain("'warehouse'")
    /* Cả hai vế đều phải NÉM, không phải bỏ qua. */
    expect(sau).toMatch(/NHAN_VIEN_KHONG_HOP_LE/)
    expect(sau).toMatch(/NHAN_VIEN_KHONG_BAN_HANG/)
  })

  it("hàm chạy SECURITY DEFINER với search_path ghim", () => {
    /* Nó đọc `users` và `sales_orders` thay mặt người gọi — không ghim
       search_path là mở đường cho một schema giả chen vào. */
    expect(than).toMatch(/SECURITY DEFINER\s+SET search_path = public/)
  })
})

describe("màn lập phiếu trả — ô chọn nhân viên", () => {
  const man = doc("src/app/(dashboard)/returns/new/page.tsx")
  const ma = boChuThich(man)

  it("chỉ chủ nhà / quản lý thấy ô chọn", () => {
    /**
     * ⚠ Nhân viên lập phiếu của chính mình. Cho họ chọn tên người khác
     *   là mở đường đẩy khoản TRỪ doanh số sang tên đồng nghiệp — và
     *   trigger cũng sẽ từ chối, nên ô ấy chỉ để bẫy người dùng.
     */
    const m = ma.match(/const canPickSeller\s*=\s*([^\n]+)/)
    expect(m).not.toBeNull()
    expect(m![1]).toContain('"owner"')
    expect(m![1]).toContain('"manager"')
    expect(m![1]).not.toContain('"sales"')
    /* Và ô chọn phải thật sự nằm sau cái cổng ấy. */
    const iO = ma.indexOf('id="ret-seller"')
    expect(iO).toBeGreaterThan(0)
    expect(ma.slice(Math.max(0, iO - 1200), iO)).toContain("canPickSeller &&")
  })

  it("danh sách nhân viên đúng bộ vai trò trigger cho phép", () => {
    /* Hiện ra một cái tên mà máy chủ sẽ từ chối là bẫy người dùng. */
    const m = ma.match(/\.in\("role",\s*\[([^\]]*)\]\)/)
    expect(m).not.toBeNull()
    for (const vt of ["sales", "manager", "owner"]) expect(m![1]).toContain(`"${vt}"`)
    for (const vt of ["warehouse", "accountant", "driver"]) expect(m![1]).not.toContain(`"${vt}"`)
  })

  it("chọn xong thì GỬI cột đi, và không có quyền chọn thì KHÔNG gửi", () => {
    /**
     * ⚠ Bỏ trống để trigger tự điền theo đơn gốc. Ghi đè `user.id` ở đây
     *   là cướp mất luật ấy — tài khoản kế toán gõ hộ một phiếu là thành
     *   một dòng trừ doanh số không ai nhận.
     */
    const m = ma.match(/if \(([^)]*)\) (\w+)\.sales_user_id = (\w+)/)
    expect(m).not.toBeNull()
    expect(m![1]).toContain("canPickSeller")
    expect(m![1]).toContain("sellerId")
    expect(m![3]).toBe("sellerId")
    /* Không được có đường nào gửi `user.id` vào cột này. */
    expect(ma).not.toMatch(/sales_user_id[^\n]*user\.id/)
  })

  it("lùi 'chưa chạy migration' phải HẸP — không nuốt lời từ chối của trigger", () => {
    /**
     * ⚠ Đây là chốt quan trọng nhất của màn này. Hàm lùi nới ra một chút
     *   là nó nuốt luôn `PHIEU_TRA_HO_KHONG_DUOC_PHEP` /
     *   `NHAN_VIEN_KHONG_BAN_HANG`, rồi lặng lẽ ghi lại phiếu KHÔNG có
     *   người đứng tên. Người dùng thấy "đã tạo" và tin là đã gán xong.
     */
    const i = ma.indexOf("function retryWithoutSalesUser")
    expect(i).toBeGreaterThan(0)
    const than = ma.slice(i, ma.indexOf("\n}", i))
    /* Bắt buộc nhắc đích danh tên cột, và thoát sớm nếu không có. */
    expect(than).toMatch(/if \(!\w+\.includes\("sales_user_id"\)\) return false/)
    /* Và phải xét mã lỗi, không chỉ xét chữ. */
    expect(than).toMatch(/PGRST204/)
    expect(than).toMatch(/42703/)
  })
})

describe("màn chi tiết phiếu trả — đổi người đứng tên", () => {
  const ma = boChuThich(doc("src/app/(dashboard)/returns/[id]/page.tsx"))

  it("đổi xong phải ĐẾM SỐ DÒNG — RLS từ chối là 0 dòng, HTTP 200, error null", () => {
    const i = ma.indexOf("const luuNguoiDungTen")
    expect(i).toBeGreaterThan(0)
    const than = ma.slice(i, ma.indexOf("\n  }", i))
    expect(than).toMatch(/\.update\(\{ sales_user_id/)
    expect(than).toMatch(/\.select\("id"\)/)
    expect(than).toMatch(/length === 0/)
    /* Và 0 dòng phải NÉM, không phải báo thành công. */
    const iDem = than.indexOf("length === 0")
    expect(than.slice(iDem, iDem + 300)).toMatch(/throw new Error/)
  })

  it("chưa chạy mig 160 thì GIẤU khối ấy đi, không vẽ nút chắc chắn hỏng", () => {
    /* `coCotNguoiDungTen === false` nghĩa là sổ chưa có cột — khác hẳn
       "chưa gán". Vẽ ô chọn lúc ấy là mời người ta bấm một cái nút mà
       máy chủ chắc chắn từ chối. */
    expect(ma).toMatch(/setCoCotNguoiDungTen\(false\)/)
    const i = ma.indexOf("{coCotNguoiDungTen && (")
    expect(i).toBeGreaterThan(0)
    /* Ô chọn và nút Đổi đều phải nằm trong khối ấy. */
    const khoi = ma.slice(i, i + 3000)
    expect(khoi).toContain('id="ret-seller"')
    expect(khoi).toContain("canPickSeller &&")
  })

  it("hỏi riêng một câu, không nhét vào câu lớn của màn", () => {
    /**
     * ⚠ Mã nguồn lên trước migration là chuyện thường ở đây. Nhét
     *   `sales_user_id` vào câu `select` lớn là cột chưa có thì CẢ màn
     *   chi tiết phiếu trả trắng bóc. Hỏi riêng thì hỏng riêng.
     */
    const iLon = ma.indexOf('"id, order_id, invoice_id, reason, status')
    expect(iLon).toBeGreaterThan(0)
    const cauLon = ma.slice(iLon, ma.indexOf('"', iLon + 10))
    expect(cauLon).not.toContain("sales_user_id")
  })
})

describe("báo cáo nhân viên — đọc cột thay vì đoán", () => {
  const bc = boChuThich(doc("src/app/(dashboard)/reports/employees/page.tsx"))
  const at = boChuThich(doc("src/lib/analytics/sales.ts"))

  it("câu hỏi phiếu trả có kéo cột về, và sống sót khi cột chưa có", () => {
    expect(at).toContain("sales_user_id")
    const i = at.indexOf("export async function fetchReturnsRows")
    const than = at.slice(i, at.indexOf("\n}", i))
    /* Hai cột có thể thiếu ĐỘC LẬP nhau (`credited_at` mig 097,
       `sales_user_id` mig 160) — phải lùi qua đủ bốn tổ hợp. */
    const soLan = (than.match(/isMissingColumn/g) || []).length
    expect(soLan).toBeGreaterThanOrEqual(3)
    expect(than).toMatch(/load\("created_at", false\)/)
    /* Và hàm nhận diện phải biết tên cột mới. */
    const j = at.indexOf("function isMissingColumn")
    expect(at.slice(j, at.indexOf("\n}", j))).toContain("sales_user_id")
  })

  it("CẢ HAI chỗ quy phiếu trả về nhân viên đều đọc cột trước, đoán sau", () => {
    /**
     * ⚠ HAI BẢNG LỆCH LUẬT LÀ HAI CON SỐ TRẢ HÀNG KHÁC NHAU TRÊN CÙNG
     *   MỘT TRANG, và không ai biết tin bảng nào. Trang này có hai chỗ
     *   quy phiếu trả: bảng "Bán hàng" (theo phiếu) và bảng "Hàng bán
     *   theo nhân viên" (theo dòng hàng trả).
     */
    const choDoc = bc.match(/r\.sales_user_id/g) || []
    expect(choDoc.length).toBeGreaterThanOrEqual(2)

    /* Chỗ 1 — vòng theo phiếu. */
    const i1 = bc.indexOf("for (const r of returns) {")
    expect(i1).toBeGreaterThan(0)
    const v1 = bc.slice(i1, bc.indexOf("\n    }", i1))
    expect(v1).toContain("r.sales_user_id")
    /* Vẫn đoán cho phiếu CHƯA GÁN — bỏ chúng ra ngoài sổ là doanh số
       thuần của cả năm ngoái tự nhiên tăng lên. */
    expect(v1).toContain("orderByCustomer")

    /* Chỗ 2 — bảng theo dòng hàng trả. */
    const i2 = bc.indexOf("const returnIdToSalesUser")
    expect(i2).toBeGreaterThan(0)
    const v2 = bc.slice(i2, i2 + 400)
    expect(v2).toContain("r.sales_user_id")
    expect(v2).toContain("lastSalesUserByCustomer")
  })

  it("không còn chỗ nào quy phiếu trả BẰNG ĐOÁN mà không thử đọc cột trước", () => {
    /**
     * ⚠ Chốt này canh chiều ngược: đếm số chỗ dùng phép đoán, và đòi mỗi
     *   chỗ ấy đều có `sales_user_id` đứng trước nó trong cùng một khối.
     */
    for (const moc of ["orderByCustomer.get(", "lastSalesUserByCustomer.get("]) {
      let i = bc.indexOf(moc)
      while (i >= 0) {
        const truoc = bc.slice(Math.max(0, i - 400), i)
        expect(truoc).toContain("sales_user_id")
        i = bc.indexOf(moc, i + 1)
      }
    }
  })
})
