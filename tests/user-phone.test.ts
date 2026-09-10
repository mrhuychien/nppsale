import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  normalizePhone,
  isValidPhone,
  syntheticEmailForPhone,
  isSyntheticEmail,
  SYNTHETIC_EMAIL_DOMAIN,
} from "../src/lib/users/phone"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

type Case = { in: string; out: string | boolean; note?: string }
const CASES = JSON.parse(read("tests/fixtures/phone-cases.json")) as {
  normalize: Case[]
  valid: Case[]
}

describe("Chuẩn hoá số điện thoại", () => {
  /**
   * ⚠ ĐÂY LÀ LỖI CÓ THẬT TRONG MÃ CŨ. Migration 085 cho đăng nhập bằng
   * SĐT, nhưng so khớp chỉ BỎ KHOẢNG TRẮNG. Nên cùng một số nhập khác
   * dạng là không khớp:
   *     tạo "0909.123.456" → gõ "0909123456"   ✗
   *     tạo "0909123456"   → gõ "+84909123456" ✗
   * Người dùng gõ đúng số của mình mà bị báo sai tài khoản.
   */
  for (const c of CASES.normalize) {
    it(`"${c.in}" → "${c.out}"${c.note ? ` (${c.note})` : ""}`, () => {
      expect(normalizePhone(c.in)).toBe(c.out)
    })
  }

  it("chịu được null / undefined", () => {
    expect(normalizePhone(null)).toBe("")
    expect(normalizePhone(undefined)).toBe("")
  })

  /**
   * ⚠ BẤT BIẾN QUAN TRỌNG NHẤT: chuẩn hoá hai lần phải ra cùng kết quả.
   * Không thì số lưu trong chỉ mục và số tra lúc đăng nhập lệch nhau.
   */
  it("chuẩn hoá lần hai không đổi kết quả", () => {
    for (const c of CASES.normalize) {
      const once = normalizePhone(c.in)
      expect(normalizePhone(once), `"${c.in}"`).toBe(once)
    }
  })

  /** Mọi cách viết của cùng một số phải quy về một dạng. */
  it("mọi biến thể của cùng một số đều gặp nhau", () => {
    const forms = [
      "0909123456",
      "0909 123 456",
      "0909.123.456",
      "0909-123-456",
      "+84909123456",
      "+84 909 123 456",
      "84909123456",
      "0084909123456",
      "909123456",
    ]
    expect(new Set(forms.map(normalizePhone)).size).toBe(1)
  })
})

describe("Số hợp lệ để làm định danh", () => {
  for (const c of CASES.valid) {
    it(`"${c.in}" → ${c.out}${c.note ? ` (${c.note})` : ""}`, () => {
      expect(isValidPhone(c.in)).toBe(c.out)
    })
  }
})

