import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { NON_REVENUE_ORDER_STATUSES } from "../src/lib/constants"

/**
 * WORKFLOW V2B — P3: doanh thu chuyển gốc từ ĐƠN sang HÓA ĐƠN (mig 126).
 *
 * ⚠ BẤT BIẾN LỚN NHẤT CỦA TỆP NÀY: không hàm nào được vừa lọc bằng
 * `is_revenue_status` vừa cộng `sales_orders.total`. Đơn xuất một phần
 * lọt qua bộ lọc đó sẽ mang theo TOÀN BỘ giá trị đơn vào doanh thu, dù
 * mới giao một nửa.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const RAW126 = read("supabase/migrations/126_wf2b_revenue_from_invoices.sql")
const M126 = RAW126.replace(/^\s*--.*$/gm, "")

/** Cắt thân một hàm trong bản đã lược chú thích. */
function fn(name: string): string {
  const i = M126.indexOf(`FUNCTION public.${name}(`)
  expect(i, `không tìm thấy hàm ${name}`).toBeGreaterThan(0)
  const j = M126.indexOf("\n$$;", i)
  return M126.slice(i, j > 0 ? j : undefined)
}

// =====================================================================

describe("is_revenue_status đổi nghĩa, giữ chữ ký", () => {
  const F = fn("is_revenue_status")

  /**
   * ⚠ GIỮ NGUYÊN TÊN, CÓ CHỦ Ý. Sáu hàm lương/báo cáo đang gọi nó. Đổi
   * tên là phải sửa cả sáu trong cùng migration, và hàm nào sót lại gọi
   * một cái tên không còn tồn tại — PL/pgSQL chỉ tra tên lúc CHẠY, nên
   * nó không vỡ khi cài mà vỡ giữa kỳ tính lương.
   */
  it("vẫn là is_revenue_status(text) RETURNS boolean", () => {
    expect(M126).toContain("CREATE FUNCTION public.is_revenue_status(p_status text)")
    expect(F).toContain("RETURNS boolean")
  })

  it("DROP trước CREATE, vì bản cũ đã tồn tại", () => {
    const drop = M126.indexOf("DROP FUNCTION IF EXISTS public.is_revenue_status(text)")
    const create = M126.indexOf("CREATE FUNCTION public.is_revenue_status(")
    expect(drop).toBeGreaterThan(0)
    expect(create).toBeGreaterThan(drop)
  })

  /**
   * ⚠ 'closed' PHẢI CÓ. Đơn đóng là đơn NPP chốt không giao nốt phần còn
   * lại — phần ĐÃ giao vẫn là hàng đã bán và tiền đã ghi nợ. Bỏ nó ra là
   * xoá doanh thu có thật chỉ vì đơn giao thiếu.
   */
  it("nhận đúng ba trạng thái đã xuất hàng", () => {
    expect(F).toContain(
      "IN ('partially_invoiced', 'completed', 'closed')"
    )
  })

  it("KHÔNG nhận phiếu tạm, đơn nháp hay đơn đã huỷ", () => {
    for (const s of ["'draft'", "'submitted'", "'cancelled'"]) {
      expect(F, `${s} lọt vào doanh thu`).not.toContain(s)
    }
  })

  /**
   * ⚠ HẰNG SỐ TYPESCRIPT LÀ PHẦN BÙ. Có một chốt khác so hai bên bằng
   * cách suy ra từ ràng buộc CHECK (`payroll-net-revenue.test.ts`); chốt
   * này viết thẳng kết quả mong đợi, để khi chốt kia đỏ thì biết ngay
   * bên nào lệch.
   */
  it("hằng số TypeScript đúng là phần bù", () => {
    expect([...NON_REVENUE_ORDER_STATUSES].sort()).toEqual([
      "cancelled", "draft", "submitted",
    ])
  })
})

// =====================================================================

