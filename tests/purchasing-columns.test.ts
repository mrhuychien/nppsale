import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * TÊN CỘT TRONG CODE PHẢI CÓ THẬT TRONG SCHEMA.
 *
 * ⚠ CHUYỆN VỪA XẢY RA. Tôi ghi `note: …` vào `purchase_invoice_lines`
 * trong khi cột tên là `notes`, số nhiều. `tsc` không biết gì về schema,
 * `npm test` toàn chốt cấu trúc đọc chuỗi trong mã nguồn, `npm run
 * build` xanh — và cả 3.230 chốt vẫn xanh. Nó chỉ nổ khi chủ nhà bấm
 * Lưu và nhận "Could not find the 'note' column of
 * 'purchase_invoice_lines' in the schema cache". Tức là KHÔNG CÓ chốt
 * nào trong kho mã này canh tên cột của module mua hàng.
 *
 * ⚠ ĐÃ CÓ MỘT CHỐT ĐÚNG KIỂU NÀY RỒI, và tôi không nhân nó ra.
 * `tests/invoice-editor.test.ts` có "câu embed customers dùng cột có
 * thật" — sinh ra sau khi ai đó hỏi `customers(price_group_id)`, một
 * cột không tồn tại. Bài học đó đã được ghi lại mà không được áp dụng
 * cho bảng mới. Tệp này là bản tổng quát: quét MỌI tệp dưới `src/`, so
 * MỌI tên cột với DDL thật.
 *
 * ⚠ ĐỐI CHIẾU VỚI `schema_full.sql`, KHÔNG VỚI TRÍ NHỚ. Đây là chỗ duy
 * nhất trong kho này biết cột nào có thật — và nó gộp cả `CREATE TABLE`
 * lẫn mọi `ALTER TABLE … ADD COLUMN` về sau, nên cột thêm ở migration
 * 142/145 cũng được tính.
 */

const ROOT = resolve(__dirname, "..")
const SCHEMA = readFileSync(resolve(ROOT, "supabase/schema_full.sql"), "utf-8")

/** Bỏ chú thích SQL — DDL có chú thích xen giữa các dòng cột. */
const sqlNoComments = SCHEMA.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n")

/**
 * Tập cột THẬT của một bảng: thân `CREATE TABLE` cộng mọi `ADD COLUMN`.
 *
 * ⚠ PHẢI GỘP CẢ `ADD COLUMN`. Chỉ đọc `CREATE TABLE` là báo sai cho mọi
 * cột thêm bằng migration sau — `receipt_code`, `discount`,
 * `warehouse_zone`, `vat_override`, `line_discount`, `sort_order`…
 */
function columnsOf(table: string): Set<string> {
  const out = new Set<string>()

  const reCreate = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?${table} \\(`,
  )
  const m = reCreate.exec(sqlNoComments)
  expect(m, `không tìm thấy DDL của bảng ${table}`).toBeTruthy()
  const start = m!.index + m![0].length
  const body = sqlNoComments.slice(start, sqlNoComments.indexOf("\n);", start))
  for (const raw of body.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    // Bỏ các dòng ràng buộc, không phải cột.
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i.test(line)) continue
    const w = line.split(/[\s(,]/)[0]
    if (/^[a-z_][a-z0-9_]*$/.test(w)) out.add(w)
  }

  const reAlter = new RegExp(
    `ALTER TABLE (?:ONLY )?${table}\\b([\\s\\S]*?);`,
    "g"
  )
  let a: RegExpExecArray | null
  while ((a = reAlter.exec(sqlNoComments)) !== null) {
    for (const c of Array.from(
      a[1].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/g)
    )) {
      out.add(c[1])
    }
  }
  return out
}

/** Mọi tệp `.ts`/`.tsx` dưới `src/`. */
function allSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) allSourceFiles(p, acc)
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p)
  }
  return acc
}

/**
 * Xoá trắng chú thích nhưng GIỮ NGUYÊN ĐỘ DÀI, để mọi chỉ số ký tự
 * không xê dịch.
 *
 * ⚠ KHÔNG CÓ BƯỚC NÀY THÌ CẢ TỆP CHỐT LÀ VÔ DỤNG, và tôi đã chứng minh
 * điều đó bằng cách dựng lại đúng con bug: `saveReceiptLines` có một
 * dòng `// ⚠ CỘT TÊN LÀ …` ngay TRÊN khoá `notes`. Phép đọc khoá đi
 * qua chú thích, gặp dấu chấm cuối câu và kết luận "đang ở giữa một giá
 * trị", nên khoá ngay sau đó KHÔNG được ghi nhận — đúng khoá cần canh.
 * Bản đầu vì thế vẫn XANH khi tôi đổi `notes` thành `note`.
 *
 * Trớ trêu: những khoá KHÔNG có chú thích thì bắt được. Một chốt bắt
 * được chỗ dễ và bỏ sót chỗ khó là chốt tệ hơn không có, vì nó cho cảm
 * giác đã canh rồi.
 */
function blankComments(src: string): string {
  const out = src.split("")
  let i = 0
  while (i < out.length) {
    const two = src.slice(i, i + 2)
    if (two === "//") {
      while (i < out.length && out[i] !== "\n") { out[i] = " "; i++ }
      continue
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2)
      const stop = end === -1 ? out.length : end + 2
      for (; i < stop; i++) if (out[i] !== "\n") out[i] = " "
      continue
    }
    i++
  }
  return out.join("")
}

const FILES = allSourceFiles(resolve(ROOT, "src")).map((p) => ({
  path: p.slice(ROOT.length + 1),
  src: blankComments(readFileSync(p, "utf-8")),
}))

/**
 * Các bảng TIỀN và KHO của module mua hàng — sai một tên cột ở đây là
 * một phép ghi im lặng hỏng, hoặc một màn hình đọc về `undefined`.
 */
const TABLES = [
  "purchase_invoices",
  "purchase_invoice_lines",
  "supplier_returns",
  "supplier_return_lines",
  "stock_entries",
  "stock_entry_lines",
  "payables",
  "batches",
]

/**
 * Tên cột trong một câu `.select("…")`.
 *
 * ⚠ BỎ PHẦN EMBED `tên:bảng(...)` TRƯỚC. Những cột trong ngoặc thuộc
 * BẢNG KHÁC; kiểm chúng với cột của bảng này là báo sai hàng loạt.
 */
function selectColumns(sel: string): string[] {
  let s = sel
  // Gỡ dần từng nhóm embed, kể cả lồng nhau.
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/[a-z_][a-z0-9_]*:?[a-z_]*\([^()]*\)/g, "")
    if (next === s) break
    s = next
  }
  return s
    .split(",")
    .map((c) => c.trim())
    .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c))
}

