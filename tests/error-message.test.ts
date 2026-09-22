import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import { errorMessage } from "../src/lib/errors"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function sources(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && statSync(p).isFile()) {
        out.push({ rel: p.slice(ROOT.length + 1), src: code(readFileSync(p, "utf-8")) })
      }
    }
  }
  walk(resolve(ROOT, "src"))
  return out
}

/** Lỗi Supabase trả về ĐÚNG như thật: object thuần, KHÔNG phải `Error`. */
const pgError = (over: Record<string, unknown> = {}) => ({
  code: "23505",
  details: "Key (org_id, phone)=(o1, 0987361271) already exists.",
  hint: null,
  message: 'duplicate key value violates unique constraint "customers_org_id_phone_key"',
  ...over,
})

describe("Lỗi của Supabase không phải Error — và đó là gốc của “Có lỗi xảy ra”", () => {
  /**
   * ⚠ ĐÂY LÀ LỖI CỦA CHÍNH CHÚNG TA, KHÔNG PHẢI CỦA NGƯỜI DÙNG. PostgREST
   * trả về một object thuần đọc thẳng từ JSON; lớp `PostgrestError` chỉ
   * được dựng khi gọi `.throwOnError()`. Nên `throw error` rồi bắt lại
   * bằng `err instanceof Error ? err.message : "Có lỗi xảy ra"` LUÔN rơi
   * vào vế `else` — người dùng nhận đúng bốn chữ vô nghĩa, còn nguyên nhân
   * thật nằm im trong object không ai mở ra.
   */
  it("object thuần của PostgREST không qua nổi phép kiểm instanceof", () => {
    expect(pgError() instanceof Error).toBe(false)
  })

  it("nhưng vẫn lấy ra được nguyên văn", () => {
    expect(errorMessage(pgError())).toContain("duplicate key value")
  })

  /** Mã lỗi phải còn lại — đó là thứ người hỗ trợ lần theo. */
  it("giữ cả mã lỗi", () => {
    expect(errorMessage(pgError())).toContain("23505")
  })
})

describe("Dịch sang câu người dùng hiểu, KHÔNG vứt nguyên văn", () => {
  /**
   * ⚠ Ca đáng nói nhất: TRÙNG SỐ ĐIỆN THOẠI MÀ KHÔNG NHÌN THẤY. Phép kiểm
   * trùng ở màn thêm khách chạy qua RLS — NVBH chỉ thấy khách được phân
   * công, nên khách trùng của người khác trả về 0 dòng và phép kiểm nói
   * "không trùng". Đến lúc ghi thì `UNIQUE(org_id, phone)` mới chặn. Không
   * giải thích thì nhân viên tìm mãi trong danh sách không thấy ai dùng số
   * đó, mà vẫn không lưu được.
   */
  it("trùng số điện thoại khách được giải thích đúng hoàn cảnh", () => {
    const m = errorMessage(pgError())
    expect(m).toContain("Số điện thoại này đã có khách hàng khác dùng")
    expect(m).toContain("nhân viên khác phụ trách")
    // ⚠ Nguyên văn vẫn phải còn: dịch xong vứt bản gốc là đổi một câu khó
    // hiểu lấy một câu dễ hiểu nhưng SAI khi đoán trượt.
    expect(m).toContain("customers_org_id_phone_key")
  })

  it("RLS từ chối thì nói là không có quyền", () => {
    const m = errorMessage({
      code: "42501",
      message: 'new row violates row-level security policy for table "customers"',
    })
    expect(m).toContain("không có quyền")
    expect(m).toContain("row-level security")
  })

  /** Câu RLS của Postgres không phải lúc nào cũng kèm mã — nhận bằng nội dung. */
  it("nhận ra RLS cả khi không có mã", () => {
    expect(
      errorMessage({ message: "new row violates row-level security policy" })
    ).toContain("không có quyền")
  })

  it("thiếu cột thì chỉ thẳng vào migration", () => {
    const m = errorMessage({ code: "PGRST204", message: "Column 'foo' not found" })
    expect(m).toContain("chưa chạy migration")
  })

  it("hết phiên thì bảo đăng nhập lại", () => {
    expect(errorMessage({ code: "PGRST301", message: "JWT expired" })).toContain(
      "Đăng nhập lại"
    )
  })

  it("mã lạ thì vẫn đưa nguyên văn, không nuốt", () => {
    const m = errorMessage({ code: "XX999", message: "internal error" })
    expect(m).toContain("internal error")
    expect(m).toContain("XX999")
  })
})