describe("Số tiền cộng từ hóa đơn, không cộng từ đơn", () => {
  const AMOUNT_FNS = [
    "dashboard_summary",
    "dashboard_channel_revenue",
    "dashboard_top_customers",
    "finance_pnl",
    "_wf2b_gross_revenue_for",
  ]

  it.each(AMOUNT_FNS)("%s cộng total của sales_invoices", (name) => {
    const F = fn(name)
    expect(F).toContain("sales_invoices")
    expect(F).toContain("is_revenue_invoice_status")
  })

  /**
   * ⚠ ĐÂY LÀ CHỐT QUAN TRỌNG NHẤT CỦA TỆP. Một hàm vừa lọc bằng
   * `is_revenue_status` vừa cộng `sales_orders.total` sẽ cho đơn mới
   * giao một nửa mang TOÀN BỘ giá trị đơn vào doanh thu. Trước mig 126
   * điều đó không xảy ra được vì bộ lọc chỉ nhận `'completed'`; nới bộ
   * lọc mà quên đổi nguồn tiền là mở đúng cái cửa ấy.
   */
  it.each(AMOUNT_FNS)("%s KHÔNG cộng total của sales_orders", (name) => {
    const F = fn(name)
    expect(F).not.toContain("FROM sales_orders")
  })

  /**
   * ⚠ NGÀY HÓA ĐƠN, KHÔNG PHẢI NGÀY ĐẶT. Lọc theo `order_date` trên một
   * bảng không có cột đó thì lỗi ngay; nhưng join sang đơn rồi lọc theo
   * ngày đặt thì CHẠY ĐƯỢC, và doanh thu lại lệch khỏi giá vốn — đúng
   * thứ mig 126 vừa gỡ.
   */
  it.each(AMOUNT_FNS)("%s lọc theo invoice_date", (name) => {
    expect(fn(name)).toContain("invoice_date")
  })

  it.each(AMOUNT_FNS)("%s không lọc theo order_date", (name) => {
    expect(fn(name)).not.toContain("order_date")
  })
})

// =====================================================================

describe("Phép ĐẾM ĐƠN vẫn đếm đơn", () => {
  /**
   * ⚠ ĐẾM PHÂN BIỆT. Một đơn xuất hai đợt có hai hóa đơn; `COUNT(*)`
   * trên bảng hóa đơn biến nó thành hai đơn, và ô "Đơn hàng (kỳ)" trên
   * trang tổng quan phình lên theo số chuyến giao chứ không theo số đơn
   * bán được.
   */
  it.each([
    ["dashboard_summary", "COUNT(DISTINCT order_id)"],
    ["dashboard_top_customers", "COUNT(DISTINCT si.order_id)"],
    ["finance_pnl", "COUNT(DISTINCT order_id)"],
  ])("%s đếm phân biệt theo đơn", (name, expr) => {
    expect(fn(name)).toContain(expr)
  })

  it.each(["dashboard_summary", "dashboard_top_customers", "finance_pnl"])(
    "%s không dùng COUNT(*) trên bảng hóa đơn",
    (name) => {
      const F = fn(name)
      const body = F.slice(F.indexOf("sales_invoices"))
      expect(body).not.toContain("COUNT(*) FROM sales_invoices")
    }
  )
})

// =====================================================================

describe("finance_pnl: doanh thu và giá vốn về cùng một trục", () => {
  const F = fn("finance_pnl")

  /**
   * ⚠ ĐÂY LÀ MỘT LỖI CŨ ĐƯỢC SỬA KÈM, không phải hệ quả phụ. `cogs` vốn
   * lấy theo `stock_entries.posted_at` — ngày hàng rời kho — còn doanh
   * thu lấy theo `order_date`. Lãi gộp của một kỳ vì thế đang so doanh
   * thu ngày ĐẶT với giá vốn ngày GIAO: đơn đặt cuối tháng 3 giao đầu
   * tháng 4 làm tháng 3 lãi khống và tháng 4 lỗ khống.
   */
  it("giá vốn vẫn theo posted_at của phiếu xuất", () => {
    expect(F).toContain("e.posted_at >= p_from::timestamptz")
    expect(F).toContain("e.posted_at <  (p_to + 1)::timestamptz")
  })

  it("chi phí giữ nguyên, không đụng tới", () => {
    expect(F).toContain("LEFT JOIN expense_categories ec ON ec.id = x.category_id")
    expect(F).toContain("GROUP BY COALESCE(ec.bucket, 'other')")
  })

  it("trả về đủ mười cột như cũ", () => {
    for (const c of [
      "revenue", "order_count", "cogs", "exp_cogs", "exp_operating",
      "exp_hr", "exp_financial", "exp_tax", "exp_other", "total_expenses",
    ]) {
      expect(F, `thiếu cột ${c}`).toContain(c)
    }
  })

  it("được cấp lại quyền sau khi DROP", () => {
    const drop = M126.indexOf("DROP FUNCTION IF EXISTS public.finance_pnl(date, date)")
    const grant = M126.indexOf("GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated")
    expect(drop).toBeGreaterThan(0)
    expect(grant).toBeGreaterThan(drop)
  })
})

// =====================================================================

