import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * DOANH SỐ THUẦN = HÀNG ĐI − HÀNG TRẢ — mig 192.
 *
 * ⚠ CHỦ NHÀ 25/09/2026 (khách "Chị huyền 25"): "check lại màn này Doanh thu lệch công
 *   nợ. Danh sách Hoá đơn bán HD 0403 thực chất số tiền còn 2988500 (sau khi trừ hàng
 *   trả). Rà soát lại toàn bộ doanh số tính bằng số đi - số trả."
 *   HD-0403 4.640.500, hàng trả tự sinh 1.652.000 đang Chờ xử lý → công nợ 2.988.500,
 *   doanh thu vẫn 4.640.500. Bản cũ chỉ đọc phiếu 'completed' theo `credited_at`.
 *
 * SQL đã chạy thật trên Postgres 16 (4 khối: tự sinh Chờ xử lý trừ theo ngày HĐ, doanh
 * thu = công nợ; nhập kho / huỷ nhập kho giữ ngày trừ, giá vốn hàng trả theo nhập kho;
 * tự lập nháp không trừ → hoàn thành trừ → huỷ trả lại; đổi ngày / huỷ HĐ kéo phiếu theo).
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/192_doanh_so_thuan_tru_hang_tra.sql")
const khong = (s: string) => s.replace(/--[^\n]*/g, "")

describe("mig 192 — một luật trừ doanh số, khớp công nợ", () => {
  it("VÌ SAO trích lời chủ nhà; kết thúc NOTIFY + SELECT", () => {
    expect(MIG).toContain("Rà soát lại toàn bộ doanh số")
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema';\s*\n\s*SELECT 'Doanh số thuần/)
  })

  it("tự sinh (Chờ xử lý / Đã nhập kho) trừ vào NGÀY HÓA ĐƠN — đúng lúc công nợ bị trừ", () => {
    const i = MIG.indexOf("FUNCTION public._ngay_tru_doanh_so()")
    const body = khong(MIG.slice(i, MIG.indexOf("$trg$;", i)))
    expect(body).toMatch(/credit_with_invoice, false\) AND NEW\.status IN \('submitted', 'completed'\)/)
    expect(body).toContain("SELECT si.invoice_date INTO v_ngay")
    expect(body).toMatch(/ELSIF NEW\.status IN \('approved', 'completed'\) THEN\s*NEW\.revenue_date := COALESCE\(\s*\(NEW\.credited_at AT TIME ZONE 'Asia\/Ho_Chi_Minh'\)::date/)
    expect(body).toContain("NEW.revenue_date := NULL")
  })

  it("trigger chạy SAU trigger chốt credited_at (thứ tự tên) và bám cả đổi ngày / huỷ HĐ", () => {
    expect("trg_zz_returns_revenue_date" > "trg_returns_credited_at").toBe(true)
    expect(MIG).toContain("CREATE TRIGGER trg_zz_returns_revenue_date")
    expect(MIG).toContain("AFTER UPDATE OF invoice_date, status ON public.sales_invoices")
    expect(MIG).toContain("UPDATE public.returns SET revenue_date = revenue_date;")
  })

  it("hàm nội bộ thu quyền (luật mig 166)", () => {
    for (const fn of ["_ngay_tru_doanh_so()", "_hoa_don_doi_ngay_tru_hang_tra()"]) {
      expect(MIG).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
    }
  })

  it("dashboard / top khách / kênh / P&L / lương cùng trừ theo revenue_date", () => {
    for (const fn of ["dashboard_summary", "dashboard_channel_revenue", "dashboard_top_customers", "finance_pnl", "payroll_returns_for"]) {
      const i = MIG.indexOf(`FUNCTION public.${fn}(`)
      expect(i, fn).toBeGreaterThan(0)
      const j = MIG.indexOf("GRANT EXECUTE", i)
      expect(khong(MIG.slice(i, j)), fn).toContain("revenue_date")
    }
  })

  it("P&L: doanh thu thuần + giá vốn thuần (trừ giá vốn hàng trả đã nhập lại kho)", () => {
    const i = MIG.indexOf("CREATE FUNCTION public.finance_pnl")
    const body = khong(MIG.slice(i, MIG.indexOf("$fn$;", i)))
    expect(body).toContain("rev.revenue - tra.value")
    expect(body).toContain("cogs.cogs - tra_von.cogs")
    expect(body).toContain("e.notes = 'Nhập lại từ phiếu trả ' || r.id::text AND r.status = 'completed'")
  })

  it("công nợ mở trên dashboard không kẹp từng dòng về 0 (luật mig 186)", () => {
    const i = MIG.indexOf("FUNCTION public.dashboard_summary")
    const body = khong(MIG.slice(i, MIG.indexOf("$$;", i)))
    expect(body).toContain("SUM(COALESCE(amount, 0) - COALESCE(paid, 0))")
    expect(body).not.toContain("GREATEST(0, COALESCE(amount")
  })

  it("lương: NV của phiếu trả trước (mig 160), rồi NV hóa đơn", () => {
    const i = MIG.indexOf("FUNCTION public.payroll_returns_for")
    const body = khong(MIG.slice(i, MIG.indexOf("$$;", i)))
    expect(body).toMatch(/COALESCE\(\s*r\.sales_user_id,\s*si\.sales_user_id,\s*o\.sales_user_id/)
  })
})

