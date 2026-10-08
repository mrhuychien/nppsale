import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * BẢN ĐANG CHẠY CỦA TỪNG HÀM SQL — đọc từ `supabase/migrations`, dùng chung cho các chốt quét thân hàm.
 *
 * ⚠ ĐỌC ĐÚNG MỌI KIỂU THẺ DOLLAR. Luật migration (CLAUDE.md §3) bắt dùng thẻ ASCII `$fn$`, `$chk$`…; phép cắt chỉ
 * bám `$$` thì không thấy thân hàm của mọi migration mới — chốt xanh vì không soi gì cả.
 * ⚠ CHỈ BẢN CUỐI CÙNG theo thứ tự migration của mỗi (tên, kiểu tham số) mới có hiệu lực; `DROP FUNCTION` gỡ khỏi danh sách.
 */

export const THU_MUC_MIGRATION = resolve(__dirname, "..", "..", "supabase/migrations")

export type Tok =
  | { k: "w"; v: string; i: number } // từ (đã viết HOA) hoặc tên trong ngoặc kép (giữ nguyên)
  | { k: "p"; v: string; i: number } // ( ) ; , . = [ ]
  | { k: "s"; v: string; i: number } // chuỗi '…' / E'…'
  | { k: "d"; v: string; i: number; tag: string } // chuỗi dollar $tag$…$tag$ (v = phần ruột)

const CHU = /[A-Za-z_À-￿]/
const CHU_SO = /[A-Za-z0-9_$À-￿]/

/** Tách mã SQL thành từ / dấu / chuỗi — bỏ chú thích; chữ trong chuỗi không bị hiểu nhầm là lệnh. */
export function tachSql(src: string): Tok[] {
  const out: Tok[] = []
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === "-" && src[i + 1] === "-") {
      const e = src.indexOf("\n", i)
      i = e === -1 ? n : e + 1
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      let sau = 1
      i += 2
      while (i < n && sau > 0) {
        if (src.startsWith("/*", i)) {
          sau++
          i += 2
        } else if (src.startsWith("*/", i)) {
          sau--
          i += 2
        } else i++
      }
      continue
    }
    if (c === "'") {
      const truoc = out[out.length - 1]
      const laE = !!truoc && truoc.k === "w" && truoc.v === "E" && truoc.i + 1 === i
      if (laE) out.pop()
      const bd = i
      let j = i + 1
      let v = ""
      while (j < n) {
        if (laE && src[j] === "\\") {
          v += src.slice(j, j + 2)
          j += 2
          continue
        }
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            v += "'"
            j += 2
            continue
          }
          break
        }
        v += src[j]
        j++
      }
      out.push({ k: "s", v, i: bd })
      i = j + 1
      continue
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(src.slice(i, i + 80))
      if (m) {
        const the = m[0]
        const dau = i + the.length
        const cuoi = src.indexOf(the, dau)
        const het = cuoi === -1 ? n : cuoi
        out.push({ k: "d", v: src.slice(dau, het), i, tag: the })
        i = cuoi === -1 ? n : cuoi + the.length
        continue
      }
    }
    if (c === '"') {
      let j = i + 1
      let v = ""
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"'
            j += 2
            continue
          }
          break
        }
        v += src[j]
        j++
      }
      out.push({ k: "w", v, i })
      i = j + 1
      continue
    }
    if (CHU.test(c)) {
      let j = i + 1
      while (j < n && CHU_SO.test(src[j])) j++
      out.push({ k: "w", v: src.slice(i, j).toUpperCase(), i })
      i = j
      continue
    }
    if ("();,.=[]".includes(c)) out.push({ k: "p", v: c, i })
    i++
  }
  return out
}

const la = (t: Tok | undefined, v: string) => !!t && (t.k === "w" || t.k === "p") && t.v === v

/** Chỉ số token đóng ngoặc khớp với `(` ở `mo`. */
function dongNgoac(toks: Tok[], mo: number): number {
  let sau = 0
  for (let j = mo; j < toks.length; j++) {
    if (la(toks[j], "(")) sau++
    else if (la(toks[j], ")")) {
      sau--
      if (sau === 0) return j
    }
  }
  return toks.length - 1
}

