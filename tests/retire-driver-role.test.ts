import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  ROLES,
  RETIRED_ROLES,
  ROLE_LABELS,
  DEFAULT_PERMISSION_MAP,
  hasPermission,
  canAccessModule,
  MODULES,
  ACTIONS,
} from "../src/lib/permissions"

/**
 * BỎ VAI TÀI XẾ.
 *
 * Workflow v2 bỏ bước lập chuyến giao; P7 ẩn `/deliveries` và khoá mọi
 * nút ghi ở đó. Vai `driver` không còn việc riêng, chủ NPP chốt: KHOÁ
 * tài khoản, KHÔNG đổi vai của ai.
 *
 * ⚠ BA VIỆC KHÁC NHAU, ĐỪNG LẪN VÀO NHAU:
 *   1. vai KHÔNG GÁN ĐƯỢC nữa (`ROLES`, ô chọn, trigger CSDL);
 *   2. vai cũ VẪN ĐỌC ĐƯỢC (kiểu `Role`, nhãn) — dòng `users` cũ còn
 *      mang nó và `deliveries.driver_id` trỏ vào đó;
 *   3. tài khoản cũ bị KHOÁ, và khoá phải THẬT SỰ khoá.
 *
 * ⚠ Việc (3) là chỗ phát hiện ra một lỗ có sẵn: `is_active = false`
 * trước nay KHÔNG chặn gì cả trên đường đăng nhập thường. Xem mig 122.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const MIG122 = read("supabase/migrations/122_retire_driver_role.sql")
/**
 * ⚠ HAI MÀN NÀY PHẢI ĐỌC BẢN ĐÃ BỎ CHÚ THÍCH cho những phép kiểm
 * "KHÔNG được chứa". Chú thích ở đó nêu đích danh cách viết sai
 * (`!profile.is_active`) để người sau khỏi dẫm lại — hỏi cả chú thích
 * thì chốt bắt nhầm chính lời cảnh báo, và cách "sửa" duy nhất là xoá
 * lời cảnh báo đi.
 */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const AUTH = read("src/hooks/use-auth.tsx")
const LOGIN = read("src/app/login/page.tsx")
const AUTH_CODE = code(AUTH)
const LOGIN_CODE = code(LOGIN)
const USER_NEW = read("src/app/(dashboard)/settings/users/new/page.tsx")
const USER_EDIT = read("src/app/(dashboard)/settings/users/[id]/page.tsx")
const CONSTANTS = read("src/lib/constants.ts")

describe("Vai đã ngưng dùng: không gán được, nhưng vẫn đọc được", () => {
  it("biến khỏi danh sách vai gán được", () => {
    expect(ROLES).not.toContain("driver")
    expect(RETIRED_ROLES).toContain("driver")
  })

  /**
   * ⚠ BỎ NHÃN LÀ XOÁ THÔNG TIN KHỎI MÀN. Màn Cài đặt → Người dùng vẫn
   * liệt kê tài khoản tài xế cũ; không có nhãn thì ô "Vai trò" của họ
   * trống trơn và người xem không biết đang nhìn cái gì.
   */
  it("nhãn còn lại, và nói rõ là đã ngưng dùng", () => {
    expect(ROLE_LABELS.driver).toBeTruthy()
    expect(ROLE_LABELS.driver).toContain("ngưng dùng")
    expect(CONSTANTS).toContain('driver: "Tài xế (ngưng dùng)"')
  })

  /** Không còn hàng nào trong ma trận mặc định. */
  it("không còn quyền nào ở bất kỳ ô nào", () => {
    expect(DEFAULT_PERMISSION_MAP.driver).toBeUndefined()
    for (const m of MODULES) {
      expect(canAccessModule("driver", m), `vẫn vào được ${m}`).toBe(false)
      for (const a of ACTIONS) {
        expect(hasPermission("driver", m, a), `vẫn có ${m}.${a}`).toBe(false)
      }
    }
  })

  /** Hai ô chọn vai ở màn Người dùng. */
  it("hai màn quản lý người dùng không mời chọn vai đã bỏ", () => {
    expect(USER_NEW).toContain(
      'const ROLES = ["owner", "manager", "accountant", "sales", "warehouse"] as const'
    )
    expect(USER_NEW).not.toContain('"driver"')
    expect(USER_EDIT).toContain(
      'const ROLE_OPTIONS: Role[] = ["owner", "manager", "accountant", "sales", "warehouse"]'
    )
  })

  /**
   * ⚠ PHẢI CÒN MỘT LỐI RA. Ô chọn bỏ hẳn giá trị đang lưu thì nó hiện
   * rỗng, bấm Lưu là ghi đè mất vai thật — và chủ NPP không còn cách nào
   * đổi tài khoản tài xế cũ sang vai khác. `roleOptionsFor` ghép vai
   * hiện tại vào danh sách khi nó đã ngưng dùng.
   */
  it("màn sửa người dùng vẫn hiện được vai cũ để đổi đi", () => {
    expect(USER_EDIT).toContain("function roleOptionsFor(")
    expect(USER_EDIT).toContain("if (current && !ROLE_OPTIONS.includes(current))")
    expect(USER_EDIT).toContain("{roleOptionsFor(form.role).map((r) => (")
  })
})