describe("compute_payroll_run: vá một câu, không chép lại cả hàm", () => {
  /**
   * ⚠ CHÉP LẠI 400 DÒNG LÀ DỰNG MỘT BẢN SAO THỨ HAI mà không ai đối
   * chiếu nổi với bản gốc — một chữ chép sai nằm im tới kỳ lương sau.
   * Vá thì nếu câu cần vá không còn đúng hình dạng, khối này DỪNG.
   */
  it("RAISE nếu không tìm thấy đúng câu cần vá", () => {
    expect(M126).toContain("WF2B_PAYROLL_SHAPE")
    expect(M126).toContain("IF v_stmt IS NULL THEN")
  })

  /**
   * ⚠ CẮT CÂU THẬT RA RỒI MỚI SO — không so bằng một chuỗi chép tay kèm
   * thụt đầu dòng. Bản đầu làm thế và chết trên CSDL thật chỉ vì hàm ở đó
   * không cùng hình dạng. Thay thế cũng phải dùng CHÍNH đoạn vừa cắt,
   * nếu không thì lại phụ thuộc vào khoảng trắng y như cũ.
   */
  it("cắt câu thật từ thân hàm, và thay đúng đoạn vừa cắt", () => {
    expect(M126).toContain(
      "v_stmt := substring(v_src from 'SELECT[^;]+INTO[[:space:]]+v_gross[^;]+;');"
    )
    expect(M126).toContain("EXECUTE replace(v_src, v_stmt, v_new);")
    // Không còn so bằng chuỗi chép tay.
    expect(M126).not.toContain("position(v_old IN v_src)")
  })

  it("so sánh sau khi chuẩn hoá khoảng trắng", () => {
    expect(M126).toContain(
      "v_norm := btrim(lower(regexp_replace(v_stmt, '[[:space:]]+', ' ', 'g')));"
    )
  })

  /**
   * ⚠ `replace()` THAY MỌI CHỖ KHỚP. Một ngày nào đó có hai câu cùng gán
   * v_gross thì vá cả hai là sai — phải dừng để người sửa nhìn tận mắt.
   */
  it("RAISE nếu thân hàm có nhiều hơn một câu gán v_gross", () => {
    expect(M126).toContain(
      "FROM regexp_matches(v_src, 'SELECT[^;]+INTO[[:space:]]+v_gross[^;]+;', 'g');"
    )
    expect(M126).toContain("có % câu gán v_gross trong compute_payroll_run, cần đúng 1.")
  })

  /**
   * ⚠ LỖI PHẢI NÓI NÓ ĐÃ THẤY CÁI GÌ. Bản đầu chỉ nói "không còn đúng
   * hình dạng" — chủ nhà biết là hỏng nhưng không biết hỏng ở đâu, phải
   * quay lại hỏi mới đi tiếp được. In luôn câu đang có trong CSDL.
   */
  it("thông báo lỗi in ra câu đang có trong CSDL", () => {
    const raise = M126.slice(M126.indexOf("không khớp hình dạng 095 hay 096"))
    expect(raise).toContain("Câu đang có trong CSDL:\\n%', v_stmt")
  })

  /**
   * ⚠ ĐẾM TRƯỚC KHI LẤY. Có hai bản nạp chồng thì `SELECT … INTO` vớ đại
   * một cái, vá xong bản kia vẫn cộng tiền theo đơn — và không dòng nào
   * báo.
   */
  it("RAISE nếu có nhiều hơn một bản compute_payroll_run", () => {
    expect(M126).toContain("IF v_n <> 1 THEN")
    expect(M126).toContain("WF2B_NO_PAYROLL_FN")
  })

  /**
   * ⚠ HAI HÌNH DẠNG HỢP LỆ PHẢI ĐƯỢC LẤY TỪ CHÍNH MIG 095 VÀ 096, không
   * phải từ trí nhớ. Chốt này cắt câu gán v_gross ra khỏi hai migration
   * đó, chuẩn hoá đúng như migration 126 làm, rồi đối chiếu. 095 hay 096
   * đổi một chữ là chốt đỏ NGAY — thay vì migration chạy rồi mới chết
   * trên máy chủ nhà.
   */
  it("hai hình dạng được chấp nhận khớp đúng mig 095 và mig 096", () => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
    const cut = (src: string, tenFile: string) => {
      const m = src.match(new RegExp("SELECT[^;]+INTO\\s+v_gross[^;]+;"))
      if (!m) throw new Error(`không tìm thấy câu gán v_gross trong ${tenFile}`)
      return norm(m[0])
    }
    // Ghép lại chuỗi bị tách bằng `||` trong migration.
    const literal = (ten: string) => {
      const m = M126.match(new RegExp(ten + "\\s*:=([\\s\\S]*?);\\n"))
      if (!m) throw new Error(`không tìm thấy ${ten} trong mig 126`)
      return (m[1].match(/'[^']*'/g) ?? []).map((p) => p.slice(1, -1)).join("")
    }

    expect(literal("v_shape_096"), "hình dạng 096 trong mig 126 đã lệch").toBe(
      cut(read("supabase/migrations/096_payroll_net_revenue_fixes.sql"), "mig 096")
    )
    expect(literal("v_shape_095"), "hình dạng 095 trong mig 126 đã lệch").toBe(
      cut(read("supabase/migrations/095_payroll_net_revenue.sql"), "mig 095")
    )
    // Hai hình dạng phải KHÁC nhau — nếu bằng nhau thì một trong hai chốt
    // trên đang so với chính nó và không kiểm gì cả.
    expect(literal("v_shape_095")).not.toBe(literal("v_shape_096"))
  })

  /**
   * ⚠ VÁ ĐƯỢC KHÔNG CÓ NGHĨA LÀ MỌI THỨ ỔN. Hàm ở hình dạng 095 nghĩa là
   * mig 096 chưa chạy trên CSDL đó, mà 096 còn sửa một lỗi tiền thật
   * (phiếu trả của đơn đã huỷ vẫn bị trừ vào doanh số nhân viên). 126
   * không sửa chỗ đó nên phải kêu to, không được nuốt.
   */
  it("gặp hình dạng 095 thì WARNING, không im lặng", () => {
    const nhanh = M126.slice(M126.indexOf("ELSIF v_norm = v_shape_095"))
    expect(nhanh.slice(0, 1200)).toContain("RAISE WARNING")
    expect(nhanh.slice(0, 1200)).toContain("mig 096 có vẻ CHƯA chạy")
  })

  it("thay bằng lời gọi helper, không viết lại truy vấn", () => {
    expect(M126).toContain(
      "v_gross := public._wf2b_gross_revenue_for(u.id, v_org, v_period_start, v_period_end);"
    )
  })

  /**
   * ⚠ HAI PHÉP ĐẾM ĐƠN THƯỞNG KHÔNG ĐỔI, có chủ ý: chúng hỏi "nhân viên
   * chốt được mấy đơn đủ lớn", không hỏi "thu về bao nhiêu tiền".
   * Chuyển sang hóa đơn là đơn giao hai chuyến hoá ra hai lần thưởng.
   */
  it("không đụng tới hai phép đếm đơn thưởng", () => {
    expect(M126).not.toContain("min_order_value")
    expect(M126).not.toContain("v_oc_count")
  })

  it("helper doanh số gộp bị REVOKE khỏi PUBLIC", () => {
    expect(M126).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\._wf2b_gross_revenue_for\(uuid, uuid, date, date\)\s+FROM PUBLIC/
    )
  })
})

