import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * GIÁ TRỊ MỘT HOOK TRẢ VỀ, NẾU ĐƯỢC NHÉT NGUYÊN VÀO MẢNG PHỤ THUỘC,
 * PHẢI CÓ DANH TÍNH ỔN ĐỊNH.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Sao vào danh sách đơn hàng với hóa đơn
 * trống trơn rồi". Không một dòng lỗi nào, không một ô trống có chữ —
 * hai màn quan trọng nhất hiện ra rỗng trên máy chủ thật.
 *
 * NGUYÊN NHÂN. `useListSearch` trả thẳng `{ filter, ready, truncated }`
 * — một object MỚI ở mỗi lần vẽ lại. Sáu màn đặt `listSearch` vào mảng
 * phụ thuộc của effect nạp danh sách. React so sánh mảng phụ thuộc bằng
 * `Object.is`, nên effect chạy lại ở MỌI lần vẽ; hàm dọn dẹp của lượt
 * trước đặt `cancelled = true` trước khi `await` của nó kịp về, và câu
 * `if (cancelled) return` chặn luôn `setOrders(...)`. Danh sách không
 * bao giờ được ghi.
 *
 * ⚠ VÌ SAO KHÔNG CHỐT BẰNG CÁCH VẼ THỬ HOOK. `vitest.config` chạy
 * `environment: "node"` và kho này KHÔNG có jsdom / testing-library —
 * thêm vào là phá luật "không thêm lib". Nên chốt này đọc mã: nó dựng
 * danh sách hook tự viết cùng hình dạng giá trị trả về, rồi soi mọi màn
 * xem có ai nhét một giá trị KHÔNG ổn định vào mảng phụ thuộc không.
 *
 * ⚠ CHỐT THEO LUẬT CHUNG, KHÔNG THEO MỘT HOOK. Sửa riêng
 * `useListSearch` thì lần sau một hook khác mắc đúng lỗi ấy vẫn lọt.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * Hook tự viết nào trả về một object/mảng DỰNG TẠI CHỖ.
 *
 * ⚠ SOI `return` Ở THÂN HÀM, KHÔNG SOI CẢ TỆP. Mốc là thụt vào đúng
 * hai dấu cách — `return {` nằm sâu hơn là của một callback bên trong
 * (`.map(r => { return {...} })`), không phải giá trị hook trả ra.
 */
function unstableHooks(): Map<string, string> {
  const out = new Map<string, string>()
  const dir = resolve(ROOT, "src/hooks")
  for (const name of readdirSync(dir)) {
    const src = strip(readFileSync(join(dir, name), "utf-8"))
    const decl = /export function (use[A-Za-z0-9_]*)\s*[(<]/g
    let m: RegExpExecArray | null
    while ((m = decl.exec(src))) {
      const body = src.slice(m.index)
      const rets = body.match(/^ {2}return [\s\S]{0,4}/gm) ?? []
      const literal = rets.some((r) => /^ {2}return \s*[{[]/.test(r))
      if (literal) out.set(m[1], name)
    }
  }
  return out
}

/** Mọi tệp giao diện — màn hình lẫn thành phần dùng chung. */
function allTsx(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) allTsx(p, acc)
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) acc.push(p)
  }
  return acc
}

interface Usage {
  file: string
  /** Tên biến nhận giá trị hook trả về. */
  name: string
  hook: string
}

