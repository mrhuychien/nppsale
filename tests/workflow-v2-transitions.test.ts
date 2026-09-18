import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const MIG = read("supabase/migrations/119_workflow_v2.sql")
/** Bỏ chú thích: chính file này trích lại nguyên văn trạng thái cũ để giải thích. */
const SQL = MIG.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
const at = (needle: string) => SQL.indexOf(needle)

/**
 * Migration 119 đổi máy trạng thái đơn hàng sang workflow v2.
 *
 * Không có Postgres trong bộ test, nên đây là chốt CẤU TRÚC: giữ đúng
 * những thứ mà chạy sai một lần là hỏng dữ liệu thật và không lùi được.
 */
describe("119 — thứ tự chạy (sai thứ tự là migration chết giữa chừng)", () => {
  /**
   * ⚠ Ràng buộc CHECK mới chỉ nhận 4 giá trị. Thêm nó TRƯỚC khi backfill
   * thì mọi dòng đang mang 'confirmed'/'picking'/'delivering'/'delivered'
   * đều vi phạm, ALTER TABLE thất bại, không ai đổi được gì.
   */
  it("backfill xong mới siết ràng buộc trạng thái", () => {
    const backfill = at("UPDATE sales_orders\n  SET status = 'submitted'")
    const check = at("ADD CONSTRAINT chk_sales_orders_status_v2")
    expect(backfill).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(backfill)
  })

  /**
   * ⚠ Trigger cũ cấm 'confirmed' sang bất cứ đâu ngoài picking/cancelled.
   * Còn nó thì lệnh backfill đầu tiên đã RAISE.
   */
  it("gỡ trigger chuyển trạng thái trước backfill, dựng lại bản mới sau", () => {
    const drop = at("DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;")
    const backfill = at("UPDATE sales_orders\n  SET status = 'submitted'")
    const recreate = at("CREATE TRIGGER trg_check_order_status")
    expect(drop).toBeGreaterThan(0)
    expect(backfill).toBeGreaterThan(drop)
    expect(recreate).toBeGreaterThan(backfill)
  })

  /**
   * ⚠ Trigger ghi lịch sử chạy êm nhưng sinh một dòng cho MỖI đơn được
   * backfill. Phải tắt lúc chạy và BẬT LẠI — quên bật lại thì từ đó về
   * sau không đơn nào còn lịch sử trạng thái, và không ai nhận ra.
   */
  it("tắt trigger ghi lịch sử khi backfill rồi bật lại", () => {
    // ⚠ Chốt này từng nói dối: nó chỉ soi cụm chữ "ENABLE TRIGGER…", nên
    // vẫn xanh khi câu lệnh bật lại bị hỏng thành chú thích giữa chuỗi.
    // Soi trọn câu lệnh.
    const off = at("EXECUTE 'ALTER TABLE sales_orders DISABLE TRIGGER trg_log_order_status';")
    const backfill = at("UPDATE sales_orders\n  SET status = 'submitted'")
    const on = at("EXECUTE 'ALTER TABLE sales_orders ENABLE TRIGGER trg_log_order_status';")
    expect(off).toBeGreaterThan(0)
    expect(backfill).toBeGreaterThan(off)
    expect(on).toBeGreaterThan(backfill)
  })
})

describe("119 — ràng buộc CHECK không tên", () => {
  /**
   * ⚠ sales_orders.status, returns.status, cash_receipts.source_type và
   * payments.method đều khai inline ở mig 001 nên Postgres tự đặt tên.
   * Tên đó KHÔNG có trong repo. Viết DROP CONSTRAINT theo tên đoán là
   * migration chạy được trên máy này và chết trên máy khách.
   */
  for (const [table, marker] of [
    ["sales_orders", "%confirmed%"],
    ["returns", "%rejected%"],
    ["cash_receipts", "%delivery_settle%"],
    ["payments", "%ewallet%"],
  ] as const) {
    it(`${table}: tra pg_constraint chứ không đoán tên`, () => {
      const i = SQL.indexOf(`ILIKE '${marker}'`)
      expect(i, `thiếu khối tra tên ràng buộc của ${table}`).toBeGreaterThan(0)
      const block = SQL.slice(Math.max(0, i - 500), i + 400)
      expect(block).toContain("FROM pg_constraint con")
      expect(block).toContain(`rel.relname = '${table}'`)
      expect(block).toContain("EXECUTE format(")
    })
  }

  it("không hardcode tên ràng buộc tự sinh của Postgres", () => {
    expect(SQL).not.toContain("sales_orders_status_check")
    expect(SQL).not.toContain("returns_status_check")
    expect(SQL).not.toContain("payments_method_check")
    expect(SQL).not.toContain("cash_receipts_source_type_check")
  })
})