// =====================================================================

describe("Bảng kê trên phiếu lương đi theo cùng một nguồn", () => {
  const PAGE = read("src/app/(dashboard)/hr/payroll/runs/page.tsx")
  const SLIP = read("src/components/printing/payslip.tsx")

  /**
   * ⚠ BẢNG KÊ VÀ CON SỐ TỔNG PHẢI CÙNG NGUỒN. Con số "Tổng doanh số"
   * trên phiếu lương do `compute_payroll_run` tính từ hóa đơn; bảng kê
   * ngay bên dưới nó mà cộng từ đơn thì hai số lệch nhau trên cùng một
   * tờ giấy, và người nhận lương không có cách nào biết bên nào đúng.
   */
  it("trang bảng lương hỏi sales_invoices, không hỏi sales_orders", () => {
    expect((PAGE.match(/\.from\("sales_invoices"\)/g) || []).length).toBe(2)
    expect(PAGE).not.toContain('.from("sales_orders")')
  })

  it("lọc theo ngày xuất, không theo ngày đặt", () => {
    expect((PAGE.match(/\.gte\("invoice_date", ps\)/g) || []).length).toBe(2)
    expect(PAGE).not.toContain('.gte("order_date", ps)')
  })

  it("bản in đổi sang kiểu hóa đơn, không còn kiểu đơn", () => {
    expect(SLIP).toContain("export interface PayslipInvoiceLine {")
    expect(SLIP).not.toContain("PayslipOrderLine")
    expect(SLIP).toContain("invoice_code: string")
  })

  /**
   * ⚠ NHÃN PHẢI ĐỔI THEO. Cột ghi "Mã đơn" mà bên dưới là `HD-…` thì
   * người đọc tưởng hệ thống ghi nhầm — và đó là tờ giấy họ mang về.
   */
  it("nhãn trên bản in nói đúng thứ đang hiện", () => {
    expect(SLIP).toContain("Số hoá đơn")
    expect(SLIP).toContain("Ngày xuất")
    expect(SLIP).not.toContain("Đơn hàng tính lương")
  })
})

