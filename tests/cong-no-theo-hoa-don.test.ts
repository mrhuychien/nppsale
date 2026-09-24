import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { tachPhaiTra, posTotals } from "../src/lib/pos/totals"
import { gopCongNoCuaDon, gopCongNoTheoDon } from "../src/lib/orders/receivable-sum"

const read = (p: string) => readFileSync(p, "utf8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/^\s*--.*$/gm, "")

/** ⚠ CHỦ NHÀ 24/09/2026: "phải ghi cả công nợ âm (tiền hàng trả nhiều hơn tiền hàng xuất)". */
describe("công nợ âm khi hàng trả > hàng xuất", () => {
  const M = read("supabase/migrations/186_cong_no_am.sql")
  const FN = code(M.slice(M.indexOf("CREATE OR REPLACE FUNCTION public._wf2b_recompute_receivable"), M.indexOf("$fn$;")))

  it("hàm tính công nợ theo hóa đơn KHÔNG kẹp về 0", () => {
    expect(FN).toContain("v_net := COALESCE(v.total, 0) - v_credits;")
    expect(FN).not.toMatch(/GREATEST\(0/)
  })

  it("trigger đặt trạng thái dòng âm ở mọi đường ghi: còn dư có → open, hết → paid", () => {
    expect(M).toContain("NEW.status := CASE WHEN COALESCE(NEW.paid, 0) <= NEW.amount THEN 'paid' ELSE 'open' END;")
    expect(M).toContain("IF NEW.amount < 0 THEN")
    expect(M).toMatch(/CREATE TRIGGER trg_cong_no_am_trang_thai\s+BEFORE INSERT OR UPDATE ON public\.receivables/)
    expect(M).toContain("DROP TRIGGER IF EXISTS trg_cong_no_am_trang_thai")
  })

  it("tính lại hóa đơn cũ đang bị kẹp; migration khép bằng NOTIFY + SELECT", () => {
    expect(M).toMatch(/rc\.amount = 0[\s\S]*PERFORM public\._wf2b_recompute_receivable\(r\.id\)/)
    expect(M).toContain("NOTIFY pgrst, 'reload schema';")
    expect(read("scripts/sql/kham-so-that.sql")).toContain("Mig 186")
  })

  it("POS: 'Khách cần trả' kẹp 0, phần vượt thành 'Ghi có cho khách'", () => {
    expect(tachPhaiTra(-50_000)).toEqual({ due: 0, credit: 50_000 })
    expect(tachPhaiTra(30_000)).toEqual({ due: 30_000, credit: 0 })
    const t = posTotals({ lines: [{ qty: 1, price: 100_000, vatRate: 0, discount: { value: 0, unit: "vnd" } }], returnCredit: 150_000 })
    expect(t).toMatchObject({ due: 0, credit: 50_000 })
    for (const f of ["src/components/pos/order-screen.tsx", "src/components/pos/invoice-screen.tsx"])
      expect(read(f)).toContain('label="Ghi có cho khách (công nợ âm)"')
  })

  it("nợ của khách cộng CẢ dòng âm (không kẹp từng dòng về 0)", () => {
    const L = code(read("src/lib/pos/load.ts"))
    const i = L.indexOf("export async function loadCustomerDebt")
    const body = L.slice(i, L.indexOf("export async function loadSupplierDebt"))
    expect(body).not.toContain("Math.max(0")
    expect(code(read("src/app/(dashboard)/customers/page.tsx"))).toContain("if (remaining === 0) continue")
    // Dòng âm là dư có, không phải khoản để thu.
    expect(read("src/app/(dashboard)/receivables/collect/page.tsx")).toContain(".filter((r) => r.amount - (r.paid || 0) > 0)")
  })
})

/** ⚠ CHỦ NHÀ 24/09/2026: "công nợ đang tính theo đơn hàng, phải tính theo Hoá đơn mới đúng". */
describe("công nợ tính theo HÓA ĐƠN, không theo đơn", () => {
  it("sổ chi tiết công nợ: bên Nợ từ phiếu công nợ theo hóa đơn, không từ sales_orders", () => {
    const S = code(read("src/app/(dashboard)/receivables/aging/page.tsx"))
    expect(S).not.toContain('.from("sales_orders")')
    expect(S).toContain("invoice:sales_invoices(invoice_code, invoice_date)")
    expect(S).toContain("debit: Math.max(0, so)")
    expect(S).toContain("credit: Math.max(0, -so)")
  })

  it("đơn nhiều hóa đơn: gộp mọi phiếu, trạng thái theo chỗ xấu nhất", () => {
    const g = gopCongNoCuaDon([
      { amount: 100, paid: 100, status: "paid", due_date: "2026-10-01" },
      { amount: 50, paid: 0, status: "open", due_date: "2026-09-30" },
    ])
    expect(g).toEqual({ amount: 150, paid: 100, status: "partial", due_date: "2026-09-30" })
    expect(gopCongNoCuaDon([])).toBeNull()
    const m = gopCongNoTheoDon([
      { order_id: "o1", amount: 10, paid: 0, status: "open", due_date: null },
      { order_id: "o1", amount: 20, paid: 0, status: "open", due_date: null },
      { order_id: null, amount: 99, paid: 0, status: "open", due_date: null },
    ])
    expect(Object.keys(m)).toEqual(["o1"])
    expect(m.o1.amount).toBe(30)
    expect(code(read("src/app/(dashboard)/orders/page.tsx"))).toContain("gopCongNoTheoDon(")
  })

  it("chi tiết đơn: 'Công nợ / hạn mức' là tổng nợ KHÁCH, không phải nợ riêng đơn", () => {
    const S = code(read("src/app/(dashboard)/orders/[id]/page.tsx"))
    expect(S).toContain("loadCustomerDebt(supabase, khachId)")
    expect(S).toContain("const customerDebt = noKhach ?? 0")
  })

  it("/sell: cảnh báo vượt hạn mức tính cả nợ sẵn có", () => {
    expect(code(read("src/app/(dashboard)/sell/cart/page.tsx"))).toContain(
      "Math.max(0, (debt ?? 0) + cart.totals.grandTotal - Number(customer.credit_limit))"
    )
  })

  it("quyết toán chuyến (luồng cũ) không còn ghi công nợ theo đơn", () => {
    const S = code(read("src/app/(dashboard)/deliveries/[id]/settle/page.tsx"))
    const i = S.indexOf("const finalize = async")
    const khoa = S.indexOf("if (LEGACY_FLOW_WRITES_LOCKED)", i)
    expect(khoa).toBeGreaterThan(i)
    expect(khoa).toBeLessThan(S.indexOf("ensureReceivableForOrder(", i))
  })

  it("chi tiết công nợ ghi mã HÓA ĐƠN, dẫn tới hóa đơn", () => {
    const S = read("src/app/(dashboard)/receivables/[id]/page.tsx")
    expect(S).toContain("invoice:sales_invoices(id, invoice_code, invoice_date)")
    expect(S).toContain("href={`/sales-invoices/${receivable.invoice_id}`}")
  })
})
