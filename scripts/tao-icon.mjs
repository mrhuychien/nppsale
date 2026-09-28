/**
 * SINH BỘ ICON TỪ LOGO SVG (chủ nhà 28/09/2026: "thay logo này vào, cả icon khi tạo icon ngoài
 * màn hình"). Chạy lại khi đổi logo: `node scripts/tao-icon.mjs`. Dùng Chromium của Playwright
 * (có sẵn) để vẽ — không thêm thư viện.
 *   · public/icons/logo.svg       — nền bo góc (trình duyệt, Android "any")
 *   · public/icons/logo-full.svg  — nền tràn viền, chữ thu 86% (Android "maskable", iPhone tự bo góc)
 */
import { chromium } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"

const RA = [
  ["public/icons/logo.svg", "public/icons/icon-192.png", 192, true],
  ["public/icons/logo.svg", "public/icons/icon-512.png", 512, true],
  ["public/icons/logo-full.svg", "public/icons/maskable-512.png", 512, false],
  ["public/icons/logo-full.svg", "public/apple-touch-icon.png", 180, false],
  ["public/icons/logo.svg", "public/icons/favicon-32.png", 32, true],
  ["public/icons/logo.svg", "public/icons/favicon-48.png", 48, true],
]

const b = await chromium.launch()
const p = await b.newPage()
for (const [nguon, dich, co, trongSuot] of RA) {
  await p.setViewportSize({ width: co, height: co })
  const svg = readFileSync(nguon, "utf8").replace("<svg ", `<svg width="${co}" height="${co}" `)
  await p.setContent(`<html><body style="margin:0;background:${trongSuot ? "transparent" : "#2563EB"}">${svg}</body></html>`)
  await p.screenshot({ path: dich, omitBackground: trongSuot })
  console.log("✓", dich)
}
await b.close()

/* favicon.ico = hai ảnh PNG (32, 48) gói trong khung ICO — trình duyệt nào cũng đọc được. */
const anh = ["public/icons/favicon-32.png", "public/icons/favicon-48.png"].map((f) => readFileSync(f))
const dau = Buffer.alloc(6 + 16 * anh.length)
dau.writeUInt16LE(0, 0); dau.writeUInt16LE(1, 2); dau.writeUInt16LE(anh.length, 4)
let lech = dau.length
anh.forEach((a, i) => {
  const co = a.readUInt32BE(16)
  const o = 6 + 16 * i
  dau.writeUInt8(co >= 256 ? 0 : co, o); dau.writeUInt8(co >= 256 ? 0 : co, o + 1)
  dau.writeUInt16LE(1, o + 4); dau.writeUInt16LE(32, o + 6)
  dau.writeUInt32LE(a.length, o + 8); dau.writeUInt32LE(lech, o + 12)
  lech += a.length
})
writeFileSync("src/app/favicon.ico", Buffer.concat([dau, ...anh]))
console.log("✓ src/app/favicon.ico")