// =====================================================================

describe("Nền nếp chung của migration", () => {
  it("dừng hẳn nếu 124 chưa chạy", () => {
    expect(M126).toContain(
      "'WF2B_NEEDS_124: chưa có bảng sales_invoices. Chạy migration 124 và 125 trước.'"
    )
  })

  it("kết thúc bằng reload schema", () => {
    expect(M126).toContain("NOTIFY pgrst, 'reload schema'")
  })

  /**
   * ⚠ ĐỐI CHIẾU HAI CON SỐ Ở CUỐI, thay vì tin là xong. Ngay sau backfill
   * của 124 thì mọi đơn đều xuất đủ đúng một lần, nên doanh thu theo đơn
   * và theo hóa đơn phải bằng nhau. Lệch là dấu hiệu backfill chưa khớp.
   */
  it("in ra và so hai cách tính doanh thu", () => {
    expect(M126).toContain("RAISE NOTICE '--- 126: doanh thu theo ĐƠN % · theo HÓA ĐƠN % ---'")
    expect(M126).toContain("IF v_ord <> v_inv THEN")
  })

  /**
   * ⚠ BỘ DÒ NÀY TỪNG BÁO ĐỘNG GIẢ, và chạy thật mới lòi ra. Bản đầu lọc
   * thêm `LIKE '%SUM(%total%'` rồi kết luận "còn N hàm cộng tiền từ
   * sales_orders" — nó réo tên `compute_payroll_run`, một hàm ĐÚNG: hai
   * chỗ còn `is_revenue_status` trong đó là hai phép ĐẾM ĐƠN thưởng, cố
   * ý giữ. Mẫu LIKE quét cả thân hàm nên bất cứ `SUM(` nào đứng trước
   * bất cứ chữ `total` nào cũng khớp.
   *
   * Một cảnh báo kêu oan tệ hơn không có cảnh báo: nó dạy người đọc bỏ
   * qua NOTICE. Nay nó liệt kê TÊN và tự nhận là gợi ý để soi mắt.
   */
  it("dò xem còn hàm nào nhắc cả hai, và nêu TÊN chứ không kết luận", () => {
    expect(M126).toContain("LIKE '%is_revenue_status%'")
    expect(M126).toContain("LIKE '%sales_orders%'")
    expect(M126).toContain("string_agg(proname, ', ' ORDER BY proname)")
    expect(M126, "mẫu lọc quá lỏng, khớp cả hàm chỉ đếm đơn").not.toContain(
      "LIKE '%SUM(%total%'"
    )
    expect(M126).toContain("hàm chỉ ĐẾM đơn là đúng")
  })

  /**
   * ⚠ `pg_get_functiondef` NÉM LỖI KHI GẶP MỘT AGGREGATE, và trình tối ưu
   * được phép gọi nó TRƯỚC khi lọc `nspname`. Viết cả hai điều kiện trong
   * cùng một WHERE thì câu này chết vì một hàm ở `pg_catalog` mà ta không
   * hề hỏi tới — đã gặp thật, migration dừng ở đúng khối này:
   *
   *     ERROR: "array_agg" is an aggregate function
   *
   * `AS MATERIALIZED` ép lọc xong mới gọi; `prokind = 'f'` là vế thứ hai
   * của cùng một lớp bảo vệ.
   */
  it("ép thứ tự trước khi gọi pg_get_functiondef", () => {
    expect(M126).toContain("WITH fns AS MATERIALIZED (")
    expect((M126.match(/prokind = 'f'/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(M126, "còn gọi pg_get_functiondef trong cùng WHERE với nspname").not.toMatch(
      new RegExp("nspname = 'public'\\s*\\n\\s*AND pg_get_functiondef")
    )
  })

  /**
   * ⚠ LẤY OID TRƯỚC, GỌI SAU — hai câu, không gộp. Cùng lý do.
   */
  it("thân compute_payroll_run lấy qua oid, không gộp một câu", () => {
    expect(M126).toContain("SELECT pr.oid INTO v_oid")
    expect(M126).toContain("v_src := pg_get_functiondef(v_oid);")
  })

  it("đổi ý nghĩa số liệu được báo ngay đầu tệp", () => {
    expect(RAW126).toContain("⚠ ĐỔI Ý NGHĨA SỐ LIỆU — ĐỌC KỸ")
  })
})
