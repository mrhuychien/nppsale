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
    expect(M126).toContain("IF position(v_old IN v_src) = 0 THEN")
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

  it("câu cần vá là đúng câu tính doanh số gộp của mig 096", () => {
    const MIG096 = read("supabase/migrations/096_payroll_net_revenue_fixes.sql")
    const needle = `SELECT COALESCE(SUM(total), 0) INTO v_gross
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND org_id = v_org
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;`
    // Nếu 096 đổi, chốt này đỏ TRƯỚC khi migration chạy và im lặng hỏng.
    expect(MIG096, "hình dạng câu trong mig 096 đã đổi").toContain(needle)
    expect(M126, "câu cần vá trong 126 không khớp mig 096").toContain(needle)
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

  it("dò xem còn hàm nào cộng tiền từ đơn theo is_revenue_status", () => {
    expect(M126).toContain("LIKE '%is_revenue_status%'")
    expect(M126).toContain("LIKE '%sales_orders%'")
  })

  it("đổi ý nghĩa số liệu được báo ngay đầu tệp", () => {
    expect(RAW126).toContain("⚠ ĐỔI Ý NGHĨA SỐ LIỆU — ĐỌC KỸ")
  })
})
