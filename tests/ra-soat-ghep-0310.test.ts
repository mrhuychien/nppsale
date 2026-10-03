import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Hai chỗ nối sau đợt rà danh sách 03/10/2026:
 * - Danh sách Trả hàng (điện thoại) truyền số đầu nhóm ngày đếm trên máy chủ, như Đơn hàng / Hóa đơn.
 * - POS không còn nuốt lỗi đọc lô (`.catch(() => ({}))` = mọi dòng "không có lô" mà không ai biết).
 */
const doc = (p: string) => readFileSync(join(__dirname, "..", p), "utf-8")

describe("rà soát 03/10/2026 — phần ghép", () => {
  it("Trả hàng: đầu nhóm ngày đọc trên máy chủ cùng bộ lọc và truyền xuống màn điện thoại", () => {
    const s = doc("src/app/(dashboard)/returns/page.tsx")
    expect(s).toMatch(/docThongKeNgay</)
    expect(s).toMatch(/apDungLoc\(\s*supabase\s*\.from\("returns"\)\s*\.select\("id, return_date, credit_note_amount"/)
    expect(s).toMatch(/\.in\("return_date", days\)/)
    expect(s).toMatch(/dayStats=\{dayStats\}/)
  })

  it("POS đơn hàng / trả hàng: lỗi đọc lô phải được báo, không nuốt", () => {
    for (const p of ["src/components/pos/order-screen.tsx", "src/components/pos/return-screen.tsx"]) {
      const s = doc(p)
      expect(s, p).not.toMatch(/loadLotsByProduct\([^)]*\)\.catch\(\(\) => \(\{\}\)\)/)
      expect(s, p).toMatch(/Không tải được danh sách lô/)
    }
  })
})
