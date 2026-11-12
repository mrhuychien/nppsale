#!/usr/bin/env node
/**
 * Chạy sau `next build` (`npm run build` — Vercel và CI đều gọi đường này).
 *
 * VÌ SAO (chủ nhà 12/11/2026: "Có lỗi gì mà font chữ thay đổi hết vậy"): bản build ceb2b87 trên Vercel dựng HTML với
 * `<html class="__variable_08700a">` nhưng CSS gửi xuống trình duyệt chỉ có `.__variable_6c36b7` — phần máy chủ và phần
 * trình duyệt của cùng một bản build tính ra hai tên lớp font khác nhau → `--font-manrope` không có giá trị, cả app rơi về
 * font mặc định mà build vẫn "thành công". Nay: mọi lớp next/font trên trang dựng sẵn phải có trong CSS mà CHÍNH trang ấy
 * nạp; lệch là build THẤT BẠI — Vercel giữ nguyên bản đang chạy thay vì phát bản hỏng font.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

/** Lớp next/font: `__variable_<6 hex>` (biến CSS) / `__className_<6 hex>` (đặt thẳng font-family). */
const LOP_FONT = /__(?:variable|className)_[0-9a-f]{6}(?![0-9A-Za-z_-])/g
/** Tệp CSS trang nạp: `<link rel="stylesheet" href="/_next/static/css/….css">` (thứ tự thuộc tính tuỳ ý). */
const LINK_CSS = /<link\b[^>]*\bhref="(\/_next\/static\/css\/[^"]+\.css)"[^>]*>/g

/** Các lớp font một trang HTML dùng (kể cả trong dữ liệu RSC đi kèm). */
export function lopFontTrongHtml(html) {
  return Array.from(new Set(Array.from(html.matchAll(LOP_FONT), (m) => m[0]))).sort()
}

/** Đường dẫn các tệp CSS trang nạp, theo thứ tự xuất hiện, không lặp. */
export function cssTrangNap(html) {
  return Array.from(new Set(Array.from(html.matchAll(LINK_CSS), (m) => m[1])))
}

/** CSS có khai báo bộ chọn `.lop` (không tính lớp dài hơn cùng tiền tố). */
export function cssCoLop(css, lop) {
  return new RegExp(`\\.${lop}(?![0-9A-Za-z_-])`).test(css)
}

/**
 * Kiểm một trang: `docCss(href)` trả nội dung tệp CSS (null nếu không có tệp).
 * Trả `{ lop, loi }` — `lop`: lớp font trang dùng; `loi`: câu tiếng Việt cho từng chỗ hỏng.
 */
export function kiemFontTrang(html, docCss) {
  const lop = lopFontTrongHtml(html)
  const loi = []
  const css = []
  for (const href of cssTrangNap(html)) {
    const noiDung = docCss(href)
    if (noiDung == null) loi.push(`trang nạp ${href} nhưng bản build không có tệp ấy`)
    else css.push(noiDung)
  }
  const tatCa = css.join("\n")
  for (const l of lop) {
    if (!cssCoLop(tatCa, l)) loi.push(`trang mang lớp font ${l} nhưng CSS trang nạp không khai báo .${l} — font sẽ rơi về mặc định`)
  }
  return { lop, loi }
}

function timHtml(thuMuc) {
  let ra = []
  let muc
  try {
    muc = readdirSync(thuMuc, { withFileTypes: true })
  } catch {
    return ra
  }
  for (const m of muc) {
    const p = join(thuMuc, m.name)
    if (m.isDirectory()) ra = ra.concat(timHtml(p))
    else if (m.name.endsWith(".html")) ra.push(p)
  }
  return ra
}

/** Kiểm cả thư mục build (`.next`). Trả danh sách lỗi (rỗng = ổn) + số trang / số lớp đã thấy. */
export function kiemThuMucBuild(goc) {
  const trang = timHtml(join(goc, "server", "app"))
  if (trang.length === 0) {
    return { soTrang: 0, soLop: 0, loi: [`không thấy trang dựng sẵn nào trong ${join(goc, "server", "app")} — chạy sau next build`] }
  }
  const boNho = new Map()
  const docCss = (href) => {
    if (!boNho.has(href)) {
      let noiDung = null
      try {
        noiDung = readFileSync(join(goc, href.replace(/^\/_next\//, "")), "utf8")
      } catch {
        noiDung = null
      }
      boNho.set(href, noiDung)
    }
    return boNho.get(href)
  }
  const loi = []
  const lopDaThay = new Set()
  for (const f of trang) {
    const r = kiemFontTrang(readFileSync(f, "utf8"), docCss)
    r.lop.forEach((l) => lopDaThay.add(l))
    r.loi.forEach((x) => loi.push(`${relative(goc, f)}: ${x}`))
  }
  if (lopDaThay.size === 0) {
    loi.push("không trang nào mang lớp font next/font — <html> của src/app/layout.tsx phải có manrope.variable")
  }
  return { soTrang: trang.length, soLop: lopDaThay.size, loi }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const goc = process.argv[2] ?? ".next"
  const { soTrang, soLop, loi } = kiemThuMucBuild(goc)
  if (loi.length) {
    console.error(`\n✗ Kiểm font sau build: ${loi.length} lỗi (xem scripts/kiem-font-build.mjs)`)
    for (const x of loi.slice(0, 20)) console.error(`  - ${x}`)
    if (loi.length > 20) console.error(`  … và ${loi.length - 20} lỗi nữa`)
    process.exit(1)
  }
  console.log(`✓ Kiểm font sau build: ${soTrang} trang dựng sẵn, ${soLop} lớp font đều có trong CSS trang nạp.`)
}