describe("119 — máy trạng thái mới", () => {
  const fn = SQL.slice(
    at("CREATE OR REPLACE FUNCTION public.check_order_status_transition()"),
    at("DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;\nCREATE TRIGGER")
  )

  it("chỉ còn 4 nhánh chuyển, không còn bước duyệt", () => {
    expect(fn).toContain("OLD.status = 'draft' AND NEW.status NOT IN ('submitted', 'cancelled')")
    expect(fn).toContain("OLD.status = 'submitted' AND NEW.status NOT IN ('completed', 'cancelled', 'draft')")
    expect(fn).toContain("OLD.status = 'completed' AND NEW.status <> 'cancelled'")
    expect(fn).toContain("OLD.status = 'cancelled'")
    // Ngưỡng duyệt cứng 20tr/50tr phải biến mất cùng bước duyệt.
    expect(fn).not.toContain("20000000")
    expect(fn).not.toContain("50000000")
  })

  /**
   * ⚠ Đây là lý do tồn tại của cả migration: hai bước đụng kho và công nợ
   * không được làm bằng UPDATE rời từ trình duyệt. Bỏ chốt này là quay về
   * đúng cảnh đơn "đang giao" mà kho chưa trừ.
   */
  it("xuất hàng và huỷ đơn đã xuất bắt buộc đi qua RPC", () => {
    expect(fn).toContain("OLD.status = 'submitted' AND NEW.status = 'completed'")
    expect(fn).toContain("OLD.status = 'completed' AND NEW.status = 'cancelled'")
    expect(fn).toContain("current_setting('npp.via_rpc', true)")
    expect(fn).toContain("USE_RPC")
  })

  it("tự đóng mốc gửi và mốc huỷ khi còn trống", () => {
    expect(fn).toContain("NEW.status = 'submitted' AND NEW.submitted_at IS NULL")
    expect(fn).toContain("NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL")
  })
})

describe("119 — backfill không bịa số liệu", () => {
  /**
   * ⚠ Đơn cũ không lưu mốc gửi. created_at là mốc TẠO. Lấy nó làm mốc
   * gửi là bịa một con số trông hợp lý, và không ai phát hiện ra.
   */
  it("không gán submitted_at cho đơn cũ", () => {
    const i = at("DO $$\nDECLARE\n  v_draft_keep int;")
    const j = SQL.indexOf("END $$;", i)
    expect(i).toBeGreaterThan(0)
    expect(SQL.slice(i, j)).not.toContain("submitted_at")
  })

  /** Mốc xuất hàng lấy từ phiếu xuất đã ghi sổ của chính đơn đó. */
  it("completed_at lấy từ phiếu xuất posted, không có mới lấy now()", () => {
    expect(SQL).toContain("SELECT max(se.posted_at)")
    expect(SQL).toContain("se.ref_order_ids @> jsonb_build_array(so.id::text)")
  })

  /**
   * ⚠ Đơn từng xuất kho thật rồi mới huỷ (giao thất bại) phải giữ dấu.
   * Mất dấu là đơn đó lọt vào diện xoá được, kéo theo cả hồ sơ kho.
   */
  it("đơn huỷ đã từng xuất kho vẫn được đóng dấu completed_at", () => {
    const i = at("WHERE so.status = 'cancelled'")
    expect(i).toBeGreaterThan(0)
    expect(SQL.slice(i, i + 400)).toContain("so.completed_at IS NULL")
  })

  it("đếm và in ra số dòng đã đổi", () => {
    expect(SQL).toContain("GET DIAGNOSTICS")
    expect(SQL).toContain("RAISE NOTICE '119 backfill sales_orders")
    expect(SQL).toContain("RAISE NOTICE '119 backfill returns")
  })
})