const BI_DANH_KIEU: Record<string, string> = {
  INT: "INTEGER",
  INT4: "INTEGER",
  INT8: "BIGINT",
  INT2: "SMALLINT",
  BOOL: "BOOLEAN",
  FLOAT8: "DOUBLE PRECISION",
  FLOAT4: "REAL",
  TIMESTAMPTZ: "TIMESTAMP WITH TIME ZONE",
  TIMETZ: "TIME WITH TIME ZONE",
  VARCHAR: "CHARACTER VARYING",
  DECIMAL: "NUMERIC",
}
const KIEU_NHIEU_TU = new Set(["DOUBLE", "CHARACTER", "TIMESTAMP", "TIME", "BIT", "INTERVAL", "NATIONAL"])

/** Chữ ký kiểu tham số như Postgres nhận diện hàm: bỏ tên, bỏ mặc định, bỏ tham số OUT, quy bí danh kiểu. */
function chuKy(toks: Tok[]): string {
  const thamSo: Tok[][] = [[]]
  let sau = 0
  for (const t of toks) {
    if (la(t, "(")) sau++
    if (la(t, ")")) sau--
    if (sau === 0 && la(t, ",")) thamSo.push([])
    else thamSo[thamSo.length - 1].push(t)
  }
  const kieu: string[] = []
  for (let p of thamSo) {
    if (p.length === 0) continue
    const md = p.findIndex((t) => la(t, "=") || la(t, "DEFAULT"))
    if (md !== -1) p = p.slice(0, md)
    let mode = "IN"
    if (p[0] && p[0].k === "w" && ["IN", "OUT", "INOUT", "VARIADIC"].includes(p[0].v)) {
      mode = p[0].v
      p = p.slice(1)
    }
    if (mode === "OUT") continue
    // Còn lại: [tên] kiểu… — từ đầu là tên khi ngay sau nó là một TỪ (không phải `.` `(` `[`) và nó không mở đầu
    // một kiểu nhiều chữ (`double precision`, `timestamp with time zone`…).
    if (p.length > 1 && p[0].k === "w" && p[1].k === "w" && !KIEU_NHIEU_TU.has(p[0].v)) p = p.slice(1)
    let s = ""
    let trongNgoac = 0
    for (const t of p) {
      if (la(t, "(")) trongNgoac++
      else if (la(t, ")")) trongNgoac--
      else if (trongNgoac === 0) s += t.k === "p" ? t.v : ` ${BI_DANH_KIEU[t.v] ?? t.v}`
    }
    kieu.push(s.replace(/\s*\.\s*/g, ".").trim().replace(/^PUBLIC\./, ""))
  }
  return kieu.join(",")
}

export interface HamDangChay {
  file: string
  ten: string // schema.tên (chữ thường)
  chuKy: string
  than: string // phần ruột giữa hai thẻ dollar — đúng như `pg_proc.prosrc`
  dau: string // phần đầu `CREATE … FUNCTION …(…) RETURNS … AS ` đứng trước thân hàm
}

/** Tên đầy đủ (schema.tên, chữ thường) bắt đầu ở token `k`; trả thêm chỉ số token ngay sau tên. */
function docTen(toks: Tok[], k: number): { ten: string; sau: number } | null {
  const a = toks[k]
  if (!a || a.k !== "w") return null
  if (la(toks[k + 1], ".") && toks[k + 2]?.k === "w") {
    return { ten: `${a.v}.${(toks[k + 2] as Tok).v}`.toLowerCase(), sau: k + 3 }
  }
  return { ten: `public.${a.v}`.toLowerCase(), sau: k + 1 }
}

