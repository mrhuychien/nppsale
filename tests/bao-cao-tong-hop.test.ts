import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { canSeeHref, duocVaoTrang, NAV_PERMISSION, CUA_VAO } from "../src/lib/nav/nav-permission"
import { BAO_CAO_TONG_HOP } from "../src/lib/nav/bao-cao-tong-hop"
import type { Role } from "../src/lib/permissions"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Đồng ý 6 màn … Tạm thời dựng Menu mới bên cạnh các báo cáo cũ. Menu
 *   Báo cáo tổng hợp". Spec: thietke/bao-cao-tong-hop-spec.md.
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("menu Báo cáo tổng hợp", () => {
  it("đúng 6 màn, đúng thứ tự, mỗi màn có trang + khai quyền + mục menu", () => {
    expect(BAO_CAO_TONG_HOP.map((m) => m.label)).toEqual(["Tổng quan", "Bán hàng", "Cuối ngày", "Kho", "Công nợ", "Tài chính"])
    const sb = doc("src/components/layout/sidebar.tsx")
    expect(sb).toContain('label: "Báo cáo tổng hợp"')
    for (const m of BAO_CAO_TONG_HOP) {
      expect(NAV_PERMISSION[m.href], m.href).toBeDefined()
      expect(sb, m.href).toContain(`href: "${m.href}"`)
      const f = `src/app/(dashboard)${m.href}/page.tsx`
      expect(existsSync(resolve(__dirname, "..", f)), f).toBe(true)
      expect(doc(f)).toContain(`<BaoCaoTam href="${m.href}"`)
      // Báo cáo cũ dẫn tới đều là đường dẫn đã khai quyền (không dẫn vào ngõ cụt).
      for (const c of m.cu) expect(NAV_PERMISSION[c.href] ?? CUA_VAO[c.href], c.href).toBeDefined()
    }
  })
  it("chạy SONG SONG — báo cáo cũ vẫn còn trong menu", () => {
    const sb = doc("src/components/layout/sidebar.tsx")
    for (const h of ["/dashboard", "/reports/sales", "/reports/finance", "/analytics/business/overview"]) expect(sb).toContain(`href: "${h}"`)
  })
  it("quyền theo spec mục 9", () => {
    const thay = (r: Role) => BAO_CAO_TONG_HOP.filter((m) => canSeeHref(r, m.href)).map((m) => m.label)
    expect(thay("owner")).toEqual(["Tổng quan", "Bán hàng", "Cuối ngày", "Kho", "Công nợ", "Tài chính"])
    expect(thay("manager")).toEqual(["Tổng quan", "Bán hàng", "Cuối ngày", "Kho", "Công nợ", "Tài chính"])
    expect(thay("accountant")).toEqual(["Tổng quan", "Bán hàng", "Cuối ngày", "Kho", "Công nợ", "Tài chính"])
    expect(thay("warehouse")).toEqual(["Tổng quan", "Bán hàng", "Cuối ngày", "Kho"])
    expect(thay("sales")).toEqual(["Bán hàng", "Công nợ"])
    expect(duocVaoTrang("sales", "/bao-cao/tai-chinh", "reports")).toBe(false)
    // Cổng tạm dẫn tới báo cáo cũ theo luật cửa vào — thủ kho vẫn thấy Báo cáo tồn kho (CUA_VAO).
    expect(duocVaoTrang("warehouse", "/reports/inventory", "reports")).toBe(true)
    expect(doc("src/components/reports/bao-cao-tam.tsx")).toContain('duocVaoTrang(user?.role, c.href, "reports")')
  })
  it("spec nằm trong repo", () => {
    const s = doc("thietke/bao-cao-tong-hop-spec.md")
    for (const h of ["## 3. Màn 1 — Tổng quan", "## 4. Màn 2 — Bán hàng", "## 5. Màn 3 — Cuối ngày", "## 6. Màn 4 — Kho", "## 7. Màn 5 — Công nợ", "## 8. Màn 6 — Tài chính"]) {
      expect(s).toContain(h)
    }
  })
})