describe("helper TS dùng chung", () => {
  const S = read("src/lib/analytics/sales.ts")
  it("fetchReturnsRowsDu / fetchReturnsValueDu đọc theo revenue_date, lùi về cách cũ khi thiếu cột", () => {
    expect(S).toContain('export const RETURN_REVENUE_DATE_COL = "revenue_date"')
    expect(S.match(/\.gte\(RETURN_REVENUE_DATE_COL, range\.from\)/g)?.length).toBe(2)
    expect(S).toContain("created_at: r.revenue_date || r.credited_at || r.created_at")
  })
  it("dòng hàng trả bỏ hàng ĐỔI (khớp credit_note_amount)", () => {
    const i = S.indexOf("export async function fetchReturnLines")
    expect(S.slice(i, i + 900)).toContain('.eq("is_exchange", false)')
  })
  it("giá vốn hàng trả đọc đúng phiếu nhập của complete_return, theo đơn vị cơ sở", () => {
    const i = S.indexOf("export async function fetchReturnCosts")
    const body = S.slice(i, S.indexOf("\n}\n", i))
    expect(body).toContain("`Nhập lại từ phiếu trả ${id}`")
    expect(body).toContain('.eq("type", "import")')
    expect(body).toContain("qty_in_base_uom")
  })
})

describe("hai màn chủ nhà chụp", () => {
  it("chi tiết khách: Doanh thu tháng này = hóa đơn − hàng trả; tiền HĐ là số còn lại", () => {
    const P = read("src/app/(dashboard)/customers/[id]/page.tsx")
    expect(P).toContain("setMonthRevenue(sumTotal(monthOrdersRes.data as Array<{ total: number }>) - traThang)")
    expect(P).toContain("setLastMonthRevenue(sumTotal(prevMonthOrdersRes.data as Array<{ total: number }>) - traThangTruoc)")
    expect(P).toContain("formatCurrency(v.total - (traHD.get(v.id) ?? 0))")
    // Đọc hỏng thì nói ra, không im lặng về 0.
    expect(P).toContain("Hàng trả (chưa trừ vào doanh thu)")
  })

  it("danh sách hóa đơn bán: cột tiền + tổng là số còn lại sau hàng trả", () => {
    const P = read("src/app/(dashboard)/sales-invoices/page.tsx")
    expect(P).toContain("tong_hoa_don: r.total, tra_hang: t, total: Number(r.total || 0) - t")
    expect(P).toContain("(Number(r.total) || 0) - (tra.get(r.id) ?? 0)")
    expect(P).toContain('label="Tổng tiền (đã trừ hàng trả)"')
  })

  it("traTheoHoaDon dùng đúng luật công nợ (creditOnInvoice)", () => {
    const N = read("src/lib/analytics/net-revenue.ts")
    expect(N).toContain("const c = creditOnInvoice(ds)")
    expect(N).toContain('.select("invoice_id, status, credit_with_invoice, credit_note_amount")')
  })

  it("P&L hiện đủ ba dòng: doanh thu hóa đơn, trừ hàng trả, doanh thu thuần", () => {
    const P = read("src/app/(dashboard)/reports/finance/pnl/page.tsx")
    expect(P).toContain("Trừ: Hàng trả")
    expect(P).toContain("formatCurrency(data.revenueGross)")
    const F = read("src/lib/finance.ts")
    expect(F).toContain('const revenueGross = r["revenue_gross"] == null ? revenue : num("revenue_gross")')
  })
})

describe("script khám", () => {
  it("kham-so-that có dòng mig 192", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 32, 'Mig 192")
  })
})