describe("Email tổng hợp cho Supabase Auth", () => {
  /**
   * Supabase Auth bắt buộc có email. Nhân viên bán hàng phần lớn không
   * có, nên sinh từ chính SĐT — suy ra được, và duy nhất theo SĐT.
   */
  it("sinh từ dạng CHUẨN HOÁ, không từ dạng người gõ", () => {
    expect(syntheticEmailForPhone("0909 123 456")).toBe(`0909123456@${SYNTHETIC_EMAIL_DOMAIN}`)
    expect(syntheticEmailForPhone("+84909123456")).toBe(`0909123456@${SYNTHETIC_EMAIL_DOMAIN}`)
  })

  /**
   * ⚠ Nếu sinh từ chuỗi thô thì "0909 123 456" và "0909123456" ra hai
   * email khác nhau → hai tài khoản Auth cho cùng một người, trong khi
   * chỉ mục SĐT chỉ cho một. Tạo người thứ hai sẽ hỏng giữa chừng.
   */
  it("mọi biến thể của một số cho CÙNG một email", () => {
    const emails = ["0909123456", "0909 123 456", "+84909123456", "84909123456"].map(
      syntheticEmailForPhone
    )
    expect(new Set(emails).size).toBe(1)
  })

  it("số rỗng thì ném lỗi, không sinh email rác", () => {
    expect(() => syntheticEmailForPhone("")).toThrow()
    expect(() => syntheticEmailForPhone("abc")).toThrow()
  })

  it("nhận ra email do hệ thống sinh", () => {
    expect(isSyntheticEmail(`0909123456@${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true)
    expect(isSyntheticEmail("anh@congty.vn")).toBe(false)
    expect(isSyntheticEmail(null)).toBe(false)
  })
})

describe("Hai bản chuẩn hoá phải cùng luật", () => {
  /**
   * Có hai bản: TS (src/lib/users/phone.ts) và SQL
   * (public.normalize_phone trong migration 104). Lệch nhau thì tài khoản
   * tạo được mà không đăng nhập được.
   *
   * Không chạy được Postgres trong bộ test này, nên ở đây giữ hai điều
   * kiểm được bằng văn bản: cả hai cùng trỏ về một bộ ca, và luật trong
   * SQL đúng là bốn nhánh như bản TS.
   */
  const sql = read("supabase/migrations/104_login_by_phone.sql")

  it("cả hai bản đều trỏ tới bộ ca dùng chung", () => {
    expect(read("src/lib/users/phone.ts")).toContain("tests/fixtures/phone-cases.json")
    expect(sql).toContain("tests/fixtures/phone-cases.json")
    expect(sql).toContain("src/lib/users/phone.ts")
  })

  it("SQL có đủ bốn nhánh như bản TS", () => {
    expect(sql).toContain("'^00'") // bỏ tiền tố quay số quốc tế
    expect(sql).toContain("d LIKE '84%'") // mã quốc gia
    expect(sql).toContain("d LIKE '0%'") // đã đúng dạng
    expect(sql).toContain("length(d) = 9") // thiếu số 0 đầu
  })

  /** IMMUTABLE mới dùng được trong chỉ mục — thiếu là migration đứt. */
  it("hàm SQL là IMMUTABLE và chỉ mục dùng đúng nó", () => {
    expect(sql).toContain("IMMUTABLE")
    expect(sql).toContain("ON public.users (public.normalize_phone(phone))")
  })

  /**
   * ⚠ RPC đăng nhập PHẢI dùng cùng hàm đó. Bản 085 tự bỏ khoảng trắng
   * tại chỗ — đúng cái đã gây lỗi.
   */
  it("RPC đăng nhập so bằng chính hàm chuẩn hoá", () => {
    const rpc = sql.slice(sql.indexOf("FUNCTION public.lookup_email_by_identifier"))
    expect(rpc).toContain("public.normalize_phone(u.phone) = v_phone")
    expect(rpc).not.toContain("regexp_replace")
  })

  /** Dữ liệu cũ trùng số thì phải nêu tên, không để lỗi khoá trùng mù mờ. */
  it("chặn và nêu rõ nếu dữ liệu cũ có SĐT trùng", () => {
    const check = sql.indexOf("HAVING count(*) > 1")
    const index = sql.indexOf("CREATE UNIQUE INDEX")
    expect(check).toBeGreaterThan(0)
    expect(check).toBeLessThan(index)
    expect(sql).toContain("RAISE EXCEPTION")
  })
})

describe("Tạo người dùng: SĐT là chính, email là phụ", () => {
  const api = read("src/app/api/admin/users/route.ts")
  const form = read("src/app/(dashboard)/settings/users/new/page.tsx")

  /** Nhân viên bán hàng phần lớn không có email — không được bắt buộc. */
  it("API bắt buộc SĐT, KHÔNG bắt buộc email", () => {
    expect(api).toContain("if (!phone || !password || !full_name || !role)")
    expect(api).not.toMatch(/if \(!email \|\|/)
    expect(api).toContain("isValidPhone(phone)")
  })

  /**
   * ⚠ Email tổng hợp phải sinh từ dạng CHUẨN HOÁ. Sinh từ chuỗi thô thì
   * "0909 123 456" và "0909123456" ra hai email khác nhau, trong khi chỉ
   * mục SĐT chỉ cho một — người thứ hai tạo sẽ hỏng giữa chừng.
   */
  it("API sinh email tổng hợp từ SĐT khi không nhập email", () => {
    expect(api).toContain("syntheticEmailForPhone(phone)")
    expect(api).toContain("email: authEmail")
  })

  /** Chuẩn hoá khi SO, giữ nguyên khi LƯU — số hiển thị phải như người nhập. */
  it("lưu SĐT đúng dạng người nhập, không lưu dạng chuẩn hoá", () => {
    expect(api).toContain("phone: String(phone).trim()")
    expect(api).not.toContain("phone: normalizePhone")
  })

  /** "Tạo người dùng thật đơn giản trước. Set quyền sau." */
  it("form chỉ hỏi 4 thứ: họ tên, SĐT, mật khẩu, vai trò", () => {
    expect(form).toContain("Họ và tên *")
    expect(form).toContain("Số điện thoại *")
    expect(form).toContain("Mật khẩu *")
    expect(form).toContain("Vai trò *")
    // Những thứ đã dời sang trang phân quyền:
    expect(form).not.toContain("Email *")
    expect(form).not.toContain("Mẫu phân quyền")
    expect(form).not.toContain("Cho phép sửa giá")
    expect(form).not.toContain("Tài khoản đăng nhập")
  })

  /** Chặn tại form thay vì để server trả lỗi sau một vòng mạng. */
  it("form tự kiểm SĐT trước khi gửi", () => {
    expect(form).toContain("isValidPhone(phone)")
  })

  /** Tạo xong đi thẳng sang phân quyền — không bỏ lửng ở đó. */
  it("tạo xong chuyển sang trang phân quyền chi tiết", () => {
    expect(form).toContain("router.push(`/settings/users/${newUserId}`)")
  })

  /** SĐT là thứ nhân viên gõ để đăng nhập, nên nhãn phải nói đúng thế. */
  it("trang đăng nhập nêu SĐT trước", () => {
    const login = read("src/app/login/page.tsx")
    expect(login).toContain("Số điện thoại")
    expect(login).toContain('placeholder="0909123456"')
    // Vẫn phải nhận email — chủ NPP đăng nhập bằng email thật.
    expect(login).toContain('type="text"')
    expect(login).toContain("lookup_email_by_identifier")
  })
})

describe("Menu: Tuyến bán hàng nằm trong Bán hàng", () => {
  const sidebar = read("src/components/layout/sidebar.tsx")

  it("đứng ngay dưới Khách hàng, cùng nhóm Bán hàng", () => {
    const group = sidebar.slice(
      sidebar.indexOf('label: "Bán hàng"'),
      sidebar.indexOf('label: "Mua hàng"')
    )
    const kh = group.indexOf('href: "/customers"')
    const tuyen = group.indexOf('href: "/customers/routes"')
    expect(kh, "không thấy Khách hàng trong nhóm Bán hàng").toBeGreaterThan(0)
    expect(tuyen, "không thấy Tuyến bán hàng trong nhóm Bán hàng").toBeGreaterThan(0)
    expect(tuyen).toBeGreaterThan(kh)
  })

  /** Trang đã tồn tại từ trước, chỉ là không có lối vào từ menu. */
  it("trỏ đúng trang đang có", () => {
    expect(read("src/app/(dashboard)/customers/routes/page.tsx")).toContain("Tuyến bán hàng")
  })
})
