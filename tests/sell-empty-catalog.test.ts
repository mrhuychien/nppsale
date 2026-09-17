import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { diagnoseEmptyCatalog } from "../src/lib/sell/ref-data"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const POS = code(read("src/app/(dashboard)/sell/page.tsx"))
const REF = code(read("src/lib/sell/ref-data.ts"))
const HOOK = code(read("src/hooks/use-sell-data.tsx"))

/**
 * Dựng một client giả đủ cho phép dò. `counts` là số dòng ĐỌC ĐƯỢC khi
 * bỏ bộ lọc trạng thái.
 */
function fakeClient(opts: {
  userId?: string | null
  profile?: { org_id: string | null } | null
  profileError?: string
  counts?: { products: number; customers: number }
  countError?: string
}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null }, error: null }),
    },
    from(table: string) {
      return {
        select(_cols: string, o?: { head?: boolean }) {
          if (o?.head) {
            return Promise.resolve({
              count: opts.counts ? opts.counts[table as "products" | "customers"] : 0,
              error: opts.countError ? { message: opts.countError } : null,
            })
          }
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.profile ?? null,
                error: opts.profileError ? { message: opts.profileError } : null,
              }),
            }),
          }
        },
      }
    },
  }
}

/**
 * ⚠ LỖI NGƯỜI DÙNG BÁO: "Vào tạo đơn hàng trống trơn rồi? Khách hàng cũng
 * thế."
 *
 * Màn hình lúc đó nói đúng một câu: "Chưa có sản phẩm nào". Câu đó là một
 * KẾT LUẬN, và màn hình không có cơ sở nào để kết luận như vậy — PostgREST
 * trả HTTP 200, `error === null`, mảng rỗng cho cả bốn chuyện khác hẳn
 * nhau: phiên hết hạn, tài khoản chưa gắn đơn vị, dữ liệu có mà không dòng
 * nào `active`, và rỗng thật. Bốn nguyên nhân, bốn việc phải làm, một câu
 * trả lời — nên người dùng không có đường nào lần ra.
 */
describe("Danh mục rỗng phải NÓI RA vì sao", () => {
  it("phiên hết hạn thì nói là phiên hết hạn", async () => {
    const msg = await diagnoseEmptyCatalog(fakeClient({ userId: null }))
    expect(msg).toContain("Phiên đăng nhập")
    expect(msg).toContain("Đăng nhập lại")
  })

  /**
   * ⚠ `org_id` rỗng là nguyên nhân làm RỖNG CẢ APP: mọi policy RLS đều so
   * `org_id = public.user_org_id()`, và NULL thì không khớp dòng nào. Đúng
   * triệu chứng "sản phẩm rỗng, khách cũng rỗng".
   */
  it("tài khoản chưa gắn đơn vị thì chỉ đúng vào đó", async () => {
    const msg = await diagnoseEmptyCatalog(
      fakeClient({ userId: "u1", profile: { org_id: null } })
    )
    expect(msg).toContain("org_id")
    expect(msg).toContain("đơn vị")
  })

  /**
   * ⚠ Số đếm ĐI QUA RLS. Đếm được > 0 nghĩa là tài khoản ĐỌC ĐƯỢC bảng đó
   * — nên chỗ hỏng không phải quyền mà là bộ lọc `status = 'active'`.
   */
  it("đọc được dữ liệu nhưng không dòng nào active thì chỉ vào trạng thái", async () => {
    const msg = await diagnoseEmptyCatalog(
      fakeClient({
        userId: "u1",
        profile: { org_id: "o1" },
        counts: { products: 1700, customers: 320 },
      })
    )
    expect(msg).toContain("1700")
    expect(msg).toContain("320")
    expect(msg).toContain("active")
  })

  /**
   * ⚠ Đếm ra 0 thì KHÔNG phân biệt được "rỗng thật" với "bị RLS chặn" —
   * cả hai đều là 0 dòng, 200, không lỗi. Câu trả lời phải nói ra CẢ HAI
   * khả năng. Chọn bừa một cái nghe xuôi tai là quay lại đúng lỗi đang sửa.
   */
  it("đếm ra 0 thì nói cả hai khả năng, không chọn bừa", async () => {
    const msg = await diagnoseEmptyCatalog(
      fakeClient({ userId: "u1", profile: { org_id: "o1" }, counts: { products: 0, customers: 0 } })
    )
    expect(msg).toContain("chưa được nhập")
    expect(msg).toContain("RLS")
  })

  it("đọc hồ sơ hỏng thì nói ra lỗi thật, không nuốt", async () => {
    const msg = await diagnoseEmptyCatalog(
      fakeClient({ userId: "u1", profileError: "permission denied for table users" })
    )
    expect(msg).toContain("permission denied for table users")
  })

  /** Phép dò không bao giờ trả chuỗi rỗng — rỗng là im lặng một lần nữa. */
  it("mọi nhánh đều trả về một câu", async () => {
    const cases = [
      fakeClient({ userId: null }),
      fakeClient({ userId: "u1", profile: { org_id: null } }),
      fakeClient({ userId: "u1", profile: { org_id: "o1" }, counts: { products: 0, customers: 0 } }),
      fakeClient({ userId: "u1", profile: { org_id: "o1" }, countError: "boom" }),
    ]
    for (const c of cases) {
      expect((await diagnoseEmptyCatalog(c)).trim().length).toBeGreaterThan(20)
    }
  })
})

describe("Màn hình dùng câu dò đó, và có đường đi tiếp", () => {
  /** Dò xong mà không gắn vào cảnh báo thì công cốc. */
  it("nhánh rỗng gắn câu dò vào cảnh báo", () => {
    expect(REF).toContain("warnings.push(await diagnoseEmptyCatalog(supabase))")
  })

  /**
   * ⚠ "Chưa có sản phẩm nào" chỉ được nói khi KHÔNG có cảnh báo nào. Có
   * cảnh báo thì cảnh báo mới là câu trả lời.
   */
  it("có cảnh báo thì không kết luận 'chưa có sản phẩm nào'", () => {
    expect(POS).toContain("loadWarnings.length > 0")
    expect(POS).toContain("Không lấy được danh mục")
  })

  /**
   * ⚠ Bản đầu nạp đúng một lần với `[]` và không có đường tải lại: danh
   * mục rỗng là màn hình đứng im ở đó cho tới khi người dùng tự nghĩ ra
   * phải tắt app mở lại. Ngõ cụt thì người dùng đọc thành "phần mềm hỏng".
   */
  it("có nút tải lại danh mục", () => {
    expect(HOOK).toContain("const reload = useCallback(")
    expect(HOOK).toContain("}, [tick])")
    expect(POS).toContain("onClick={reload}")
    expect(POS).toContain("Tải lại danh mục")
  })
})
