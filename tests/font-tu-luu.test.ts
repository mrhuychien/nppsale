import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { brotliDecompressSync } from "node:zlib"
import { kiemFontTrang, cssCoLop, lopFontTrongHtml, cssTrangNap } from "../scripts/kiem-font-build.mjs"

/**
 * Chủ nhà 12/11/2026: "Có lỗi gì mà font chữ thay đổi hết vậy". Bản build ceb2b87 trên Vercel: HTML mang
 * `class="__variable_08700a"` (phần máy chủ tải lại Manrope từ Google — Google vừa đổi tệp), CSS trang nạp chỉ có
 * `.__variable_6c36b7` (bộ nhớ build cũ) → `--font-manrope` rỗng, cả app về font mặc định. Hai mốc chụp từ production.
 */
const CSS_PRODUCTION = "/_next/static/css/c2c5d2810c9d0d96.css"
const LINK = `<link rel="stylesheet" href="${CSS_PRODUCTION}" data-precedence="next"/>`
const CSS_FONT_CU =
  "@font-face{font-family:'__Manrope_6c36b7';font-style:normal;font-weight:400;font-display:swap;src:url(/_next/static/media/4c9affa5bc8f420e-s.p.woff2) format('woff2')}" +
  ".__variable_6c36b7{--font-manrope:'__Manrope_6c36b7', '__Manrope_Fallback_6c36b7'}"
const trang = (lop: string) =>
  `<!DOCTYPE html><html lang="vi" class="${lop}"><head>${LINK}</head><body class="font-sans">` +
  `<script>self.__next_f.push([1,"[\\"$\\",\\"html\\",null,{\\"lang\\":\\"vi\\",\\"className\\":\\"${lop}\\"}]"])</script></body></html>`
const docCss = (bang: Record<string, string>) => (href: string) => bang[href] ?? null

describe("kiểm font sau build — lớp next/font trên trang phải có trong CSS trang nạp", () => {
  it("bản ceb2b87 (HTML __variable_08700a, CSS chỉ có .__variable_6c36b7) → báo lỗi, build thất bại", () => {
    const r = kiemFontTrang(trang("__variable_08700a"), docCss({ [CSS_PRODUCTION]: CSS_FONT_CU }))
    expect(r.lop).toEqual(["__variable_08700a"])
    expect(r.loi).toHaveLength(1)
    expect(r.loi[0]).toContain("__variable_08700a")
    expect(r.loi[0]).toContain("font sẽ rơi về mặc định")
  })

  it("bản 2fb59c4 (HTML và CSS cùng __variable_6c36b7) → không lỗi", () => {
    const r = kiemFontTrang(trang("__variable_6c36b7"), docCss({ [CSS_PRODUCTION]: CSS_FONT_CU }))
    expect(r).toEqual({ lop: ["__variable_6c36b7"], loi: [] })
  })

  it("trang nạp tệp CSS bản build không có → báo lỗi riêng", () => {
    const r = kiemFontTrang(trang("__variable_6c36b7"), docCss({}))
    expect(r.loi.some((x: string) => x.includes(CSS_PRODUCTION) && x.includes("không có tệp"))).toBe(true)
  })

  it("chỉ tính CSS CHÍNH trang ấy nạp — lớp nằm ở tệp CSS khác không cứu được trang", () => {
    const html = trang("__variable_08700a")
    const r = kiemFontTrang(html, docCss({ [CSS_PRODUCTION]: CSS_FONT_CU, "/_next/static/css/khac.css": ".__variable_08700a{}" }))
    expect(r.loi).toHaveLength(1)
  })

  it("lớp dài hơn cùng tiền tố không tính là có (.__variable_08700ab ≠ .__variable_08700a)", () => {
    expect(cssCoLop(".__variable_08700ab{--x:1}", "__variable_08700a")).toBe(false)
    expect(cssCoLop(".__variable_08700a{--x:1}", "__variable_08700a")).toBe(true)
    expect(cssCoLop(".a,.__variable_08700a,.b{}", "__variable_08700a")).toBe(true)
  })

  it("đọc đủ lớp font (cả __className_) và tệp CSS trang nạp, không lặp", () => {
    const html = `<html class="__variable_08700a __className_1a2b3c"><head>${LINK}${LINK}` +
      `<link rel="stylesheet" href="/_next/static/css/b.css" data-precedence="next"/></head></html>`
    expect(lopFontTrongHtml(html)).toEqual(["__className_1a2b3c", "__variable_08700a"])
    expect(cssTrangNap(html)).toEqual([CSS_PRODUCTION, "/_next/static/css/b.css"])
  })
})

