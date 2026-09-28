/**
 * Chủ nhà 28/09/2026: "Tối ưu và thay logo này vào, cả icon khi tạo icon ngoài màn hình".
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"

const png = (p: string) => {
  const b = readFileSync(p)
  expect(b.subarray(1, 4).toString(), p).toBe("PNG")
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }
}

describe("bộ icon ngoài màn hình", () => {
  it("manifest: SVG + PNG 192 / 512 + maskable 512, đủ file thật", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"))
    const ds = m.icons as Array<{ src: string; sizes: string; purpose: string }>
    expect(ds.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true)
    for (const i of ds) expect(existsSync(`public${i.src}`), i.src).toBe(true)
    for (const i of ds.filter((x) => x.src.endsWith(".png"))) {
      const { w, h } = png(`public${i.src}`)
      expect(`${w}x${h}`).toBe(i.sizes)
    }
  })
  it("iPhone: apple-touch-icon 180×180 khai trong layout; favicon.ico mới", () => {
    expect(png("public/apple-touch-icon.png")).toMatchObject({ w: 180, h: 180 })
    const l = readFileSync("src/app/layout.tsx", "utf8")
    expect(l).toMatch(/apple: \[\{ url: "\/apple-touch-icon\.png", sizes: "180x180" \}\]/)
    const ico = readFileSync("src/app/favicon.ico")
    expect(ico.readUInt16LE(2)).toBe(1) // kiểu ICO
    expect(ico.readUInt16LE(4)).toBe(2) // hai ảnh 32 + 48
  })
  it("tối ưu: logo SVG vài trăm byte, icon PNG nhỏ", () => {
    expect(readFileSync("public/icons/logo.svg").length).toBeLessThan(2000)
    expect(png("public/icons/icon-512.png").bytes).toBeLessThan(40_000)
  })
})

describe("logo trong app", () => {
  it("không còn ô chữ 'N' giả logo; dùng BrandMark", () => {
    for (const f of ["src/components/layout/sidebar.tsx", "src/app/login/page.tsx", "src/app/(dashboard)/home/page.tsx"]) {
      const s = readFileSync(f, "utf8")
      expect(s, f).toContain("<BrandMark")
      expect(s, f).not.toMatch(/>\s*N\s*<\/(span|div)>/)
    }
  })
  it("service worker bỏ bản /logo.svg cũ (đổi phiên bản bộ nhớ)", () => {
    const sw = readFileSync("public/sw.js", "utf8")
    expect(sw).not.toContain('"/logo.svg"')
    expect(sw).toContain('const CACHE_VERSION = "npp-v2"')
  })
})