/**
 * Khoá ở MỨC NGOÀI CÙNG của một object literal bắt đầu tại `open`.
 *
 * ⚠ PHẢI ĐI THEO CẢ `...helper(...)`. Tải trọng của `save-receipt.ts`
 * gọi `...linePayloadOf(l, i, …)` — tám cột, trong đó có đúng cái `notes`
 * đã làm hỏng phiếu nhập, nằm sau dấu ba chấm ấy. Không đi theo thì chốt
 * này chỉ còn nhìn thấy `invoice_id` / `return_id` và tuyên bố mọi thứ
 * đều ổn. Một chốt bắt chỗ dễ, bỏ sót chỗ khó là chốt tệ hơn không có.
 */
function topLevelKeys(src: string, open: number, depthGuard = 0): string[] {
  const keys: string[] = []
  let depth = 0
  let i = open
  let atKeyPos = true
  for (; i < src.length; i++) {
    const ch = src[i]
    if (ch === "{" || ch === "(" || ch === "[") {
      depth++
      atKeyPos = depth === 1
      continue
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth--
      if (depth === 0) break
      continue
    }
    if (depth === 1) {
      if (ch === ",") { atKeyPos = true; continue }
      if (atKeyPos && ch === ".") {
        const sp = /^\.\.\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i))
        if (sp && depthGuard < 3) keys.push(...returnedKeysOf(src, sp[1], depthGuard + 1))
        atKeyPos = false
        continue
      }
      if (atKeyPos && /[a-z_]/i.test(ch)) {
        const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/.exec(src.slice(i))
        if (m) keys.push(m[1])
        atKeyPos = false
      }
      if (!/\s/.test(ch) && ch !== ",") atKeyPos = atKeyPos && false
    }
  }
  return keys
}

/** Khoá của object mà hàm `name` trong cùng tệp `return {…}`. */
function returnedKeysOf(src: string, name: string, depthGuard: number): string[] {
  const fn = new RegExp(`function\\s+${name}\\s*\\(`).exec(src)
  if (!fn) return []
  const ret = src.indexOf("return {", fn.index)
  if (ret === -1) return []
  return topLevelKeys(src, ret + "return ".length, depthGuard)
}

interface Use {
  file: string
  table: string
  kind: "select" | "insert" | "update"
  columns: string[]
}

