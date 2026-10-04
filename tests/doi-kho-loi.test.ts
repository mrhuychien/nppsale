/**
 * ĐỘI TEST "KHO & MUA HÀNG" — LỖI ĐÃ XÁC MINH (đang ĐỎ; sửa xong phải XANH).
 *   npx vitest run tests/doi-kho-loi.test.ts
 *
 * Mig 166 vá "cổng vai" vào 8 RPC kho / mua hàng (SECURITY DEFINER bỏ qua RLS nên phải tự kiểm vai — CLAUDE.md §3,
 * "Tồn kho, trạng thái chứng từ chỉ đổi qua RPC"). Mig 166 vá BẰNG CÁCH SỬA THÂN HÀM ĐANG CÓ lúc chạy, nên bất kỳ
 * migration nào SAU 166 viết lại một trong 8 hàm ấy phải tự mang cổng vai — nếu không, cổng biến mất.
 * Mig 222 (xuất âm mọi phiếu kho) chép lại post_stock_issue / complete_supplier_return / cancel_supplier_return từ bản
 * cũ (144/146/147) và làm rơi cổng. Chạy thật: scripts/sql/doi-test/kho-loi.sql (NVBH ghi sổ được phiếu xuất kho,
 * gửi / huỷ phiếu trả NCC).
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

const DIR = path.join(__dirname, "..", "supabase", "migrations")
const TEP = fs.readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()

/** Thân hàm `public.<fn>` ở lần định nghĩa CUỐI CÙNG trong các migration, kèm số migration. */
function dinhNghiaCuoi(fn: string): { so: number; tep: string; than: string } | null {
  let out: { so: number; tep: string; than: string } | null = null
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "i")
  for (const f of TEP) {
    const sql = fs.readFileSync(path.join(DIR, f), "utf8")
    const m = re.exec(sql)
    if (!m) continue
    const sau = sql.slice(m.index)
    const the = /AS\s+(\$[a-zA-Z_]*\$)/.exec(sau)
    if (!the) continue
    const dau = sau.indexOf(the[1]) + the[1].length
    const cuoi = sau.indexOf(the[1], dau)
    out = { so: Number(f.slice(0, 3)), tep: f, than: sau.slice(0, cuoi > 0 ? cuoi : undefined) }
  }
  return out
}

const CONG_166: Array<[string, string[]]> = [
  ["cancel_stock_entry", ["owner", "warehouse"]],
  ["post_stock_export", ["owner", "warehouse"]],
  ["post_stock_issue", ["owner", "warehouse"]],
  ["post_stock_transfer", ["owner", "warehouse"]],
  ["complete_purchase_invoice", ["owner", "manager", "accountant", "warehouse"]],
  ["cancel_purchase_invoice", ["owner", "manager", "accountant", "warehouse"]],
  ["complete_supplier_return", ["owner", "manager", "accountant", "warehouse"]],
  ["cancel_supplier_return", ["owner", "manager", "accountant", "warehouse"]],
]

describe("RPC kho / mua hàng viết lại SAU mig 166 phải tự mang cổng vai", () => {
  for (const [fn, vai] of CONG_166) {
    it(`${fn}: bản cuối cùng vẫn kiểm vai (${vai.join(", ")})`, () => {
      const d = dinhNghiaCuoi(fn)
      expect(d, `không tìm thấy định nghĩa ${fn}`).not.toBeNull()
      if (d!.so <= 166) return // 166 tự vá thân hàm đang có
      const m = /user_role\(\)\s*,\s*''\s*\)\s*NOT\s+IN\s*\(([^)]*)\)|user_role\(\)[^;]*?NOT\s+IN\s*\(([^)]*)\)/i.exec(d!.than)
      expect(m, `${fn} viết lại ở ${d!.tep} mà không kiểm vai`).not.toBeNull()
      const coVai = (m![1] ?? m![2]).split(",").map((s) => s.replace(/['\s]/g, "")).filter(Boolean).sort()
      expect(coVai).toEqual([...vai].sort())
    })
  }
})