/* ---- Tệp font tự lưu: đúng WOFF2, đủ chữ tiếng Việt, giữ tnum (cột số), trục đậm phủ 400–700 ---- */

const TEP_FONT = join(process.cwd(), "src/app/fonts/manrope-latin-vi.woff2")
const TEN_BANG = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep",
  "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS",
  "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln",
  "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf",
  "Silf", "Glat", "Gloc", "Feat", "Sill"]

/** Bảng của một tệp WOFF2 (bảng biến đổi — glyf / loca — giữ nguyên dạng nén; ở đây không đọc tới). */
function bangWoff2(buf: Buffer): Map<string, Buffer> {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("không phải tệp WOFF2")
  const soBang = buf.readUInt16BE(12)
  const kichNen = buf.readUInt32BE(20)
  let p = 48
  const base128 = () => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[p++]
      v = v * 128 + (b & 0x7f)
      if (!(b & 0x80)) return v
    }
    throw new Error("UIntBase128 hỏng")
  }
  const ds: { tag: string; dai: number }[] = []
  for (let i = 0; i < soBang; i++) {
    const co = buf[p++]
    let tag = TEN_BANG[co & 0x3f]
    if ((co & 0x3f) === 63) {
      tag = buf.toString("latin1", p, p + 4)
      p += 4
    }
    const kieu = co >> 6
    const daiGoc = base128()
    const bienDoi = tag === "glyf" || tag === "loca" ? kieu !== 3 : kieu !== 0
    ds.push({ tag, dai: bienDoi ? base128() : daiGoc })
  }
  const du = brotliDecompressSync(buf.subarray(p, p + kichNen))
  const ra = new Map<string, Buffer>()
  let o = 0
  for (const b of ds) {
    ra.set(b.tag, du.subarray(o, o + b.dai))
    o += b.dai
  }
  if (o !== du.length) throw new Error(`độ dài bảng (${o}) lệch dữ liệu giải nén (${du.length})`)
  return ra
}

/** Mã ký tự có nét (cmap dạng 4 / 12). */
function maCoNet(cmap: Buffer): Set<number> {
  const ra = new Set<number>()
  const soMa = cmap.readUInt16BE(2)
  for (let i = 0; i < soMa; i++) {
    const lech = cmap.readUInt32BE(8 + i * 8)
    const dang = cmap.readUInt16BE(lech)
    if (dang === 4) {
      const seg = cmap.readUInt16BE(lech + 6) / 2
      const cuoi = lech + 14
      const dau = cuoi + seg * 2 + 2
      const delta = dau + seg * 2
      const roff = delta + seg * 2
      for (let s = 0; s < seg; s++) {
        const e = cmap.readUInt16BE(cuoi + s * 2)
        const st = cmap.readUInt16BE(dau + s * 2)
        const d = cmap.readInt16BE(delta + s * 2)
        const r = cmap.readUInt16BE(roff + s * 2)
        for (let c = st; c <= e && c !== 0xffff; c++) {
          let g = r === 0 ? (c + d) & 0xffff : cmap.readUInt16BE(roff + s * 2 + r + (c - st) * 2)
          if (r !== 0 && g !== 0) g = (g + d) & 0xffff
          if (g !== 0) ra.add(c)
        }
      }
    } else if (dang === 12) {
      const n = cmap.readUInt32BE(lech + 12)
      for (let k = 0; k < n; k++) {
        const a = cmap.readUInt32BE(lech + 16 + k * 12)
        const b = cmap.readUInt32BE(lech + 20 + k * 12)
        const g = cmap.readUInt32BE(lech + 24 + k * 12)
        for (let c = a; c <= b; c++) if (g + (c - a) !== 0) ra.add(c)
      }
    }
  }
  return ra
}