describe("119 — doanh thu", () => {
  it("is_revenue_status chỉ còn đơn đã xuất hàng", () => {
    const i = at("CREATE FUNCTION public.is_revenue_status(p_status text)")
    expect(i).toBeGreaterThan(0)
    expect(SQL.slice(i, SQL.indexOf("$$;", i))).toContain("= 'completed'")
  })

  /**
   * ⚠ DROP FUNCTION xoá sạch quyền đã cấp. Quên GRANT lại thì trang báo
   * cáo tài chính trả lỗi quyền cho mọi người dùng.
   */
  it("finance_pnl đổi sang is_revenue_status và được cấp lại quyền", () => {
    const drop = at("DROP FUNCTION IF EXISTS public.finance_pnl(date, date);")
    const create = at("CREATE FUNCTION public.finance_pnl(p_from date, p_to date)")
    const grant = at("GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;")
    expect(drop).toBeGreaterThan(0)
    expect(create).toBeGreaterThan(drop)
    expect(grant).toBeGreaterThan(create)
    expect(SQL.slice(create, grant)).toContain("public.is_revenue_status(status)")
    expect(SQL.slice(create, grant)).not.toContain("status = 'delivered'")
  })
})

describe("119 — dấu vết FIFO để hoàn kho đúng lô", () => {
  /**
   * ⚠ Chỉ thêm ĐÚNG MỘT lệnh vào post_stock_export. Hàm này đang gánh
   * chống-trừ-hai-lần; sửa rộng tay ở đây là đánh đổi rất xấu.
   */
  it("chèn đúng một lệnh ghi nhận, nằm trong vòng lặp trừ lô", () => {
    expect((SQL.match(/INSERT INTO stock_line_consumptions/g) || []).length).toBe(1)
    const upd = at("UPDATE batches\n      SET qty_on_hand = qty_on_hand - v_take")
    const ins = at("INSERT INTO stock_line_consumptions")
    const endLoop = SQL.indexOf("END LOOP;", ins)
    expect(upd).toBeGreaterThan(0)
    expect(ins).toBeGreaterThan(upd)
    expect(endLoop).toBeGreaterThan(ins)
    // Ghi đúng lô vừa trừ và đúng số vừa lấy, không phải tổng dòng.
    expect(SQL.slice(ins, ins + 200)).toContain("VALUES (l.id, b.id, v_take,")
  })

  /** ⚠ Bảng này do RPC ghi (SECURITY DEFINER). Không mở cửa ghi cho client. */
  it("chỉ mở quyền đọc, không mở quyền ghi", () => {
    expect(SQL).toContain('CREATE POLICY "Org members can view stock line consumptions"')
    expect(SQL).toContain("ON stock_line_consumptions FOR SELECT")
    expect(SQL).toContain("GRANT SELECT ON stock_line_consumptions TO authenticated;")
    expect(SQL).not.toMatch(/GRANT (INSERT|UPDATE|ALL)[^\n]*stock_line_consumptions/)
  })
})

describe("119 — trần số lượng trả", () => {
  const fn = SQL.slice(
    at("CREATE OR REPLACE FUNCTION public.enforce_return_line_cap()"),
    at("DROP TRIGGER IF EXISTS trg_return_lines_cap")
  )

  /**
   * ⚠ product_units gọi cột quy đổi là `conversion`. Mọi bảng khác gọi
   * `conversion_factor`. Gõ nhầm là lỗi 42703 ngay lúc chạy migration.
   */
  it("quy đổi qua product_units.conversion, không phải conversion_factor", () => {
    expect(fn).toContain("SELECT pu.conversion FROM product_units pu")
    expect(fn).not.toContain("pu.conversion_factor")
  })

  it("chỉ chặn dòng trả tiền, bỏ qua dòng đổi hàng", () => {
    expect(fn).toContain("IF NEW.is_exchange THEN")
    expect(fn).toContain("rl.is_exchange = false")
  })

  it("chỉ trừ phần đã trả ở phiếu ĐÃ HOÀN THÀNH, và không tự đếm chính nó", () => {
    expect(fn).toContain("r2.status = 'completed'")
    expect(fn).toContain("rl.id <> NEW.id")
  })

  it("phiếu trả không gắn đơn thì không chặn", () => {
    expect(fn).toContain("IF v_order IS NULL THEN")
  })

  it("báo lỗi có mã để giao diện đọc được", () => {
    expect(fn).toContain("RETURN_QTY_EXCEEDS")
    expect(fn).toContain("ERRCODE = 'P0001'")
  })
})