/** Mọi chỗ một giá trị hook trả về nằm TRẦN trong một mảng phụ thuộc. */
function bareInDeps(customHooks: Set<string>): Usage[] {
  const out: Usage[] = []
  const seen = new Set<string>()
  for (const base of ["src/app", "src/components"]) {
    for (const abs of allTsx(resolve(ROOT, base))) {
      const src = strip(readFileSync(abs, "utf-8"))
      const rel = abs.slice(ROOT.length + 1)
      const assigns = new Map<string, string>()
      const asg = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(use[A-Za-z0-9_]*)\s*[(<]/g
      let a: RegExpExecArray | null
      while ((a = asg.exec(src))) {
        if (customHooks.has(a[2])) assigns.set(a[1], a[2])
      }
      if (assigns.size === 0) continue
      /* Mảng phụ thuộc của `useEffect` / `useMemo` / `useCallback`:
         dấu `}` đóng thân hàm, rồi `, [ … ])`. */
      const deps = /\}\s*,\s*\[([^\]]*)\]\s*\)/g
      let d: RegExpExecArray | null
      while ((d = deps.exec(src))) {
        for (const raw of d[1].split(",")) {
          const name = raw.trim()
          const hook = assigns.get(name)
          if (!hook) continue
          const key = `${rel}|${name}|${hook}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ file: rel, name, hook })
        }
      }
    }
  }
  return out
}

/** Mọi hook tự viết, kể cả hook trả về giá trị ổn định. */
function allCustomHooks(): Set<string> {
  const out = new Set<string>()
  const dir = resolve(ROOT, "src/hooks")
  for (const name of readdirSync(dir)) {
    const src = strip(readFileSync(join(dir, name), "utf-8"))
    for (const m of Array.from(src.matchAll(/export function (use[A-Za-z0-9_]*)\s*[(<]/g))) {
      out.add(m[1])
    }
  }
  return out
}

describe("hook trả về object thì phải giữ nguyên danh tính", () => {
  /**
   * ⚠ LUẬT CHUNG. Không quan trọng hook nào — hễ giá trị nó trả ra được
   * nhét TRẦN vào một mảng phụ thuộc thì giá trị ấy phải ổn định.
   */
  it("không màn nào nhét giá trị đổi-mỗi-lần-vẽ vào mảng phụ thuộc", () => {
    const unstable = unstableHooks()
    const uses = bareInDeps(allCustomHooks())
    const bad = uses.filter((u) => unstable.has(u.hook))
    expect(
      bad.map((u) => `${u.file}: ${u.name} = ${u.hook}() (src/hooks/${unstable.get(u.hook)})`),
      "hook trả về object/mảng dựng tại chỗ mà lại nằm trần trong mảng phụ " +
        "thuộc — effect chạy lại ở mọi lần vẽ, lượt trước bị huỷ trước khi " +
        "kịp ghi dữ liệu, và màn hình trống trơn không một dòng lỗi:\n  " +
        bad.map((u) => `${u.file}: ${u.name} = ${u.hook}()`).join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ CHỐT PHẢI NHÌN THẤY GÌ ĐÓ. Một biểu thức chính quy gõ hỏng thì
   * `bad` rỗng và chốt trên XANH vĩnh viễn — đúng kiểu chốt nói dối đã
   * để lọt lỗi này. Sáu màn danh sách có đặt `listSearch` vào mảng phụ
   * thuộc; nếu phép quét không còn thấy chúng thì phép quét hỏng, không
   * phải kho mã sạch.
   */
  it("phép quét thật sự nhìn thấy sáu màn dùng useListSearch", () => {
    const uses = bareInDeps(allCustomHooks()).filter((u) => u.hook === "useListSearch")
    expect(uses.length, "phép quét mảng phụ thuộc hỏng — không thấy màn nào").toBeGreaterThanOrEqual(6)
  })

  /**
   * ⚠ VÀ PHẢI NHÌN THẤY CẢ HOOK KHÔNG ỔN ĐỊNH. `unstableHooks()` mà
   * luôn trả về rỗng thì chốt trên cũng xanh vĩnh viễn. Kho này có sẵn
   * vài hook trả object trần — chúng vô hại vì KHÔNG ai nhét trần vào
   * mảng phụ thuộc, nhưng chúng là bằng chứng phép nhận dạng còn chạy.
   */
  it("phép nhận dạng hook không ổn định còn chạy", () => {
    const unstable = unstableHooks()
    expect(
      Array.from(unstable.keys()).sort(),
      "không nhận ra hook nào trả object trần — phép nhận dạng hỏng"
    ).toContain("usePagination")
  })
})

describe("useListSearch giữ nguyên danh tính giá trị trả về", () => {
  const SRC = strip(read("src/hooks/use-list-search.ts"))

  /**
   * ⚠ ĐÚNG BA GIÁ TRỊ TRONG MẢNG PHỤ THUỘC CỦA `useMemo`. Thiếu một
   * cái là giá trị trả ra CŨ so với luồng dữ liệu — tệ hơn cả lỗi ban
   * đầu, vì màn hình lọc bằng một từ khoá không còn đúng mà vẫn hiện ra
   * như bình thường.
   */
  it("trả về qua useMemo, phụ thuộc đủ filter/ready/truncated", () => {
    const m = SRC.match(/return useMemo\(\(\) => \(\{([^}]*)\}\), \[([^\]]*)\]\)/)
    expect(m, "useListSearch không trả về qua useMemo nữa").not.toBeNull()
    const fields = m![1].split(",").map((s) => s.trim()).filter(Boolean)
    const deps = m![2].split(",").map((s) => s.trim()).filter(Boolean)
    for (const f of ["filter", "ready", "truncated"]) {
      expect(fields, `thiếu trường ${f}`).toContain(f)
      expect(deps, `thiếu ${f} trong mảng phụ thuộc của useMemo`).toContain(f)
    }
  })

  it("không trả thẳng một object dựng tại chỗ", () => {
    expect(
      / {2}return \s*\{/.test(SRC),
      "trả thẳng `{ … }` là object mới mỗi lần vẽ — xem lại sự cố 21/09/2026"
    ).toBe(false)
  })
})
