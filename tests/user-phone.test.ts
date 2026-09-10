import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
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
   * tại chỗ — đúng cái đã gây lỗi. Bản CUỐI CÙNG nằm ở 105.
   */
  it("RPC đăng nhập so bằng chính hàm chuẩn hoá", () => {
    const final = read("supabase/migrations/105_drop_username_login.sql")
    const rpc = final.slice(final.indexOf("FUNCTION public.lookup_email_by_identifier"))
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

  /**
   * Tạo xong dừng lại ở màn phát mã QR (mã + mật khẩu chỉ hiện một lần),
   * nhưng vẫn có nút đi tiếp sang phân quyền — không bỏ lửng người dùng.
   */
  it("có đường đi tiếp sang phân quyền chi tiết", () => {
    expect(form).toContain("router.push(`/settings/users/${created.id}`)")
    expect(form).toContain("Phân quyền chi tiết")
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

describe("Bỏ hẳn username — chỉ còn SĐT và email chủ", () => {
  const sql105 = read("supabase/migrations/105_drop_username_login.sql")
  const api = read("src/app/api/admin/users/route.ts")

  /**
   * `username` là định danh đăng nhập THỨ BA. Sau khi SĐT thành định danh
   * chính, nó chỉ còn làm một việc: thêm một cách nữa để cùng một người
   * đăng nhập — đổi lại một chỉ mục phải giữ đồng bộ, một nhánh trong RPC,
   * một ô trên hai màn tạo người dùng, và một câu hỏi cho người vận hành
   * ("người này đăng nhập bằng số hay bằng tên?").
   */
  it("migration bỏ cả cột lẫn chỉ mục", () => {
    expect(sql105).toContain("DROP INDEX IF EXISTS idx_users_username_unique")
    expect(sql105).toContain("ALTER TABLE public.users DROP COLUMN IF EXISTS username")
  })

  /** Có người đang dùng thì phải DỪNG — bỏ cột là họ mất đường đăng nhập. */
  it("chặn nếu còn tài khoản đang đặt username", () => {
    const guard = sql105.indexOf("RAISE EXCEPTION")
    const drop = sql105.indexOf("DROP INDEX")
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(drop)
  })

  /**
   * ⚠ VẾ PHẢI GIỮ: email vẫn là đường đăng nhập của CHỦ NPP — tài khoản
   * đầu tiên tạo từ Supabase Dashboard (bootstrap_owner.sql). Bỏ nốt vế
   * này là khoá luôn đường vào của một bản cài mới.
   */
  it("GIỮ đường đăng nhập bằng email cho chủ NPP", () => {
    const rpc = sql105.slice(sql105.indexOf("FUNCTION public.lookup_email_by_identifier"))
    expect(rpc).toContain("v_id LIKE '%@%'")
    expect(rpc).toContain("lower(au.email) = v_id")
  })

  /** Không còn nhánh username trong RPC. */
  it("RPC không còn tra theo username", () => {
    const rpc = sql105.slice(sql105.indexOf("FUNCTION public.lookup_email_by_identifier"))
    expect(rpc).not.toContain("u.username")
  })

  /** Một định danh là đủ — nhận thêm email là mở lại câu hỏi vừa bỏ. */
  it("API không nhận email lẫn username từ ngoài", () => {
    expect(api).not.toMatch(/const \{[^}]*\busername\b/)
    expect(api).not.toContain("providedEmail")
    expect(api).not.toContain("username: cleanUsername")
    expect(api).toContain("const authEmail = syntheticEmailForPhone(phone)")
  })

  /**
   * ⚠ Đường tạo bằng QR trước đây sinh email từ một chuỗi ngẫu nhiên, nên
   * cùng một người tạo hai lần ra hai tài khoản Auth khác nhau mà không gì
   * nối lại được. Nay đã gộp vào một route, sinh từ SĐT.
   */
  it("email kỹ thuật sinh từ SĐT, không từ số ngẫu nhiên", () => {
    expect(api).toContain("syntheticEmailForPhone(phone)")
    expect(api).not.toContain("randomUUID")
    expect(api).toContain("isValidPhone(phone)")
  })

  /** Không màn nào còn hỏi tên tài khoản. */
  it("màn tạo và màn sửa không còn ô username", () => {
    for (const f of [
      "src/app/(dashboard)/settings/users/new/page.tsx",
      "src/app/(dashboard)/settings/users/[id]/page.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/form\.username|setUsername/)
    }
  })

  /** Kiểu User không còn trường đã bỏ khỏi schema. */
  it("type User không còn username", () => {
    const types = read("src/types/index.ts")
    const user = types.slice(types.indexOf("interface User"), types.indexOf("interface User") + 600)
    expect(user).not.toContain("username")
  })
})

describe("Chủ NPP cũng đăng nhập bằng SĐT (106)", () => {
  const sql106 = read("supabase/migrations/106_owner_login_by_phone.sql")

  /** Sau 106 chỉ còn MỘT định danh — hết câu hỏi "người này đăng nhập bằng gì". */
  it("RPC chỉ còn tra theo SĐT", () => {
    const rpc = sql106.slice(sql106.indexOf("FUNCTION public.lookup_email_by_identifier"))
    expect(rpc).toContain("public.normalize_phone(u.phone) = v_phone")
    expect(rpc).not.toContain("LIKE '%@%'")
    expect(rpc).not.toContain("lower(au.email) = v_id")
  })

  /**
   * ⚠ RỦI RO PHẢI CHẶN. Bỏ nhánh email nghĩa là tài khoản KHÔNG CÓ SĐT
   * mất sạch đường đăng nhập — kể cả chủ NPP. Nếu đó là tài khoản duy
   * nhất thì mất luôn quyền vào hệ thống, và không sửa được từ giao diện.
   */
  it("DỪNG nếu còn tài khoản đang hoạt động mà thiếu SĐT", () => {
    const guard = sql106.indexOf("RAISE EXCEPTION")
    const replaceFn = sql106.indexOf("CREATE OR REPLACE FUNCTION")
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(replaceFn)
    expect(sql106).toContain("phone IS NULL OR public.normalize_phone(phone) = ''")
    // Chỉ xét người còn hoạt động — tài khoản đã tắt thì không cần SĐT.
    expect(sql106).toContain("coalesce(is_active, true)")
  })

  /** Không tiết lộ số nào đang tồn tại: sai số thì trả NULL, client báo chung. */
  it("số không hợp lệ trả NULL, không báo lỗi riêng", () => {
    expect(sql106).toContain("IF v_phone = '' THEN RETURN NULL; END IF;")
  })
})

describe("Gộp hai màn tạo nhân viên thành một", () => {
  const api = read("src/app/api/admin/users/route.ts")
  const form = read("src/app/(dashboard)/settings/users/new/page.tsx")

  /**
   * Trước đây có hai màn: tạo bằng mật khẩu, và tạo bằng QR. Người vận
   * hành phải chọn TRƯỚC "nhân viên này đăng nhập kiểu gì" — mà lúc mới
   * tạo thì chưa ai biết. Chọn sai là xoá đi tạo lại.
   */
  it("chỉ còn MỘT màn và MỘT route tạo nhân viên", () => {
    expect(existsSync(resolve(ROOT, "src/app/(dashboard)/settings/users/qr-new"))).toBe(false)
    expect(existsSync(resolve(ROOT, "src/app/api/admin/users/qr"))).toBe(false)
  })

  /** Không còn lối vào nào trỏ tới màn đã gỡ. */
  it("không còn link tới màn cũ", () => {
    for (const f of [
      "src/components/layout/sidebar.tsx",
      "src/app/(dashboard)/settings/users/page.tsx",
    ]) {
      expect(read(f), f).not.toContain("qr-new")
    }
  })

  /**
   * ⚠ Phát QR hỏng thì phải XOÁ luôn tài khoản vừa tạo. Để lại một nhân
   * viên có hồ sơ mà không có QR nghĩa là người vận hành tưởng đã xong,
   * đưa máy cho nhân viên quét, và không quét được — không có gì báo.
   */
  it("API tạo tài khoản VÀ phát QR, hỏng thì dọn sạch", () => {
    expect(api).toContain('from("qr_login_tokens")')
    expect(api).toContain("loginUrl: qrLoginUrl(qrToken)")
    const failBlock = api.slice(api.indexOf("if (tokenErr)"))
    expect(failBlock).toContain("deleteUser(created.user.id)")
  })

  /** Token QR phải đủ dài để không đoán được — nó là chìa khoá vào tài khoản. */
  it("token QR sinh ngẫu nhiên 32 byte", () => {
    expect(api).toContain('randomBytes(32).toString("base64url")')
  })

  /**
   * ⚠ Mật khẩu và token QR chỉ có ĐÚNG MỘT LẦN: server lưu mật khẩu đã
   * băm, và token chỉ trả về lúc tạo. Điều hướng ngay sang trang phân
   * quyền là người vận hành mất cả hai mà chưa kịp gửi cho nhân viên.
   */
  it("hiện kết quả tại chỗ, KHÔNG đá sang trang khác ngay", () => {
    const submit = form.slice(form.indexOf("const handleSubmit"), form.indexOf("const copyLink"))
    expect(submit).toContain("setCreated({")
    expect(submit).not.toMatch(/router\.push/)
    // Và phải nói rõ là chỉ hiện một lần.
    expect(form).toContain("Mật khẩu chỉ hiện MỘT LẦN")
  })

  /** Thiếu QR mà vẫn báo thành công là để người vận hành đi vào ngõ cụt. */
  it("báo lỗi nếu tạo được tài khoản nhưng không có mã QR", () => {
    expect(form).toContain("if (!newUserId || !data?.loginUrl)")
  })

  /** Ba cách đưa mã cho nhân viên: quét tại chỗ, gửi ảnh, in ra giấy. */
  it("có đủ tải ảnh / chép link / in", () => {
    expect(form).toContain("downloadQrLoginPng(created.name, created.loginUrl)")
    expect(form).toContain("navigator.clipboard.writeText(created.loginUrl)")
    expect(form).toContain("printQrLoginCard(created.name, created.loginUrl)")
    expect(form).toContain("<QrCode value={created.loginUrl}")
  })

  /**
   * PNG chứ không phải SVG: Zalo và các app nhắn tin không hiện trước
   * SVG, người nhận thấy một file lạ không mở được.
   */
  it("tải về dạng PNG, dựng phía trình duyệt", () => {
    const lib = read("src/lib/qr-print.ts")
    expect(lib).toContain("QRCode.toDataURL")
    expect(lib).toContain(".png")
    // Tên file phải bỏ dấu — Windows không nhận nhiều ký tự.
    expect(lib).toContain('normalize("NFD")')
  })
})