describe("Migration 122: khoá tài khoản, chặn gán mới", () => {
  /** In danh sách TRƯỚC khi đổi — đây là quyền truy cập của người thật. */
  it("xem trước danh sách tài khoản sắp bị khoá", () => {
    expect(MIG122).toContain("122 — sẽ khoá:")
    expect(MIG122).toContain("WHERE u.role = 'driver' AND COALESCE(u.is_active, true) = true")
  })

  it("khoá bằng is_active, KHÔNG đổi vai và KHÔNG xoá dòng", () => {
    expect(MIG122).toContain("SET is_active = false")
    // ⚠ Xoá là mất hồ sơ: `deliveries.driver_id` trỏ vào những dòng này.
    expect(MIG122).not.toContain("DELETE FROM users")
    expect(MIG122).not.toMatch(/UPDATE users[\s\S]{0,120}SET role =/)
  })

  /**
   * ⚠ KHÔNG SIẾT `CHECK`. Dòng cũ cố ý giữ `role='driver'`, nên ALTER
   * TABLE siết ràng buộc sẽ ném lỗi ngay trên dữ liệu đang có. Chặn gán
   * MỚI phải bằng trigger.
   */
  it("chặn gán mới bằng trigger, không bằng CHECK", () => {
    expect(MIG122).toContain("CREATE TRIGGER trg_block_driver_role")
    expect(MIG122).toContain("ROLE_RETIRED")
    expect(MIG122).not.toContain("ADD CONSTRAINT chk_users_role")
  })

  /**
   * ⚠ CHẶN ĐÚNG LÚC GIÁ TRỊ ĐỔI THÀNH 'driver', KHÔNG CHẶN MỌI UPDATE.
   * Dòng tài xế cũ vẫn phải sửa được — nhất là ĐỔI SANG VAI KHÁC. Chặn
   * cả những lệnh đó là nhốt luôn chủ NPP ngoài cửa, không còn đường dọn.
   */
  it("trigger không nhốt chính dòng tài xế cũ", () => {
    expect(MIG122).toContain(
      "IF NEW.role = 'driver' AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'driver') THEN"
    )
  })

  it("migration theo đúng khuôn của kho", () => {
    expect(MIG122).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIG122).toContain("DROP TRIGGER IF EXISTS trg_block_driver_role ON users")
  })
})

/**
 * ⚠ ĐÂY LÀ PHẦN QUAN TRỌNG NHẤT, VÀ NÓ KHÔNG PHẢI CHUYỆN CỦA VAI TÀI XẾ.
 *
 * Chủ NPP chọn "khoá tài khoản". Đo ra thì `is_active = false` TRƯỚC NAY
 * KHÔNG KHOÁ GÌ CẢ: chỉ đường đăng nhập bằng mã QR kiểm cờ đó. Đường
 * email + mật khẩu đọc nó vào hồ sơ rồi không hỏi tới, và phía CSDL
 * `user_org_id()` / `user_role()` cũng không nhìn. Nghĩa là nhân viên đã
 * nghỉ việc, đã bấm "Khoá tài khoản", VẪN đăng nhập được với nguyên
 * quyền của vai mình.
 */
describe("Khoá tài khoản phải THẬT SỰ khoá", () => {
  /** Chặn ở hai hàm helper = chặn mọi policy RLS, một chỗ sửa. */
  it("hai hàm cổng RLS đều trả NULL cho tài khoản bị khoá", () => {
    for (const fn of ["user_org_id", "user_role"]) {
      const i = MIG122.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`)
      expect(i, `mig 122 không định nghĩa lại ${fn}`).toBeGreaterThan(0)
      const body = MIG122.slice(i, MIG122.indexOf("$$;", i))
      expect(body, `${fn} chưa lọc is_active`).toContain(
        "AND COALESCE(is_active, true) = true"
      )
    }
  })

  /**
   * ⚠ `COALESCE(is_active, true)` LÀ BẮT BUỘC, KHÔNG PHẢI CHO ĐẸP. Cột
   * này NULL được (`is_active boolean DEFAULT true`, mig 001 — không NOT
   * NULL). Đọc NULL thành "đã khoá" là khoá oan người đang đi làm, theo
   * kiểu im lặng nhất: app trống trơn, không câu nào giải thích.
   */
  it("NULL nghĩa là CHƯA AI KHOÁ, ở cả ba lớp", () => {
    expect(MIG122).not.toMatch(/WHERE\s+id = \(SELECT auth\.uid\(\)\)\s*AND is_active = true/)
    expect(AUTH, "giao diện đọc NULL thành đã khoá").toContain("profile.is_active === false")
    expect(LOGIN, "màn đăng nhập đọc NULL thành đã khoá").toContain("me?.is_active === false")
    for (const src of [AUTH_CODE, LOGIN_CODE]) {
      expect(src).not.toContain("!profile.is_active")
      expect(src).not.toContain("!me.is_active")
      expect(src).not.toContain("!me?.is_active")
    }
  })

  /**
   * ⚠ RLS TỪ CHỐI LÀ IM LẶNG — 0 dòng, HTTP 200, `error` null. Chặn ở
   * CSDL chỉ làm app trống, KHÔNG nói vì sao. Phải có câu giải thích và
   * lệnh đăng xuất ở giao diện.
   */
  it("người bị khoá được NÓI vì sao, không chỉ thấy màn trống", () => {
    expect(AUTH).toContain("Tài khoản của bạn đã bị khoá")
    expect(AUTH).toContain("supabase.auth.signOut()")
    expect(LOGIN).toContain("Tài khoản đã bị khoá")
    expect(LOGIN).toContain("await supabase.auth.signOut()")
  })

  /** Chặn ở màn đăng nhập thì câu giải thích nằm đúng chỗ người đang nhìn. */
  it("màn đăng nhập chặn TRƯỚC khi chuyển trang", () => {
    const i = LOGIN.indexOf('me?.is_active === false')
    const j = LOGIN.indexOf("router.push(trangSauDangNhap(vaiTro))")
    expect(i, "chưa kiểm is_active ở màn đăng nhập").toBeGreaterThan(0)
    expect(i, "kiểm SAU khi đã chuyển trang thì người dùng thấy màn nháy rồi bị ném ra").toBeLessThan(j)
  })
})
