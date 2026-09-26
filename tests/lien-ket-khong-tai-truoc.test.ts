import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Kiểm tra xem tại sao mở các danh sách trên máy tính cứ bị chậm hơn
 *   bình thường". Đo trên bản build production: mỗi lần mở danh sách, `next/link` tự tải trước
 *   ~10 mục menu + 1 lượt MỖI DÒNG (log Vercel: `/customers/<id>` ×12 trong một giây) — mỗi lượt
 *   là một lần máy chủ chạy trang. Liên kết của app nay tắt tải trước mặc định.
 */
const ROOT = resolve(__dirname, "..")
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : []
  })
}

describe("liên kết không tự tải trước", () => {
  it("không file nào import thẳng next/link (trừ liên kết chung)", () => {
    const vi = files(join(ROOT, "src"))
      .filter((f) => !f.endsWith(join("components", "ui", "link.tsx")))
      .filter((f) => /from ["']next\/link["']/.test(readFileSync(f, "utf-8")))
    expect(vi).toEqual([])
  })
  it("liên kết chung mặc định prefetch = false, vẫn cho truyền prefetch rõ ràng", () => {
    const s = readFileSync(join(ROOT, "src/components/ui/link.tsx"), "utf-8")
    expect(s).toContain("{ prefetch = false, ...props }")
    expect(s).toContain("<NextLink ref={ref} prefetch={prefetch} {...props} />")
  })
  it("ESLint chặn import next/link mới", () => {
    const c = JSON.parse(readFileSync(join(ROOT, ".eslintrc.json"), "utf-8"))
    expect(c.rules["no-restricted-imports"][0]).toBe("error")
    expect(JSON.stringify(c.rules["no-restricted-imports"])).toContain('"name":"next/link"')
  })
})

describe("danh sách khách hàng: cột địa chỉ, phường", () => {
  it("có cột Địa chỉ và Phường/xã, bật mặc định, ngay sau SĐT", async () => {
    const { CUSTOMER_COLUMNS, DEFAULT_CUSTOMER_COLUMNS } = await import("../src/app/(dashboard)/customers/list-config")
    const keys = CUSTOMER_COLUMNS.map((c) => c.key)
    expect(keys.slice(keys.indexOf("phone"), keys.indexOf("phone") + 3)).toEqual(["phone", "address", "ward"])
    expect(DEFAULT_CUSTOMER_COLUMNS).toEqual(expect.arrayContaining(["address", "ward"]))
    const t = readFileSync(join(ROOT, "src/components/customers/customer-table.tsx"), "utf-8")
    expect(t).toContain('{show("address") && <TableHead>Địa chỉ</TableHead>}')
    expect(t).toContain('{show("ward") && <TableHead>Phường/xã</TableHead>}')
  })
})
