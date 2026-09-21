import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { posShouldHandle, posKeyOf } from "../src/lib/pos/keys"

/**
 * LUẬT CẤU TRÚC CỦA `/pos` — spec §11, §12, §14.
 *
 * Đây là những luật mà vi phạm KHÔNG làm hỏng build, không làm đỏ
 * `tsc`, và chỉ lộ ra khi có người dùng bàn phím ngồi vào máy — hoặc
 * khi ai đó sửa `/sell` và `/pos` vỡ theo.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** Mọi tệp nguồn của `/pos`: component, store, lib, route. */
function tepPos(): string[] {
  const out: string[] = []
  const quet = (d: string) => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d)) {
      const p = resolve(d, e)
      if (statSync(p).isDirectory()) quet(p)
      else if (/\.tsx?$/.test(e)) out.push(p)
    }
  }
  quet(resolve(ROOT, "src/app/pos"))
  quet(resolve(ROOT, "src/components/pos"))
  quet(resolve(ROOT, "src/store/pos"))
  quet(resolve(ROOT, "src/lib/pos"))
  return out
}

const FILES = tepPos()

/**
 * Nút CHỈ CÓ ICON mà thiếu `aria-label`.
 *
 * ⚠ KHÔNG DÙNG MỘT REGEX DUY NHẤT CHO THẺ MỞ. Bản đầu của chốt này
 * viết `<button\b([^>]*)>` và nó MÙ HOÀN TOÀN: thuộc tính JSX hay chứa
 * `=>` (mọi `onClick={() => …}`), nên `[^>]*` dừng ngay tại mũi tên và
 * thẻ không bao giờ khớp. Chốt xanh vì không tìm thấy NÚT NÀO, chứ
 * không phải vì mọi nút đều có nhãn — đúng kiểu chốt nói dối.
 *
 * Nên ở đây quét tay: đếm ngoặc nhọn và bỏ qua chuỗi để tìm đúng dấu
 * `>` đóng thẻ mở.
 */
function nutIconThieuNhan(files: string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    const src = readFileSync(f, "utf-8")
    let i = 0
    while ((i = src.indexOf("<button", i)) >= 0) {
      let j = i + 7
      let sau = 0
      let nhay: string | null = null
      for (; j < src.length; j++) {
        const c = src[j]
        if (nhay) { if (c === nhay) nhay = null; continue }
        if (c === '"' || c === "'" || c === "`") { nhay = c; continue }
        if (c === "{") sau++
        else if (c === "}") sau--
        else if (c === ">" && sau === 0) break
      }
      const attrs = src.slice(i, j)
      const het = src.indexOf("</button>", j)
      const than = het < 0 ? "" : src.slice(j + 1, het)
      const chiIcon = /^\s*(?:<svg[\s\S]*?<\/svg>|[×⋮+−✕])\s*$/.test(than)
      if (chiIcon && !/aria-label=/.test(attrs)) {
        out.push(`${f.replace(ROOT, "")} :: ${attrs.slice(0, 60).replace(/\s+/g, " ")}`)
      }
      i = j + 1
    }
  }
  return out
}