describe("119 — phân quyền hàng", () => {
  /** ⚠ Nháp là sổ tay riêng của NVBH: gửi rồi NPP mới được nhìn. */
  it("nháp chỉ chủ đơn thấy, áp cho MỌI vai trò", () => {
    const i = at("CREATE POLICY sales_order_select ON sales_orders")
    const policy = SQL.slice(i, SQL.indexOf(");", SQL.indexOf("driver", i)))
    expect(policy).toContain("status <> 'draft' OR sales_user_id = auth.uid()")
    // Điều kiện nháp nằm NGOÀI khối OR vai trò, nếu không thì quản lý vẫn thấy.
    expect(policy.indexOf("status <> 'draft'")).toBeLessThan(policy.indexOf("public.user_role() IN ('owner'"))
  })

  /** Module giao hàng chỉ bị ẩn khỏi menu, chưa xoá — tài xế vẫn cần đọc đơn. */
  it("giữ nhánh đọc đơn của tài xế", () => {
    expect(SQL).toContain("public.user_role() = 'driver'")
    expect(SQL).toContain("WHERE d.driver_id = auth.uid()")
  })

  /** ⚠ Đơn từng xuất kho thì không xoá được, kể cả sau khi huỷ. */
  it("xoá đơn đòi completed_at rỗng", () => {
    const i = at('CREATE POLICY "Owner/Manager can delete draft or cancelled orders"')
    expect(i).toBeGreaterThan(0)
    expect(SQL.slice(i, SQL.indexOf(");", i))).toContain("completed_at IS NULL")
  })

  it("NVBH sửa được đơn nháp và phiếu tạm của mình, tự huỷ được", () => {
    const i = at('CREATE POLICY "Sales can update own open orders" ON sales_orders')
    const policy = SQL.slice(i, SQL.indexOf(");", i))
    expect(policy).toContain("status IN ('draft', 'submitted')")
    expect(policy).toContain("status IN ('draft', 'submitted', 'cancelled')")
  })

  /** ⚠ Dòng hàng của đơn đã xuất chỉ đổi qua RPC, nếu không thì sửa đơn
   *  đã hoàn thành sẽ đi thẳng xuống bảng mà kho không biết. */
  it("dòng hàng của đơn đã hoàn thành khoá ngoài RPC", () => {
    const i = at('CREATE POLICY "Admin roles can manage order lines" ON sales_order_lines')
    const policy = SQL.slice(i, SQL.indexOf(");", SQL.indexOf("via_rpc", i)))
    expect(policy).toContain("so.status <> 'completed'")
    expect(policy).toContain("current_setting('npp.via_rpc', true)")
  })
})

describe("119 — quy ước migration", () => {
  it("nạp lại schema cho PostgREST", () => {
    expect(SQL).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it("chạy lại lần hai không hỏng", () => {
    // Mọi ALTER TABLE thêm cột đều IF NOT EXISTS; mọi trigger/policy DROP
    // trước CREATE; mọi ràng buộc đặt tay DROP IF EXISTS trước ADD.
    const addCols = SQL.match(/ADD COLUMN (IF NOT EXISTS )?/g) || []
    expect(addCols.length).toBeGreaterThan(0)
    expect(addCols.every((s) => s.includes("IF NOT EXISTS"))).toBe(true)

    for (const name of (SQL.match(/ADD CONSTRAINT (\w+)/g) || []).map((s) => s.split(" ")[2])) {
      expect(SQL, `thiếu DROP CONSTRAINT IF EXISTS ${name}`).toContain(
        `DROP CONSTRAINT IF EXISTS ${name}`
      )
    }

    for (const name of (SQL.match(/CREATE POLICY "([^"]+)"/g) || []).map((s) => s.slice(15, -1))) {
      expect(SQL, `thiếu DROP POLICY IF EXISTS "${name}"`).toContain(
        `DROP POLICY IF EXISTS "${name}"`
      )
    }
  })

  it("giải thích VÌ SAO chứ không chỉ mô tả cái gì", () => {
    expect(MIG).toContain("TRƯỚC KHI SỬA")
    expect(MIG).toContain("VÌ SAO")
    expect(MIG).toContain("KHÔNG ĐỔI")
  })
})
