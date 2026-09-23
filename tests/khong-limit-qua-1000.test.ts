import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * KHÔNG `.limit(N)` VỚI N > 1.000 — Ở BẤT KỲ ĐÂU TRONG `src/`.
 *
 * ⚠ VÌ SAO (đợt QA 23/09/2026). PostgREST có `db.max_rows = 1000`.
 *   `.limit(5000)` KHÔNG xin được 5.000 dòng: máy chủ trả đúng 1.000,
 *   200 OK, không lỗi, không cờ. Người viết tin rằng mình đã "nới trần",
 *   người đọc mã cũng tin thế — và đó chính là chỗ nguy hiểm: một phép
 *   đọc trông có chủ ý, có hằng số đặt tên đàng hoàng, mà thiếu dữ liệu.
 *   Đo được ở: đối soát MISA (`.limit(20000)` → cắt liên kết hoá đơn đã
 *   khớp), cron nhắc ảnh (`.limit(CAP)` → nhắc sai người), thẻ đếm đối
 *   soát (`.limit(5000)` → số dừng ở 1.000).
 *
 * ⚠ MUỐN ĐỌC NHIỀU HƠN 1.000 DÒNG thì dùng `docDuHoacNem` /
 *   `fetchAllForAggregate` (phân trang song song) hoặc đếm ở database
 *   (`count: "exact", head: true`) — không có con số `.limit` nào làm được.
 *
 * ⚠ MÁY QUÉT GIẢI CẢ HẰNG SỐ ĐẶT TÊN (`const CAP = 5000`, kể cả hằng số
 *   export ở tệp khác và biểu thức `CAP * MAX_PHOTOS`) — chỉ bắt chữ số
 *   thì đặt tên cho con số là lách qua. Biểu thức không giải được cũng
 *   là LỖI: không chứng minh được ≤ 1.000 thì coi như vượt.
 */

const ROOT = resolve(__dirname, "..")
const TRAN = 1000

function moiTep(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) moiTep(p, acc)
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p)
  }
  return acc
}

const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

/** `const NAME = 123` / `export const NAME = OTHER` trong một nguồn. */
function hangSo(src: string): Map<string, string> {
  const m = new Map<string, string>()
  const re = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([^\n;]+)/g
  let x: RegExpExecArray | null
  while ((x = re.exec(src))) m.set(x[1], x[2].trim())
  return m
}

/**
 * Giá trị của biểu thức trong `.limit(...)`, hoặc `null` nếu không giải
 * được. Chỉ nhận số, tên hằng số (tra trong tệp rồi tới hằng export toàn
 * `src/`), `+ - * /` và ngoặc.
 */
function giaTri(expr: string, noiBo: Map<string, string>, toanCuc: Map<string, string>, sau = 0): number | null {
  if (sau > 5) return null
  let bad = false
  const thay = expr.replace(/[A-Za-z_$][\w$]*/g, (ten) => {
    const v = noiBo.get(ten) ?? toanCuc.get(ten)
    if (v === undefined) { bad = true; return "0" }
    const g = giaTri(v, noiBo, toanCuc, sau + 1)
    if (g === null) { bad = true; return "0" }
    return String(g)
  }).replace(/(\d)_(?=\d)/g, "$1")
  if (bad || !/^[\d\s+\-*/().]+$/.test(thay)) return null
  try {
    const v = Function(`"use strict"; return (${thay})`)() as unknown
    return typeof v === "number" && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Mọi `.limit(...)` vượt trần (hoặc không giải được) trong một nguồn. */
export function limitVuotTran(src: string, toanCuc: Map<string, string> = new Map()): string[] {
  const c = boChuThich(src)
  const noiBo = hangSo(c)
  const out: string[] = []
  const re = /\.limit\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(c))) {
    // Lấy đối số tới dấu `)` khớp ngoặc.
    let i = m.index + m[0].length
    let sau = 1
    const dau = i
    while (i < c.length && sau > 0) {
      if (c[i] === "(") sau++
      else if (c[i] === ")") sau--
      i++
    }
    const expr = c.slice(dau, i - 1).trim()
    const v = giaTri(expr, noiBo, toanCuc)
    if (v === null) out.push(`.limit(${expr}) — không giải được`)
    else if (v > TRAN) out.push(`.limit(${expr}) = ${v}`)
  }
  return out
}

