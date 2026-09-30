/**
 * Chủ nhà 30/09/2026: "làm migrate kho bán / kho date" — phiếu nhập kho chọn kho nhận, hàng vào đúng kho.
 * Máy chủ: supabase/migrations/219_nhap_kho_chon_kho_nhan.sql (kịch bản scripts/sql/thu-219-nhap-kho-chon-kho.sql).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { KHO_NHAN, nhanKhoNhan } from "@/lib/inventory/post-import"

const MIG = readFileSync("supabase/migrations/219_nhap_kho_chon_kho_nhan.sql", "utf8")
const TRANG = readFileSync("src/app/(dashboard)/inventory/stock-in/page.tsx", "utf8")
const DT = readFileSync("src/components/inventory/stock-in-mobile.tsx", "utf8")

describe("nhập kho chọn Kho bán / Kho date", () => {
  it("hai lựa chọn, nhãn đúng", () => {
    expect(KHO_NHAN.map((k) => k.v)).toEqual(["sale", "date"])
    expect(nhanKhoNhan("date")).toBe("Kho date")
    expect(nhanKhoNhan("sale")).toBe("Kho bán")
  })
  it("trang gửi kho nhận xuống RPC; máy tính + điện thoại đều có hai nút", () => {
    expect(TRANG).toContain("warehouse_zone: zone,")
    expect(TRANG).toContain('aria-label="Kho nhận"')
    expect(DT).toContain('data-testid={`nk-m-kho-${k.v}`}')
    expect(TRANG).not.toContain('useState("Kho chính")')
  })
  it("mig 219: ghi vùng kho vào phiếu và lô, kiểm giá trị, giữ quyền, idempotent", () => {
    expect(MIG).toContain("v_zone     text := COALESCE(NULLIF(trim(p->>'warehouse_zone'), ''), 'sale');")
    expect(MIG).toContain("IF v_zone NOT IN ('sale', 'date') THEN")
    expect(MIG).toMatch(/INSERT INTO stock_entries \([^)]*warehouse_zone\)/)
    expect(MIG).toMatch(/INSERT INTO batches \([^)]*warehouse_zone\)/)
    expect(MIG).toContain("CREATE OR REPLACE FUNCTION public.post_stock_import(p jsonb)")
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.post_stock_import(jsonb) FROM PUBLIC, anon;")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(readFileSync("scripts/sql/kham-so-that.sql", "utf8")).toContain("Mig 219")
  })
})
