/** Chủ nhà 28/09/2026 chốt năm điểm sau quét luồng (mig 215). */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { hasPermission, hasFeaturePermission } from "@/lib/permissions"

const m = readFileSync("supabase/migrations/215_diem_chot_don_dong_phieu_thu_trung_quyen.sql", "utf8")

describe("mig 215", () => {
  it("sửa HĐ của đơn đã đóng: post_invoice nhận khi lập lại; trả lại dấu đóng", () => {
    expect(m).toContain("AND NOT (o.status = ''closed'' AND p->>''reissue_of'' IS NOT NULL)")
    expect(m).toContain("PERFORM public._nho_don_dong_lap_lai(p_invoice_id);")
    expect(m).toContain("PERFORM public._tra_don_dong_lap_lai();")
  })
  it("phiếu thu: khoá chống gửi trùng duy nhất theo NPP, gặp lại thì trả phiếu cũ", () => {
    expect(m).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_receipts_client_key\s+ON public\.cash_receipts\(org_id, client_key\)/)
    expect(m).toContain("IF v_receipt IS NOT NULL THEN RETURN v_receipt; END IF;")
    for (const f of ["src/app/(dashboard)/finance/cash-receipts/new/page.tsx", "src/app/(dashboard)/receivables/[id]/page.tsx", "src/app/(dashboard)/receivables/collect/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("client_key: khoaGui.lay(),")
    }
    expect(readFileSync("src/lib/finance/cash-receipt.ts", "utf8")).toContain("...(input.client_key ? { client_key: input.client_key } : {}),")
  })
  it("quyền: quản lý lập / huỷ phiếu thu; thủ kho nhập kho phiếu trả; công nợ NCC giữ nguyên", () => {
    expect(hasPermission("manager", "receivables", "create")).toBe(true)
    expect(hasPermission("manager", "receivables", "update")).toBe(true)
    expect(hasPermission("warehouse", "returns", "approve")).toBe(true)
    expect(hasFeaturePermission("manager", "payables", "receivables", "create")).toBe(false)
    expect(hasFeaturePermission("manager", "payables", "receivables", "read")).toBe(true)
    expect(m).toContain("('warehouse', 'returns', 'approve')")
  })
})