/**
 * ⚠ NỢ NGOÀI PHẠM VI ĐỢT NÀY — tệp của người khác đang sửa song song. Mỗi
 *   dòng ở đây phải CÒN mắc lỗi (chốt dưới canh): sửa xong mà quên xoá tên
 *   thì chốt đỏ, để danh sách không mục thành chỗ trú ẩn.
 */
const CON_NO: Record<string, string> = {}

describe("máy quét `.limit()` tự kiểm", () => {
  it("bắt số trơn, hằng số đặt tên, biểu thức, hằng số tệp khác", () => {
    expect(limitVuotTran(`q.limit(5000)`)).toHaveLength(1)
    expect(limitVuotTran(`q.limit(20_000)`)).toHaveLength(1)
    expect(limitVuotTran(`const CAP = 2000\nq.limit(CAP)`)).toHaveLength(1)
    expect(limitVuotTran(`const CAP = 400\nq.limit(CAP * MAX)`, new Map([["MAX", "5"]]))).toHaveLength(1)
    expect(limitVuotTran(`const A = B\nq.limit(A + 1)`, new Map([["B", "1000"]]))).toHaveLength(1)
  })

  it("tha những gì chứng minh được ≤ 1.000", () => {
    expect(limitVuotTran(`q.limit(1000)`)).toEqual([])
    expect(limitVuotTran(`const PASS = 200\nq.limit(PASS)`)).toEqual([])
    expect(limitVuotTran(`q.limit(M + 1)`, new Map([["M", "150"]]))).toEqual([])
    // Trong chú thích thì không tính.
    expect(limitVuotTran(`// .limit(5000) cũ vô tác dụng\n/* .limit(9999) */ q.limit(10)`)).toEqual([])
  })

  it("không giải được thì coi như vượt — không lách bằng biến", () => {
    expect(limitVuotTran(`q.limit(n)`)).toHaveLength(1)
    expect(limitVuotTran(`q.limit(opts.cap)`)).toHaveLength(1)
  })
})

describe("không `.limit(N)` nào với N > 1.000 trong src/", () => {
  const tep = moiTep(resolve(ROOT, "src"))
  const toanCuc = new Map<string, string>()
  for (const abs of tep) {
    const c = boChuThich(readFileSync(abs, "utf-8"))
    const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([^\n;]+)/g
    let x: RegExpExecArray | null
    while ((x = re.exec(c))) toanCuc.set(x[1], x[2].trim())
  }

  it("toàn bộ src/ (trừ nợ đã ghi)", () => {
    const bad: string[] = []
    for (const abs of tep) {
      const rel = abs.slice(ROOT.length + 1)
      if (rel in CON_NO) continue
      for (const h of limitVuotTran(readFileSync(abs, "utf-8"), toanCuc)) bad.push(`${rel}: ${h}`)
    }
    expect(
      bad,
      "`.limit()` quá 1.000 bị `db.max_rows` cắt IM LẶNG — dùng docDuHoacNem / " +
        "fetchAllForAggregate hoặc đếm bằng `head: true`:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  it("mỗi tệp trong danh sách nợ đều thật sự còn mắc lỗi", () => {
    for (const [rel, ten] of Object.entries(CON_NO)) {
      const hits = limitVuotTran(readFileSync(resolve(ROOT, rel), "utf-8"), toanCuc)
      expect(
        hits.some((h) => h.includes(ten)),
        `${rel} đã hết \`.limit(${ten})\` vượt trần — xoá tên nó khỏi CON_NO`
      ).toBe(true)
    }
  })
})
