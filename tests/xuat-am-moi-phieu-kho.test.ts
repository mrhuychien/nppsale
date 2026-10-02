/**
 * Chủ nhà 02/10/2026: "Khi bật cho phép xuất tồn âm thì các phiếu xuất, trả ... liên quan đến kho cho phép âm hết,
 * hiện tại xuất trả NCC ko cho phép xuất tồn âm". Kịch bản SQL thật: scripts/sql/thu-222-xuat-am.sql (5/5).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const MIG = readFileSync("supabase/migrations/222_xuat_am_moi_phieu_kho.sql", "utf8")
const fn = (ten: string) => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${ten}(`)
  expect(i, ten).toBeGreaterThan(0)
  return MIG.slice(i, MIG.indexOf("$fn$;", i))
}

describe("mig 222 — cờ cho bán vượt tồn áp cho mọi phiếu xuất kho", () => {
  it("trả NCC: đọc cờ; bật thì ghi phần thiếu lên phiếu (không lô), tắt thì vẫn báo INSUFFICIENT_STOCK", () => {
    const f = fn("complete_supplier_return")
    expect(f).toContain("SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org")
    expect(f).toMatch(/IF v_need > 0 AND v_cho_am THEN[\s\S]*?INSERT INTO stock_entry_lines[\s\S]*?v_entry_id, r\.product_id, NULL/)
    expect(f).toContain("'INSUFFICIENT_STOCK | % (%): cần %, kho % còn %, kho % còn %'")
  })
  it("phiếu xuất kho lẻ: cả lượt kiểm trước lẫn chốt chặn sau đều theo cờ", () => {
    const f = fn("post_stock_issue")
    expect(f).toContain("IF v_avail < r.need AND NOT v_cho_am THEN")
    expect(f).toContain("IF v_need > 0 AND NOT v_cho_am THEN")
  })
  it("huỷ trả NCC: dòng không lô (phần thiếu) không chặn huỷ, không cộng khống", () => {
    const f = fn("cancel_supplier_return")
    expect(f).toMatch(/AND sel\.batch_id IS NOT NULL\s*\n\s*AND \(b\.id IS NULL OR COALESCE\(b\.status, 'available'\) <> 'available'\)/)
  })
  it("chuyển kho không đổi; quy ước migration", () => {
    expect(MIG).not.toContain("FUNCTION public.post_stock_transfer(")
    expect(MIG).toContain("VÌ SAO")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIG).not.toMatch(/AS \$\$/)
  })
  it("màn phiếu xuất kho nói đúng khi đơn vị cho bán vượt tồn", () => {
    const s = readFileSync("src/app/(dashboard)/inventory/stock-issue/page.tsx", "utf8")
    expect(s).toContain("const choAm = org?.allow_oversell === true")
    expect(s).toContain("vẫn ghi sổ được, kho sẽ thiếu")
  })
})
