import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import { errorMessage } from "../src/lib/errors"

/**
 * KHÔNG ĐƯỢC NUỐT NGUYÊN NHÂN LỖI.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "khi sửa đơn thêm hàng đổi trả thì ko lưu
 * được đơn hàng. báo lỗi ko xác định".
 *
 * "Lỗi không xác định" ở đây KHÔNG phải một lỗi — nó là chỗ màn hình
 * VỨT ĐI nguyên nhân thật. Màn giỏ hàng bắt lỗi bằng
 *
 *     err instanceof Error ? err.message : "Lỗi không xác định"
 *
 * mà lỗi của PostgREST và của trigger Postgres là một OBJECT THƯỜNG
 * `{ message, code, details, hint }`, KHÔNG phải `Error`. Nên mọi lời
 * từ chối của cơ sở dữ liệu — kể cả những câu tiếng Việt viết sẵn rất
 * rõ như `RETURN_QTY_EXCEEDS: "…" — đã bán X, đã trả Y, dòng này thêm
 * Z là vượt` — đều biến thành đúng bốn chữ vô nghĩa.
 *
 * Hậu quả không chỉ là khó đọc: KHÔNG AI CHẨN ĐOÁN ĐƯỢC NỮA. Chủ nhà
 * báo lỗi, tôi không lần ra được vì thông tin đã bị xoá ngay tại chỗ.
 *
 * ⚠ KHO MÃ NÀY ĐÃ CÓ SẴN `errorMessage()` LÀM ĐÚNG VIỆC ẤY — nó đọc
 * `message`/`code`/`details`/`hint`, dịch mã lỗi quen thuộc sang tiếng
 * Việt, và LUÔN kèm nguyên văn để người hỗ trợ lần được. Mười bảy chỗ
 * đã bỏ qua nó.
 */

const ROOT = resolve(__dirname, "..")

function moiNguon(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) moiNguon(p, acc)
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) acc.push(p)
  }
  return acc
}

/**
 * ⚠ CHỈ SOI NƠI CÓ GỌI CƠ SỞ DỮ LIỆU. Một `catch` quanh `JSON.parse`
 * hay quanh API camera thì `instanceof Error` là đủ và đúng — bắt cả
 * những chỗ ấy là một chốt kêu oan, và chốt kêu oan sẽ bị nới ra.
 */
const MIEN_TRU = [
  /* Màn gỡ rối nội bộ: in RA nguyên văn bằng `String(err)`, không
     nuốt gì cả. */
  "src/app/debug/page.tsx",
]

describe("lỗi từ cơ sở dữ liệu phải giữ được nguyên nhân", () => {
  it("không màn nào thay lỗi PostgREST bằng một câu chung chung", () => {
    const bad: string[] = []
    for (const base of ["src/app", "src/components", "src/lib", "src/hooks"]) {
      for (const abs of moiNguon(resolve(ROOT, base))) {
        const rel = abs.slice(ROOT.length + 1)
        if (MIEN_TRU.includes(rel)) continue
        const src = readFileSync(abs, "utf-8")
        /* Chỗ không đụng cơ sở dữ liệu thì `instanceof Error` là đủ. */
        if (!src.includes("supabase") && !src.includes("createClient")) continue
        const re = /(\w+) instanceof Error \? \1\.message :/g
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) {
          const line = src.slice(0, m.index).split("\n").length
          bad.push(`${rel}:${line}`)
        }
      }
    }
    expect(
      bad,
      "đang vứt nguyên nhân lỗi của cơ sở dữ liệu. Lỗi PostgREST và lỗi " +
        "trigger là OBJECT THƯỜNG chứ không phải `Error`, nên nhánh này " +
        "luôn rơi vào câu dự phòng và người dùng chỉ thấy bốn chữ vô " +
        "nghĩa. Dùng `errorMessage(err, \"câu dự phòng\")`:\n  " +
        bad.join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ VÀ `errorMessage` PHẢI THẬT SỰ ĐỌC ĐƯỢC HÌNH DẠNG ẤY. Chốt trên
   * chỉ canh nơi GỌI; nếu hàm được gọi cũng chịu thua cái object kia
   * thì người dùng vẫn thấy bốn chữ vô nghĩa, chỉ là ở một chỗ khác.
   */
  it("errorMessage đọc được lỗi trigger Postgres", () => {
    const loiTrigger = {
      message: 'RETURN_QTY_EXCEEDS: "Bắp nếp tím" — đã bán 20, đã trả 0, dòng này thêm 50 là vượt',
      code: "P0001",
      details: null,
      hint: null,
    }
    const out = errorMessage(loiTrigger)
    expect(out, "nuốt mất câu của trigger").toContain("đã bán 20")
    expect(out, "không kèm mã lỗi để lần ra").toContain("P0001")
    expect(out).not.toBe("Lỗi không xác định")
  })

  /** ⚠ Và lỗi RLS — 0 dòng thì im, nhưng INSERT bị từ chối thì có mã. */
  it("errorMessage đọc được lỗi RLS", () => {
    const out = errorMessage({
      message: "new row violates row-level security policy for table \"return_lines\"",
      code: "42501",
    })
    expect(out).not.toBe("Lỗi không xác định")
    expect(out).toContain("42501")
  })

  /** ⚠ `Error` thường vẫn phải chạy y như cũ — không đổi hành vi sẵn có. */
  it("Error thường vẫn giữ nguyên câu của nó", () => {
    expect(errorMessage(new Error("Không xoá được dòng hàng cũ"))).toContain(
      "Không xoá được dòng hàng cũ"
    )
  })

  /** ⚠ Và câu dự phòng vẫn dùng được khi thật sự không có gì để đọc. */
  it("không có gì để đọc thì dùng đúng câu dự phòng đã truyền", () => {
    expect(errorMessage(undefined, "Lỗi khi lưu")).toBe("Lỗi khi lưu")
    expect(errorMessage({}, "Lỗi khi lưu")).toBe("Lỗi khi lưu")
  })
})