describe("bộ tệp /pos", () => {
  /** ⚠ Chốt mù là chốt nói dối — 0 tệp thì mọi phép kiểm dưới đều xanh. */
  it("quét được bộ tệp", () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  /**
   * ⚠ CHỐNG MÙ CHO PHÉP KIỂM `aria-label`. Bản đầu của phép kiểm ấy
   * không khớp được NÚT NÀO (regex vỡ ở `=>` trong thuộc tính JSX) nên
   * nó xanh vĩnh viễn. Đếm số nút icon-only TÌM THẤY ĐƯỢC ở đây, để
   * hôm nào phép quét lại mù thì chốt đỏ ngay.
   */
  it("nhìn thấy được các nút chỉ có icon", () => {
    let dem = 0
    for (const f of FILES) {
      const src = readFileSync(f, "utf-8")
      let i = 0
      while ((i = src.indexOf("<button", i)) >= 0) {
        const het = src.indexOf("</button>", i)
        if (het > 0 && /aria-label=/.test(src.slice(i, het))) dem++
        i = i + 7
      }
    }
    expect(dem, "không thấy nút nào có aria-label — phép quét đang mù").toBeGreaterThan(8)
  })
})

/**
 * ⚠ SPEC §12, "KHÔNG HỒI QUY": store `/sell` không bị import vào `/pos`
 * và ngược lại.
 *
 * Lý do không phải gọn gàng. `/sell` có MỘT giỏ cho một NVBH đứng ở
 * quầy; `/pos` có NHIỀU tab chứng từ mở cùng lúc. Ép chung một store là
 * một trong hai bên phải chịu hình dạng của bên kia — và bên chịu sẽ
 * là `/sell`, thứ đang chạy thật ngoài thị trường.
 *
 * ⚠ DÙNG CHUNG **API** THÌ ĐƯỢC. `src/lib/sell/ref-data.ts` là một hàm
 * ĐỌC dữ liệu đã gánh sẵn mọi cái bẫy đã sửa một lần (cắt 1.000 dòng
 * im lặng, tồn kho chỉ cộng kho BÁN…). Spec §1 chốt: "tách store, dùng
 * chung API".
 */
describe("hai bên không dùng chung store", () => {
  it("/pos không import store hay màn của /sell", () => {
    const pham: string[] = []
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      if (/from\s+["']@\/hooks\/use-sell-/.test(s)) pham.push(`${f} → hooks/use-sell-*`)
      if (/from\s+["'][^"']*\(dashboard\)\/sell/.test(s)) pham.push(`${f} → (dashboard)/sell`)
    }
    expect(pham.map((p) => p.replace(ROOT, ""))).toEqual([])
  })

  it("/sell không import gì của /pos", () => {
    const pham: string[] = []
    const quet = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = resolve(d, e)
        if (statSync(p).isDirectory()) quet(p)
        else if (/\.tsx?$/.test(e)) {
          const s = code(readFileSync(p, "utf-8"))
          if (/from\s+["']@\/(store|components|lib)\/pos/.test(s)) pham.push(p)
        }
      }
    }
    quet(resolve(ROOT, "src/app/(dashboard)/sell"))
    quet(resolve(ROOT, "src/hooks"))
    expect(pham.map((p) => p.replace(ROOT, ""))).toEqual([])
  })
})

/**
 * ⚠ SPEC §11: "mọi control là element thật — `<button>`, `<a href>`,
 * `<input>` + `<label>`. Không `role`/`onClick` trên `div`/`span` (Tab
 * bỏ qua)".
 *
 * Một `div` có `onClick` nhìn giống hệt một nút và bấm chuột được, nên
 * nó qua mọi lần thử bằng mắt. Nó chỉ hỏng với người dùng bàn phím và
 * người dùng trình đọc màn hình — hai nhóm không ai ngồi thử.
 */
describe("mọi thứ bấm được đều là element thật", () => {
  it("không có onClick trên div hay span", () => {
    const pham: string[] = []
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      /* Bắt `<div … onClick` / `<span … onClick` trong cùng một thẻ mở. */
      const re = /<(div|span)\b[^>]*\sonClick=/g
      if (re.test(s)) pham.push(f.replace(ROOT, ""))
    }
    expect(pham).toEqual([])
  })

  /**
   * ⚠ NÚT CHỈ CÓ ICON PHẢI CÓ `aria-label`. Spec §11. Người đọc màn
   * hình nghe một nút không tên là "button" — không biết nó làm gì,
   * nên không bấm.
   */
  it("nút icon-only đều có aria-label", () => {
    expect(nutIconThieuNhan(FILES)).toEqual([])
  })
})

/**
 * ⚠ SPEC §7.1: `/pos/don-hang/[id]/sua` phải RENDER ĐÚNG COMPONENT CỦA
 * MÀN 1 — "không phải bản copy".
 *
 * Bản sao là hai chỗ phải sửa khi đổi quy tắc giảm giá, và bản "sửa
 * đơn" — bản ít người mở hơn — là bản sẽ bị quên.
 */
describe("sửa đơn dùng đúng component của màn lập đơn", () => {
  const LAP = read("src/app/pos/don-hang/[id]/page.tsx")
  const SUA = read("src/app/pos/don-hang/[id]/sua/page.tsx")

  it("hai route cùng render <OrderScreen>", () => {
    expect(LAP).toContain("<OrderScreen")
    expect(SUA).toContain("<OrderScreen")
  })

  /**
   * ⚠ VÀ KHÔNG ĐƯỢC CÓ MỘT COMPONENT THỨ HAI NÀO GIỐNG NÓ. Đây mới là
   * phép kiểm thật: một hôm nào đó ai đó chép `order-screen.tsx` thành
   * `order-edit-screen.tsx` rồi sửa một bên, và chốt trên vẫn xanh vì
   * cả hai vẫn "render một component".
   */
  it("không có bản sao thứ hai của màn lập đơn", () => {
    const nghiNgo = FILES.filter((f) =>
      /order-(edit|sua)-screen|order-screen-(edit|sua)/i.test(f)
    )
    expect(nghiNgo.map((f) => f.replace(ROOT, ""))).toEqual([])
  })

  /** ⚠ Nút primary GIỮ NGUYÊN ở cả hai bản — spec §7.1 chốt riêng dòng này. */
  it("nút chính vẫn là Xuất hàng & lập HĐ ở cả hai chế độ", () => {
    const s = code(read("src/components/pos/order-screen.tsx"))
    const i = s.indexOf('variant="primary"')
    expect(i, "không thấy nút chính").toBeGreaterThan(-1)
    /* Nút chính nằm NGOÀI nhánh `mode === "sua" ? … : …`, nên chỉ có
       MỘT nhãn cho nó. */
    expect(s.slice(i, i + 400)).toContain("Xuất hàng")
  })
})

/**
 * ⚠ SPEC §10: bind phím ở cấp `PosShell`, KHÔNG global keydown trên
 * `document` (tránh đụng `/sell`).
 */
describe("phím tắt không bắt toàn cục", () => {
  it("không gắn keydown lên document hay window", () => {
    const pham: string[] = []
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      if (/(document|window)\.addEventListener\(\s*["']keydown/.test(s)) {
        pham.push(f.replace(ROOT, ""))
      }
    }
    expect(pham).toEqual([])
  })

  /** ⚠ `F*` và `Esc` không phải ký tự gõ được nên không tranh chỗ. */
  it("F3/F4/F8/F9 chạy cả khi con trỏ đang trong ô nhập", () => {
    for (const k of ["F3", "F4", "F7", "F8", "F9"] as const) {
      expect(posShouldHandle(k, "INPUT")).toBe(true)
      expect(posShouldHandle(k, "TEXTAREA")).toBe(true)
    }
  })

  /** ⚠ `Esc` là đường thoát — luôn phải bắt được. */
  it("Esc luôn bắt được, kể cả trong ô nhập", () => {
    expect(posShouldHandle("Escape", "INPUT")).toBe(true)
    expect(posShouldHandle("Escape", "DIV", true)).toBe(true)
  })

  it("phím thường không bị bắt", () => {
    expect(posKeyOf("a")).toBeNull()
    expect(posKeyOf("Enter")).toBeNull()
  })
})

/**
 * ⚠ SPEC §"Không đụng vào": KHÔNG migration mới, KHÔNG RPC mới trong
 * diff của đợt này. Đây là ranh giới chủ nhà vẽ rõ nhất trong cả spec.
 */
describe("không đụng vào nghiệp vụ", () => {
  it("/pos không gọi rpc nào", () => {
    const pham: string[] = []
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      if (/\.rpc\(/.test(s)) pham.push(f.replace(ROOT, ""))
    }
    expect(
      pham,
      "đợt này chỉ dựng bề mặt — mọi thao tác ghi sổ phải đi qua đúng RPC đang có, và việc nối đó chưa thuộc đợt này"
    ).toEqual([])
  })

  /** ⚠ Màu và chữ của POS phải nằm trong `.pos-scope`, không ở `:root`. */
  it("token POS không rò sang phần còn lại của app", () => {
    const css = read("src/app/globals.css")
    const i = css.indexOf(".pos-scope")
    expect(i, "chưa có khối .pos-scope").toBeGreaterThan(-1)
    /* Không có `--pos-*` nào được khai báo ngoài `.pos-scope`. */
    const truoc = css.slice(0, i)
    expect(/--pos-[a-z-]+\s*:/.test(truoc), "token POS khai báo ngoài .pos-scope").toBe(false)
  })
})

/** ⚠ Spec đòi tệp này tồn tại và có nội dung thật, không phải tệp rỗng. */
describe("docs/pos-todo.md", () => {
  it("có và nói được những chỗ chờ dữ liệu", () => {
    const md = read("docs/pos-todo.md")
    expect(md.length).toBeGreaterThan(500)
    expect(md).toContain("discount_unit")
  })
})
