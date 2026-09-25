import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { savePosReturn, dongTraGuiLen, thieuHamLuuTra } from "../src/lib/pos/save"
import { explainReturnError } from "../src/lib/returns/complete-return"
import type { PosLine } from "../src/lib/pos/types"

const read = (p: string) => readFileSync(p, "utf8")
const sql = (s: string) => s.replace(/^\s*--.*$/gm, "")

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "rà soát lại xem có nghiệp vụ gì thực hiện trên pos mà
 *   ko giống nghiệp vụ hiện tại ko ?". Đo trên Postgres thật:
 *   · POS "Ghi nhận & nhập kho" luôn hỏng (RETURN_NOT_SUBMITTED) và mỗi lần bấm
 *     lại đẻ thêm phiếu nháp;
 *   · sửa phiếu đã nhập kho không đảo kho / công nợ;
 *   · huỷ phiếu trả đi cùng hóa đơn đang chờ → công nợ vẫn trừ.
 */
describe("mig 190 — save_pos_return + cancel_return tính lại công nợ", () => {
  const M = sql(read("supabase/migrations/190_luu_phieu_tra_pos.sql"))
  it("ghi nhận: đẩy 'submitted' rồi mới complete_return, trong cùng hàm", () => {
    expect(M).toMatch(/UPDATE returns SET status = 'submitted' WHERE id = v_id AND status = 'draft';\s*PERFORM public\.complete_return\(v_id, v_zone\);/)
  })
  it("sửa phiếu đã nhập kho: đảo bằng cancel_return, đánh dấu phiếu nhập cũ, về nháp", () => {
    expect(M).toContain("PERFORM public.cancel_return(v_id, 'Sửa phiếu trả trên POS — ghi nhận lại');")
    expect(M).toContain("AND notes = 'Nhập lại từ phiếu trả ' || v_id::text;")
    expect(M).toMatch(/SET status = 'draft', cancelled_at = NULL, cancel_reason = NULL/)
    expect(M).toContain("RETURN_COMPLETED:")
    expect(M).toContain("RETURN_LOCKED:")
  })
  it("quyền như RLS của returns; line_total tính ở máy chủ", () => {
    expect(M).toContain("v_role NOT IN ('owner', 'manager', 'sales')")
    expect(M).toContain("IF v_role = 'sales' AND (r.status <> 'draft' OR r.sales_user_id IS DISTINCT FROM auth.uid())")
    expect(M).toMatch(/round\(\(l->>'quantity'\)::numeric \* COALESCE\(\(l->>'unit_price'\)::numeric, 0\)\s*\* \(1 \+ COALESCE\(\(l->>'vat_rate'\)::numeric, 0\)\)\)/)
    expect(M).toContain("GRANT EXECUTE ON FUNCTION public.save_pos_return(jsonb) TO authenticated;")
  })
  it("cancel_return nhánh chờ tính lại công nợ hóa đơn; chữa sổ; khám sổ", () => {
    expect(M).toContain("PERFORM public._wf2b_recompute_receivable(r.invoice_id);")
    expect(M).toContain("WHERE ret.status = 'cancelled' AND ret.credit_with_invoice AND si.status = 'posted'")
    expect(M).toContain("NOTIFY pgrst, 'reload schema';")
    expect(read("scripts/sql/kham-so-that.sql")).toContain("Mig 190")
  })
})

const dong = (p: Partial<PosLine>): PosLine => ({
  key: "k", productId: "p1", sku: "", name: "Sữa", unit: "hộp", units: [],
  qty: 2, price: 10_000, discount: { value: 0, unit: "vnd" }, ...p,
})
const phieu = {
  returnId: null, orgId: "o", userId: "u", customerId: "c", reason: "damaged", notes: "",
  lines: [dong({}), dong({ productId: "", qty: 1 })], complete: true, zone: "sale" as const,
}
function sbGia(rpc: { data: unknown; error: { code?: string; message?: string } | null }) {
  const from = vi.fn(() => { throw new Error("không được ghi thẳng bảng") })
  const rpcFn = vi.fn(async () => rpc)
  return { sb: { from, rpc: rpcFn }, from, rpcFn }
}

describe("savePosReturn đi qua save_pos_return", () => {
  it("gọi RPC một lần, không ghi thẳng bảng; bỏ dòng trống; trả id của máy chủ", async () => {
    const { sb, from, rpcFn } = sbGia({ data: "r9", error: null })
    await expect(savePosReturn(sb as never, phieu)).resolves.toEqual({ returnId: "r9" })
    expect(from).not.toHaveBeenCalled()
    const [ten, arg] = rpcFn.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }]
    expect(ten).toBe("save_pos_return")
    expect(arg.p).toMatchObject({ customer_id: "c", complete: true, zone: "sale", return_id: null })
    expect(arg.p.lines).toEqual([dongTraGuiLen(dong({}))])
  })
  it("lỗi của máy chủ nói ra, không lặng lẽ đi đường cũ", async () => {
    const { sb, from } = sbGia({ data: null, error: { code: "P0001", message: "RETURN_LOCKED: phiếu trả đã huỷ — không sửa được" } })
    await expect(savePosReturn(sb as never, phieu)).rejects.toThrow("phiếu trả đã huỷ — không sửa được")
    expect(from).not.toHaveBeenCalled()
  })
  it("chỉ thiếu hàm (chưa chạy mig 190) mới đi đường cũ", () => {
    expect(thieuHamLuuTra({ code: "PGRST202", message: "Could not find the function public.save_pos_return(p)" })).toBe(true)
    expect(thieuHamLuuTra({ code: "PGRST202", message: "Could not find the function public.khac(p)" })).toBe(false)
    expect(thieuHamLuuTra({ code: "P0001", message: "save_pos_return" })).toBe(false)
  })
  it("dòng gửi lên không mang line_total / return_id — máy chủ tự tính", () => {
    const d = dongTraGuiLen(dong({ isExchange: true, reason: "damaged" }))
    expect(d).not.toHaveProperty("line_total")
    expect(d).not.toHaveProperty("return_id")
    expect(d).toMatchObject({ product_id: "p1", unit_name: "hộp", quantity: 2, unit_price: 10_000, is_exchange: true })
    expect(d).not.toHaveProperty("reason")
  })
  it("mã lỗi mới có câu tiếng Việt", () => {
    expect(explainReturnError("RETURN_COMPLETED: phiếu đã nhập kho — sửa xong phải bấm Ghi nhận")).toBe("phiếu đã nhập kho — sửa xong phải bấm Ghi nhận")
    expect(explainReturnError("CUSTOMER_NOT_FOUND: x")).toBe("Không tìm thấy khách hàng.")
  })
})

describe("màn POS", () => {
  it("phiếu trả đã huỷ: chỉ xem, khoá nút Ghi nhận", () => {
    const S = read("src/components/pos/return-screen.tsx")
    expect(S).toContain('setDaHuy(r.status === "cancelled")')
    expect(S).toMatch(/disabled=\{dangLuu \|\| daHuy \|\|/)
  })
  it("sửa đơn ở POS giữ lý do vượt hạn mức (không truyền chuỗi rỗng)", () => {
    const S = read("src/components/pos/order-screen.tsx")
    expect(S).toContain('reason: asDraft ? "" : lyDoCanh,')
    expect(S).not.toMatch(/status: asDraft \? "draft" : "submitted",\s*reason: "",/)
  })
})
