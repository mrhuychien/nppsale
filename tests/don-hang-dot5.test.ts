import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { tongSauSuaTaiCho } from "../src/lib/orders/inline-totals"
import { quenGioSuaDon, SELL_CART_STORAGE_KEY } from "../src/lib/sell/cart-storage"

/**
 * ĐỢT 5 QA — ĐƠN HÀNG (22/09/2026).
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16:
 *   · chủ NPP rút đơn của NVBH về nháp → 42501, LUÔN LUÔN (nháp là sổ tay
 *     riêng của người đứng tên, mig 119);
 *   · huỷ đơn bằng UPDATE thẳng → cancelled_by / lý do trống, phiếu trả
 *     nháp nằm lại `draft` mãi (complete_return báo ORDER_NOT_COMPLETED);
 *   · xoá nháp mà giỏ còn `editing.orderId` → bấm Lưu ra 42501 trên
 *     sales_order_lines, người dùng đọc là "không có quyền";
 *   · quản lý sửa dòng đơn vừa bị huỷ → dòng đổi, đầu đơn không đổi được
 *     (mig 172 chặn ở trigger: ORDER_CANCELLED).
 */

const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("tổng đơn khi sửa SL & đơn giá tại chỗ", () => {
  it("lưu lại mà không đổi gì thì tổng KHÔNG đổi (giữ khoản trừ hàng trả)", () => {
    // Đơn gốc: tạm tính 1.000.000, VAT 10% = 100.000, trừ hàng trả 200.000 → tổng 900.000
    const r = tongSauSuaTaiCho([{ line_total: 1_000_000, vat_rate: 0.1 }], 200_000)
    expect(r).toEqual({ subtotal: 1_000_000, vat: 100_000, total: 900_000 })
  })

  it("VAT tính lại theo số lượng mới, từng dòng theo thuế suất của nó", () => {
    const r = tongSauSuaTaiCho(
      [{ line_total: 2_000_000, vat_rate: 0.1 }, { line_total: 500_000, vat_rate: 0.08 }],
      0
    )
    expect(r.vat).toBe(240_000)
    expect(r.total).toBe(2_740_000)
  })

  it("không trừ chiết khấu thêm lần nữa (line_total đã là số sau chiết khấu)", () => {
    expect(tongSauSuaTaiCho([{ line_total: 900, vat_rate: 0 }], 0).total).toBe(900)
  })

  it("màn chi tiết đơn dùng đúng công thức ấy", () => {
    const s = doc("src/app/(dashboard)/orders/[id]/page.tsx")
    expect(s).toContain("tongSauSuaTaiCho(")
    expect(s).not.toContain("subtotal - Number(order.discount || 0) + Number(order.vat || 0)")
  })
})

describe("xoá đơn thì quên giỏ đang sửa đúng đơn ấy", () => {
  const kho = (v: unknown) => {
    const m = new Map<string, string>([[SELL_CART_STORAGE_KEY, JSON.stringify(v)]])
    return { m, s: { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) } }
  }

  it("giỏ đang sửa đúng đơn vừa xoá → dọn", () => {
    const { m, s } = kho({ editing: { orderId: "o1" }, cart: [1] })
    expect(quenGioSuaDon("o1", s)).toBe(true)
    expect(m.has(SELL_CART_STORAGE_KEY)).toBe(false)
  })

  it("giỏ đang sửa đơn khác, hoặc giỏ mới → để yên", () => {
    const a = kho({ editing: { orderId: "o2" } })
    expect(quenGioSuaDon("o1", a.s)).toBe(false)
    expect(a.m.has(SELL_CART_STORAGE_KEY)).toBe(true)
    const b = kho({ editing: null, cart: [1] })
    expect(quenGioSuaDon("o1", b.s)).toBe(false)
  })

  it("deleteOrder gọi dọn giỏ; màn Đơn tạm dọn cả trạng thái trong bộ nhớ", () => {
    expect(doc("src/lib/orders/delete.ts")).toContain("quenGioSuaDon(orderId)")
    expect(doc("src/app/(dashboard)/sell/drafts/page.tsx")).toContain("if (cart.editing?.orderId === o.id) cart.clear()")
  })
})

describe("màn chi tiết đơn: rút về nháp, huỷ đơn", () => {
  const s = doc("src/app/(dashboard)/orders/[id]/page.tsx")

  it("'Rút về nháp' chỉ hiện cho người đứng tên đơn", () => {
    expect(s).toContain('(t.value !== "draft" || order.sales_user_id === user.id)')
  })

  it("huỷ đơn đi qua cancel_order", () => {
    const i = s.indexOf("const handleChangeStatus")
    const fn = s.slice(i, s.indexOf("const handleDelete", i))
    expect(fn).toContain('rpc("cancel_order"')
    // Nhánh huỷ trả về trước lệnh UPDATE thẳng.
    expect(fn.indexOf('rpc("cancel_order"')).toBeLessThan(fn.indexOf('.update({ status: newStatus })'))
  })
})

/**
 * ⚠ BẢNG `users` KHÔNG CÓ CỘT `email`. Hai màn cấu hình theo từng người
 *   (Phân quyền, Lương) xin cột ấy → 42703 → luôn "Không tìm thấy user",
 *   từ 26/05, trên cả hai nhánh. Đã đo: `ERROR: column "email" does not
 *   exist`. Email nằm ở `auth.users`, trình duyệt không đọc được.
 */
describe("không màn nào xin cột users.email", async () => {
  const { readdirSync, statSync } = await import("node:fs")
  const tep: string[] = []
  const di = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = resolve(d, f)
      if (statSync(p).isDirectory()) di(p)
      else if (/\.(ts|tsx)$/.test(f)) tep.push(p)
    }
  }
  di(resolve(__dirname, "..", "src"))

  it("quét", () => {
    const sai: string[] = []
    for (const p of tep) {
      const s = readFileSync(p, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "")
      for (const m of Array.from(s.matchAll(/\.from\("users"\)\s*\.select\(\s*"([^"]*)"/g))) {
        if (/(^|[\s,])email([\s,]|$)/.test(m[1])) sai.push(`${p.split("/src/")[1]}: ${m[1]}`)
      }
    }
    expect(sai).toEqual([])
  })

  it("phép quét nhận ra mẫu sai", () => {
    const s = '.from("users")\n  .select("id, full_name, email, role")'
    const m = s.match(/\.from\("users"\)\s*\.select\(\s*"([^"]*)"/)!
    expect(/(^|[\s,])email([\s,]|$)/.test(m[1])).toBe(true)
  })
})