/** Bản đang chạy của mọi hàm (khoá: `schema.tên(kiểu,…)`). */
export function hamDangChay(dir: string = THU_MUC_MIGRATION): Map<string, HamDangChay> {
  const out = new Map<string, HamDangChay>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const src = readFileSync(join(dir, file), "utf-8")
    const toks = tachSql(src)
    for (let k = 0; k < toks.length; k++) {
      // CREATE [OR REPLACE] FUNCTION tên ( … ) … $tag$ thân $tag$
      if (la(toks[k], "CREATE")) {
        let j = k + 1
        if (la(toks[j], "OR") && la(toks[j + 1], "REPLACE")) j += 2
        if (!la(toks[j], "FUNCTION")) continue
        const t = docTen(toks, j + 1)
        if (!t || !la(toks[t.sau], "(")) continue
        const dong = dongNgoac(toks, t.sau)
        const ck = chuKy(toks.slice(t.sau + 1, dong))
        let than: string | null = null
        let mo = 0
        for (let x = dong + 1; x < toks.length && !la(toks[x], ";"); x++) {
          const tk = toks[x]
          if (tk.k === "d" || (tk.k === "s" && la(toks[x - 1], "AS"))) {
            than = tk.v
            mo = tk.i
            break
          }
        }
        if (than !== null) {
          out.set(`${t.ten}(${ck})`, { file, ten: t.ten, chuKy: ck, than, dau: src.slice(toks[k].i, mo) })
        }
        k = dong
        continue
      }
      // DROP FUNCTION [IF EXISTS] tên [( … )] [, …]
      if (la(toks[k], "DROP") && la(toks[k + 1], "FUNCTION")) {
        let j = k + 2
        if (la(toks[j], "IF") && la(toks[j + 1], "EXISTS")) j += 2
        for (;;) {
          const t = docTen(toks, j)
          if (!t) break
          if (la(toks[t.sau], "(")) {
            const dong = dongNgoac(toks, t.sau)
            out.delete(`${t.ten}(${chuKy(toks.slice(t.sau + 1, dong))})`)
            j = dong + 1
          } else {
            for (const key of Array.from(out.keys())) if (out.get(key)!.ten === t.ten) out.delete(key)
            j = t.sau
          }
          if (!la(toks[j], ",")) break
          j++
        }
      }
    }
  }
  return out
}

/** Từ đứng ngay trước UPDATE mà KHÔNG phải câu UPDATE (khoá dòng, ON CONFLICT, trigger, quyền). */
const TRUOC_UPDATE_KHONG_PHAI_CAU = new Set(["FOR", "KEY", "DO", "OF", "ON", "BEFORE", "AFTER", "OR", "INSTEAD", "GRANT", "REVOKE", ","])

export interface CauThieuWhere {
  lenh: "UPDATE" | "DELETE"
  cau: string
}

/**
 * Câu `UPDATE … SET …` / `DELETE FROM …` KHÔNG có `WHERE` ở đúng tầng của nó (kể cả câu trong `WITH … AS (…)`).
 * `WHERE` nằm trong truy vấn con không tính — đúng như `safeupdate` của Supabase. SQL động (`EXECUTE '…'`) là chuỗi,
 * không soi được.
 */
export function cauThieuWhere(than: string): CauThieuWhere[] {
  const toks = tachSql(than)
  const out: CauThieuWhere[] = []
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.k !== "w" || (t.v !== "UPDATE" && t.v !== "DELETE")) continue
    const truoc = toks[k - 1]
    if (t.v === "UPDATE" && truoc && TRUOC_UPDATE_KHONG_PHAI_CAU.has(truoc.v)) continue
    if (t.v === "DELETE" && !la(toks[k + 1], "FROM")) continue
    let sau = 0
    let coSet = false
    let coWhere = false
    let het = toks.length
    for (let j = k + 1; j < toks.length; j++) {
      const x = toks[j]
      if (la(x, "(")) sau++
      else if (la(x, ")")) {
        if (sau === 0) {
          het = j
          break
        }
        sau--
      } else if (sau === 0 && la(x, ";")) {
        het = j
        break
      } else if (sau === 0 && la(x, "SET")) coSet = true
      else if (sau === 0 && la(x, "WHERE")) coWhere = true
    }
    if (t.v === "UPDATE" && !coSet) continue
    if (!coWhere) {
      const cuoi = het < toks.length ? toks[het].i : than.length
      out.push({ lenh: t.v, cau: than.slice(t.i, cuoi).replace(/\s+/g, " ").trim() })
    }
  }
  return out
}