/** Mọi lượt dùng bảng trong `src/`. */
const USES: Use[] = (() => {
  const out: Use[] = []
  for (const { path, src } of FILES) {
    for (const table of TABLES) {
      const marker = `.from("${table}")`
      let at = src.indexOf(marker)
      while (at !== -1) {
        // Chuỗi nối sau `.from(...)` cho tới khi hết biểu thức.
        const tail = src.slice(at, at + 2000)

        const after = tail.slice(marker.length)

        /**
         * ⚠ KHÔNG DÙNG CỜ `m`. Bản đầu có nó, và `^` thành "đầu BẤT KỲ
         *   dòng nào" — nên phép quét nhặt một `.select(...)` của câu
         *   truy vấn KHÁC nằm dưới vài chục dòng và gán nhầm cột của
         *   bảng kia sang bảng này. Nó báo sai bảy cột hoàn toàn lành ở
         *   `src/lib/returns.ts`. `.select` phải đi LIỀN sau `.from`.
         */
        const sel = /^\s*\.select\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(after)
        if (sel) out.push({ file: path, table, kind: "select", columns: selectColumns(sel[1]) })

        for (const verb of ["insert", "update"] as const) {
          const inline = new RegExp(`^\\s*\\.${verb}\\(\\s*\\{`).exec(after)
          if (inline) {
            const open = at + marker.length + inline[0].length - 1
            out.push({ file: path, table, kind: verb, columns: topLevelKeys(src, open) })
            continue
          }
          /**
           * ⚠ PHẢI ĐI THEO CẢ TẢI TRỌNG DỰNG SẴN — `insert(payload)`.
           *   Bản đầu chỉ đọc object viết thẳng trong lời gọi, nên nó
           *   KHÔNG BẮT ĐƯỢC chính con bug vừa xảy ra: `saveReceiptLines`
           *   dựng `payload` bằng `.map()` rồi mới `insert(payload)`.
           *   Một chốt bỏ sót đúng chỗ vừa hỏng là chốt vô dụng.
           */
          const byVar = new RegExp(`^\\s*\\.${verb}\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)`).exec(after)
          if (byVar) {
            /**
             * ⚠ LẤY KHAI BÁO GẦN NHẤT Ở TRÊN, không lấy cái ĐẦU TIÊN
             *   trong tệp. `save-receipt.ts` từng có hai biến cùng tên
             *   `payload` — một cho `purchase_invoice_lines`, một cho
             *   `supplier_return_lines` — và phép tìm từ đầu tệp gán cột
             *   của bảng này sang bảng kia. Nó báo sai `invoice_id` ở
             *   bảng phiếu trả; lần sau nó sẽ im lặng cho qua một cột
             *   gõ sai thật.
             */
            const declRe = new RegExp(`\\b(?:const|let|var)\\s+${byVar[1]}\\b`, "g")
            let decl: RegExpExecArray | null = null
            let d: RegExpExecArray | null
            while ((d = declRe.exec(src)) !== null) {
              if (d.index > at) break
              decl = d
            }
            if (decl) {
              const brace = src.indexOf("({", decl.index)
              if (brace !== -1 && brace - decl.index < 400) {
                out.push({
                  file: path, table, kind: verb,
                  columns: topLevelKeys(src, brace + 1),
                })
              }
            }
          }
        }
        at = src.indexOf(marker, at + 1)
      }
    }
  }
  return out
})()

// =====================================================================

describe("tên cột của module mua hàng phải có thật trong schema", () => {
  it("đọc được DDL, và tập cột không rỗng", () => {
    // Nếu phép cắt DDL hỏng thì mọi chốt dưới thành vô nghĩa.
    for (const t of TABLES) {
      expect(columnsOf(t).size, `tập cột của ${t} rỗng — phép cắt DDL hỏng`).toBeGreaterThan(4)
    }
    /* ⚠ Chính cái cột đã làm hỏng phiếu nhập: có `notes`, không có `note`. */
    const lines = columnsOf("purchase_invoice_lines")
    expect(lines.has("notes")).toBe(true)
    expect(lines.has("note"), "schema có cột `note`? chốt dưới đang canh nhầm thứ").toBe(false)
    /* Cột thêm bằng ALTER ở migration 142/145 cũng phải được tính. */
    expect(lines.has("line_discount")).toBe(true)
    expect(lines.has("sort_order")).toBe(true)
    expect(columnsOf("purchase_invoices").has("vat_override")).toBe(true)
    expect(columnsOf("purchase_invoices").has("receipt_code")).toBe(true)
  })

  it("quét được các lượt dùng bảng trong src/", () => {
    // Không quét ra gì thì chốt dưới xanh vì rỗng, không vì đúng.
    expect(USES.length, "không quét ra lượt dùng nào — phép quét hỏng").toBeGreaterThan(15)
    expect(
      USES.some((u) => u.table === "purchase_invoice_lines" && u.kind === "insert"),
      "không thấy phép ghi dòng phiếu nhập — đúng chỗ vừa hỏng"
    ).toBe(true)
  })

  it("mọi tên cột dùng trong src/ đều có thật", () => {
    const cols = new Map(TABLES.map((t) => [t, columnsOf(t)]))
    const bad: string[] = []
    for (const u of USES) {
      for (const c of u.columns) {
        if (!cols.get(u.table)!.has(c)) {
          bad.push(`${u.file}: ${u.kind} ${u.table}.${c}`)
        }
      }
    }
    expect(
      bad,
      "Tên cột không có trong schema — PostgREST sẽ từ chối, và không có " +
        "gì khác bắt được:\n  " + bad.join("\n  ")
    ).toEqual([])
  })
})
