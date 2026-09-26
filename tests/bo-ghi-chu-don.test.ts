import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/** ⚠ CHỦ NHÀ 26/09/2026: "Bỏ hết phần ghi chú đơn hàng, chỉ dùng ghi chú dòng". */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("bỏ ghi chú đơn hàng", () => {
  it("không màn nào còn ô nhập / khối hiện ghi chú đơn", () => {
    expect(doc("src/app/(dashboard)/sell/cart/page.tsx")).not.toContain('aria-label="Ghi chú đơn"')
    expect(doc("src/components/orders/order-drawer.tsx")).not.toContain("{order.notes && (")
    expect(doc("src/components/orders/mobile-order-detail.tsx")).not.toContain('label="Ghi chú"')
    expect(doc("src/app/(dashboard)/orders/[id]/page.tsx")).not.toContain("order.notes || <span")
    for (const f of [
      "src/components/sales-invoices/invoice-drawer.tsx",
      "src/app/(dashboard)/sales-invoices/[id]/page.tsx",
      "src/app/(dashboard)/sales-invoices/[id]/print/page.tsx",
      "src/app/(dashboard)/orders/[id]/print/page.tsx",
      "src/components/orders/invoice-editor.tsx",
    ]) expect(doc(f), f).not.toContain("Ghi chú đơn hàng")
  })
  it("ghi chú DÒNG vẫn còn ở các màn làm đơn", () => {
    expect(doc("src/components/pos/order-screen.tsx")).toContain('placeholder="Ghi chú dòng…"')
    expect(doc("src/components/pos/invoice-screen.tsx")).toContain('placeholder="Ghi chú dòng…"')
  })
})