describe("Không bao giờ trả về một câu rỗng", () => {
  /**
   * ⚠ Rỗng còn tệ hơn "Có lỗi xảy ra": toast hiện một ô trống, trông như
   * màn hình vỡ chứ không như một thông báo.
   */
  it.each([
    [null],
    [undefined],
    [{}],
    [""],
    [{ message: "" }],
    [{ message: null }],
  ])("%s vẫn ra chữ", (input) => {
    expect(errorMessage(input).trim().length).toBeGreaterThan(0)
  })

  it("Error thường thì giữ nguyên lời của nó", () => {
    expect(errorMessage(new Error("Không xoá được dòng hàng cũ"))).toContain(
      "Không xoá được dòng hàng cũ"
    )
  })

  it("ném ra một chuỗi thì cũng đọc được", () => {
    expect(errorMessage("mạng lỗi")).toBe("mạng lỗi")
  })
})

describe("Không còn chỗ nào nuốt lỗi", () => {
  /**
   * ⚠ Quét TOÀN BỘ src chứ không liệt kê tay. Chốt liệt kê tay chỉ canh
   * được những chỗ đã biết, mà lần sau người ta chép lại đúng câu đó vào
   * một màn mới.
   */
  it('không file nào còn viết `x instanceof Error ? x.message : "Có lỗi xảy ra"`', () => {
    const offenders = sources().filter(
      (f) =>
        f.rel !== "src/lib/errors.ts" &&
        /instanceof Error \? \w+\.message : "Có lỗi xảy ra"/.test(f.src)
    )
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  /**
   * ⚠ `(err as Error).message` không nổ, nhưng nó vứt mất `code`, `details`
   * và `hint` — đúng ba thứ nói được vì sao hỏng.
   */
  it("không file nào còn ép kiểu `as Error` để lấy message", () => {
    const offenders = sources().filter(
      (f) => f.rel !== "src/lib/errors.ts" && /\(\w+ as Error\)\.message/.test(f.src)
    )
    expect(offenders.map((f) => f.rel)).toEqual([])
  })
})

describe("Màn thêm khách hàng nói rõ hỏng ở đâu", () => {
  const FORM = code(read("src/components/customers/customer-form.tsx"))
  const TOASTER = code(read("src/components/ui/toaster.tsx"))

  /** ⚠ "Lỗi" một mình không nói được người dùng vừa mất cái gì. */
  it("tiêu đề nói rõ thao tác nào hỏng", () => {
    expect(FORM).toContain('title: customer ? "Không cập nhật được khách hàng" : "Không tạo được khách hàng"')
    expect(FORM).toContain("description: errorMessage(err),")
  })

  /**
   * ⚠ Phép kiểm trùng chạy qua RLS nên có thể KHÔNG THẤY khách trùng. Đọc
   * hỏng mà im lặng đi tiếp là để người dùng tin vào một phép kiểm chưa
   * từng chạy.
   */
  it("kiểm trùng đọc hỏng thì nói ra, không im lặng", () => {
    expect(FORM).toContain("if (existingErr) {")
    expect(FORM).toContain("Chưa kiểm được trùng số điện thoại")
  })

  /**
   * ⚠ 5 giây đủ cho "Đã lưu", nhưng một câu lỗi kèm nguyên văn của database
   * thì đọc chưa xong đã biến mất — và không có cách nào gọi nó lại.
   */
  it("thông báo lỗi ở lâu hơn thông báo thường", () => {
    expect(TOASTER).toContain('duration={props.variant === "destructive" ? 15000 : 5000}')
  })

  /** Chọn được chữ thì người dùng chép gửi cho người hỗ trợ được. */
  it("chữ trong thông báo chọn được và xuống dòng được", () => {
    expect(TOASTER).toContain('className="select-text break-words"')
  })
})

/**
 * ⚠ BẢN WEB LÊN TRƯỚC MIGRATION. Mig 167/168 đưa trả tiền NCC và nhập kho
 *   sang RPC; máy chủ chưa chạy thì PostgREST báo "Could not find the
 *   function" — câu ấy không nói với thủ kho phải làm gì.
 */
describe("máy chủ thiếu hàm RPC", () => {
  it.each(["PGRST202", "42883"])("%s → nói là chưa chạy migration", (code) => {
    const m = errorMessage({ code, message: "Could not find the function public.post_stock_import(p)" })
    expect(m).toMatch(/chưa chạy migration mới/)
    expect(m).toContain("post_stock_import")
  })
})