const VIET = "aàáảãạăằắẳẵặâầấẩẫậbcdđeèéẻẽẹêềếểễệfghiìíỉĩịjklmnoòóỏõọôồốổỗộơờớởỡợpqrstuùúủũụưừứửữựvwxyỳýỷỹỵz"
/* Ký hiệu trên màn / tờ in mà ba vùng Google phát cho trang tiếng Việt vẫn vẽ bằng Manrope. */
const KY_HIEU = " .,:;!?%/()-+*=&@#'\"₫–—…‘’“”•€×÷°·0123456789"

describe("tệp font tự lưu src/app/fonts/manrope-latin-vi.woff2", () => {
  const buf = readFileSync(TEP_FONT)
  const bang = bangWoff2(buf)

  it("là WOFF2, gọn (một tệp thay ba tệp Google ~48 KB)", () => {
    expect(buf.length).toBeGreaterThan(20_000)
    expect(buf.length).toBeLessThan(60_000)
  })

  it("vẽ được MỌI chữ cái tiếng Việt (thường + hoa, đủ dấu) và các ký hiệu hay dùng", () => {
    const co = maCoNet(bang.get("cmap")!)
    const thieu = Array.from(VIET + VIET.toUpperCase() + KY_HIEU).filter((c) => !co.has(c.codePointAt(0)!))
    expect(thieu).toEqual([])
  })

  it("giữ tính năng chữ số đều (tnum — cột tiền tabular-nums) và các tính năng Google giữ", () => {
    const gsub = bang.get("GSUB")!
    const ds = gsub.readUInt16BE(6)
    const n = gsub.readUInt16BE(ds)
    const tag = new Set(Array.from({ length: n }, (_, i) => gsub.toString("latin1", ds + 2 + i * 6, ds + 6 + i * 6)))
    for (const t of ["tnum", "pnum", "liga", "calt", "frac", "locl"]) expect(tag.has(t), t).toBe(true)
  })

  it("là font biến thiên, trục đậm phủ 400–700 (font-weight: 400 700 của layout)", () => {
    const fvar = bang.get("fvar")!
    const lech = fvar.readUInt16BE(4)
    const soTruc = fvar.readUInt16BE(8)
    const coDai = fvar.readUInt16BE(10)
    const truc = Array.from({ length: soTruc }, (_, i) => {
      const o = lech + i * coDai
      return { tag: fvar.toString("latin1", o, o + 4), min: fvar.readInt32BE(o + 4) / 65536, max: fvar.readInt32BE(o + 12) / 65536 }
    })
    const wght = truc.find((t) => t.tag === "wght")!
    expect(wght.min).toBeLessThanOrEqual(400)
    expect(wght.max).toBeGreaterThanOrEqual(700)
  })

  it("có giấy phép OFL đi kèm", () => {
    expect(readFileSync(join(process.cwd(), "src/app/fonts/OFL.txt"), "utf8")).toContain("SIL Open Font License, Version 1.1")
  })
})

describe("ghim: build không tải font từ Google, luôn chạy bước kiểm", () => {
  it("layout gốc dùng next/font/local với tệp trong repo, gắn biến --font-manrope lên <html>", () => {
    const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8")
    expect(src).toContain('import localFont from "next/font/local"')
    expect(src).toMatch(/src:\s*"\.\/fonts\/manrope-latin-vi\.woff2"/)
    expect(src).toMatch(/variable:\s*"--font-manrope"/)
    expect(src).toMatch(/<html[^>]*className=\{manrope\.variable\}/)
    expect(existsSync(TEP_FONT)).toBe(true)
  })

  it("không còn chỗ nào trong src/ nhập next/font/google", () => {
    const NHAP = /(?:from|import\(|require\()\s*["']next\/font\/google["']/
    const tim = (thuMuc: string): string[] =>
      readdirSync(thuMuc).flatMap((ten) => {
        const p = join(thuMuc, ten)
        if (statSync(p).isDirectory()) return tim(p)
        return /\.(tsx?|jsx?|mjs)$/.test(ten) && NHAP.test(readFileSync(p, "utf8")) ? [p] : []
      })
    expect(tim(join(process.cwd(), "src"))).toEqual([])
  })

  it("npm run build (Vercel, CI) chạy bước kiểm font ngay sau next build", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
    expect(pkg.scripts.build).toBe("next build && node scripts/kiem-font-build.mjs")
  })
})
