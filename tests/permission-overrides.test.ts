import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  canSeeHref,
  canEnterHref,
  NAV_PERMISSION,
  LEGACY_V2_HREFS,
} from "../src/lib/nav/nav-permission"
import {
  canAccessModule,
  hasPermission,
  setUserOverrides,
  type Role,
} from "../src/lib/permissions"
import { FEATURES } from "../src/lib/permissions-features"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const LOADER = code(read("src/components/permissions-loader.tsx"))
const GUARD = code(read("src/hooks/use-role-guard.ts"))

afterEach(() => setUserOverrides(null))

describe("Quyền riêng của từng người có tác dụng thật", () => {
  /**
   * ⚠ LỖI GỐC: bảng `user_permission_overrides` BỊ GHI MÀ KHÔNG AI ĐỌC.
   * Màn /settings/users/[id]/permissions lưu xuống đó từ lâu, nhưng lúc
   * chạy chỉ có bảng theo VAI TRÒ được nạp — nên quản lý thu hồi quyền của
   * một nhân viên, thấy báo "Đã lưu", rồi nhân viên đó vẫn thấy và vẫn vào
   * được đúng màn vừa bị thu hồi. Không có chỗ nào nói ra chuyện đó.
   */
  it("thu hồi riêng một người thì mục đó biến mất khỏi menu của họ", () => {
    expect(canSeeHref("sales", "/promotions")).toBe(true)
    setUserOverrides({ "promotions.read": false })
    expect(canSeeHref("sales", "/promotions")).toBe(false)
  })

  it("cấp riêng một người thì mục đó hiện ra dù vai trò không có", () => {
    expect(canSeeHref("sales", "/suppliers")).toBe(false)
    setUserOverrides({ "suppliers.read": true })
    expect(canSeeHref("sales", "/suppliers")).toBe(true)
  })

  /**
   * ⚠ "KHÔNG CÓ TUỲ CHỈNH" KHÁC "BỊ CẤM". Trả `false` cho mọi khoá chưa
   * khai thì bật tính năng này lên là khoá sạch menu của tất cả mọi người.
   */
  it("không có tuỳ chỉnh thì vai trò quyết, không phải bị cấm", () => {
    setUserOverrides({ "promotions.read": false })
    expect(canSeeHref("sales", "/orders")).toBe(true)
    expect(canSeeHref("sales", "/customers")).toBe(true)
  })

  /** Khoá CHI TIẾT hơn thắng: thu hồi "công nợ NCC" không đụng "công nợ KH". */
  it("thu hồi theo tính năng không kéo theo cả mô-đun", () => {
    setUserOverrides({ "payables.read": false })
    expect(canSeeHref("accountant", "/payables")).toBe(false)
    expect(canSeeHref("accountant", "/receivables")).toBe(true)
  })

  it("thu hồi cả mô-đun thì tính năng con cũng mất", () => {
    setUserOverrides({ "receivables.read": false })
    expect(canSeeHref("accountant", "/payables")).toBe(false)
  })

  /**
   * ⚠ VÀO XEM ỨNG VỚI HÀNH ĐỘNG `read`, không phải "mọi hành động". Thu hồi
   * riêng quyền `delete` của một người mà giấu luôn cả mục là lấy mất đường
   * XEM của họ — đúng thứ họ vẫn còn quyền làm.
   */
  it("thu hồi một hành động không giấu mất trang xem", () => {
    setUserOverrides({ "promotions.delete": false })
    expect(canSeeHref("sales", "/promotions")).toBe(true)
  })

  /** Trang TẠO MỚI thì xét đúng hành động `create`, không xét chung. */
  it("thu hồi quyền tạo thì mất đường tạo đơn, vẫn xem được đơn", () => {
    setUserOverrides({ "orders.create": false })
    expect(canSeeHref("sales", "/sell")).toBe(false)
    expect(canSeeHref("sales", "/orders")).toBe(true)
  })

  /**
   * ⚠ QUYỀN RIÊNG LÀ CỦA MỘT NGƯỜI, KHÔNG PHẢI CỦA MỘT VAI TRÒ. Trộn nó
   * vào `hasPermission(role, …)` thì màn phân quyền — nơi vẽ ma trận cho
   * MỌI vai trò — sẽ hiện quyền riêng của người đang xem như thể đó là mặc
   * định của cả vai trò, và người quản lý sửa nhầm cho tất cả.
   */
  it("không rò vào phép kiểm theo vai trò", () => {
    const before = hasPermission("sales", "promotions", "read")
    setUserOverrides({ "promotions.read": false })
    expect(hasPermission("sales", "promotions", "read")).toBe(before)
    expect(canAccessModule("sales", "promotions")).toBe(true)
  })

  /** Chưa biết vai trò thì đóng, kể cả khi có tuỳ chỉnh cấp quyền. */
  it("chưa biết vai trò thì vẫn đóng", () => {
    setUserOverrides({ "suppliers.read": true })
    expect(canSeeHref(null, "/suppliers")).toBe(false)
  })
})

describe("Tính năng không thừa hưởng bừa từ mô-đun cha", () => {
  /**
   * ⚠ MỘT MÔ-ĐUN GỘP NHIỀU VIỆC KHÁC HẲN NHAU. `inventory` vừa là kho hàng
   * vừa là MUA HÀNG; `receivables` vừa là công nợ khách vừa là công nợ NHÀ
   * CUNG CẤP; `reports` vừa là báo cáo bán hàng của chính mình vừa là báo
   * cáo tài chính toàn NPP. Thừa hưởng nguyên xi nghĩa là cho NVBH đọc tồn
   * kho thì họ thấy luôn hoá đơn mua và công nợ NCC — màn hình chật cứng,
   * và là dữ liệu họ không có việc gì phải xem.
   */
  it.each([
    "/purchasing/invoices",
    "/suppliers",
    "/payables",
    "/inventory/stock-in",
    "/finance/opening-balances",
    "/receivables/by-rep",
    "/analytics/business/overview",
    "/analytics/products/overview",
    "/reports/finance",
    "/reports/suppliers",
    "/reports/employees",
  ])("NVBH không thấy %s", (href) => {
    expect(canSeeHref("sales", href)).toBe(false)
  })

  /** Nhưng đúng việc của NVBH thì KHÔNG được siết nhầm. */
  it.each([
    "/sell",
    "/orders",
    "/customers",
    "/sales/visits",
    "/promotions",
    "/inventory",
    "/products",
    "/receivables",
    "/receivables/collect",
    "/finance/cash-receipts",
    "/commissions",
    "/reports/sales",
  ])("NVBH vẫn thấy %s", (href) => {
    expect(canSeeHref("sales", href)).toBe(true)
  })

  it("back-office vẫn thấy đủ đầu mua và sổ sách", () => {
    for (const role of ["manager", "accountant"] as Role[]) {
      for (const href of ["/purchasing/invoices", "/suppliers", "/payables", "/reports/finance"]) {
        expect(canSeeHref(role, href), `${role} mất ${href}`).toBe(true)
      }
    }
  })

  /** ⚠ Kho vẫn phải lập được phiếu nhập và gửi trả hàng cho NCC. */
  it("kho giữ nguyên việc của kho", () => {
    expect(canSeeHref("warehouse", "/inventory/stock-in")).toBe(true)
    expect(canSeeHref("warehouse", "/purchase-returns")).toBe(true)
    expect(canSeeHref("warehouse", "/payables")).toBe(false)
  })

  /** ⚠ Trừ màn của luồng cũ — chúng ẩn với mọi vai trò, kể cả chủ. */
  it("chủ vẫn thấy mọi thứ, trừ màn luồng cũ đã ẩn", () => {
    for (const href of Object.keys(NAV_PERMISSION)) {
      if (LEGACY_V2_HREFS.has(href)) continue
      expect(canSeeHref("owner", href), `chủ mất ${href}`).toBe(true)
    }
  })

  /**
   * ⚠ Khai `defaultRoles` mà quên tạo Ô RIÊNG trong bộ nhớ quyền thì phép
   * tra rơi về mô-đun cha và lời khai thành vô nghĩa — im lặng.
   */
  it("mọi tính năng có khai defaultRoles đều chặn được vai trò ngoài danh sách", () => {
    const restricted = FEATURES.filter((f) => f.defaultRoles)
    expect(restricted.length).toBeGreaterThan(10)
    for (const f of restricted) {
      const outside = (["sales", "driver"] as Role[]).filter((r) => !f.defaultRoles!.includes(r))
      for (const r of outside) {
        const href = Object.keys(NAV_PERMISSION).find((h) => NAV_PERMISSION[h].feature === f.key)
        if (!href) continue
        expect(canSeeHref(r, href), `${r} vẫn thấy ${f.key}`).toBe(false)
      }
    }
  })
})

describe("Giấu thì phải chặn", () => {
  /**
   * ⚠ GIẤU MÀ KHÔNG CHẶN THÌ CHƯA PHẢI PHÂN QUYỀN. Menu tra theo đường dẫn
   * (tới tận tính năng và quyền riêng của từng người) còn cửa vào trang chỉ
   * tra theo MÔ-ĐUN: mục "Công nợ NCC" biến mất khỏi menu của NVBH, nhưng
   * gõ thẳng `/payables` vào thanh địa chỉ thì vào được.
   */
  it("cửa vào trang dùng CHÍNH phép kiểm của menu", () => {
    expect(GUARD).toContain("canEnterHref(user.role, pathname as string)")
    expect(GUARD).toContain("NAV_PERMISSION[pathname]")
  })

  /**
   * ⚠ ẨN KHỎI MENU VÀ CHẶN CỬA VÀO LÀ HAI VIỆC KHÁC NHAU — và P7 làm lộ
   * ra điều đó. Dữ liệu luồng cũ là CHỨNG TỪ: phiếu soạn hàng, chuyến
   * giao, biên bản bàn giao. Người ta vẫn phải mở lại được để tra, qua
   * đường dẫn cũ hoặc qua thông báo. Nếu `useRoleGuard` gọi `canSeeHref`
   * thì mọi đường dẫn luồng cũ đá người dùng về trang chủ, kể cả chủ nhà
   * — xoá mất lịch sử khỏi tầm với, mà ta chỉ định thôi dùng chứ không
   * định vứt.
   */
  it("màn luồng cũ: ẩn khỏi menu nhưng VẪN vào xem được", () => {
    for (const href of Array.from(LEGACY_V2_HREFS)) {
      expect(canSeeHref("owner", href), `${href} vẫn hiện trong menu`).toBe(false)
      /**
       * ⚠ Chỉ đường dẫn CÓ KHAI trong bảng mới đi qua `canEnterHref`;
       * đường dẫn chưa khai rơi về phép kiểm mô-đun trong `useRoleGuard`
       * (xem chốt ngay dưới), nên vào được sẵn. Khẳng định cho cả hai
       * nhóm ở đây là khẳng định một điều hàm này không hứa.
       */
      if (!NAV_PERMISSION[href]) continue
      expect(canEnterHref("owner", href), `${href} bị chặn cửa vào`).toBe(true)
    }
    expect(GUARD, "cửa vào lại dùng phép kiểm của menu").not.toContain("canSeeHref(")
  })

  /** Đường dẫn động chưa khai thì giữ nguyên phép kiểm cũ, không siết thêm. */
  it("đường dẫn chưa khai vẫn tra theo mô-đun như cũ", () => {
    expect(GUARD).toContain("canAccessModule(user.role, module)")
  })
})

describe("Nạp quyền riêng lúc đăng nhập", () => {
  it("có đọc bảng tuỳ chỉnh của đúng người đang đăng nhập", () => {
    expect(LOADER).toContain('.from("user_permission_overrides")')
    expect(LOADER).toContain('.eq("user_id", userId)')
  })

  /**
   * ⚠ ĐỌC HỎNG THÌ BỎ TUỲ CHỈNH, KHÔNG ĐOÁN. Đoán "bị thu hồi" là khoá
   * nhầm người đang cần làm việc; đoán "được cấp" là mở nhầm. Rơi về quyền
   * vai trò là hành vi đã biết và giải thích được.
   */
  it("đọc hỏng thì rơi về quyền vai trò", () => {
    expect(LOADER).toContain("if (ovRes.error) {")
    expect(LOADER).toContain("setUserOverrides(null)")
  })

  /** ⚠ Đăng xuất phải xoá — người sau đăng nhập không được thừa quyền riêng
   *  của người trước trên cùng một máy. */
  it("hết phiên thì xoá sạch tuỳ chỉnh", () => {
    const i = LOADER.indexOf("if (!orgId) {")
    expect(i).toBeGreaterThanOrEqual(0)
    const block = LOADER.slice(i, LOADER.indexOf("}", i))
    expect(block).toContain("setUserOverrides(null)")
    expect(block).toContain("setPermissionsCache(null)")
  })

  /** Đổi người đăng nhập thì nạp lại — không giữ bản của phiên trước. */
  it("nạp lại khi đổi người dùng", () => {
    expect(LOADER).toContain("}, [orgId, userId])")
  })
})

describe("Màn phân quyền vẽ đúng thứ lúc chạy đang dùng", () => {
  const PERM_PAGE = code(read("src/app/(dashboard)/settings/permissions/page.tsx"))

  /**
   * ⚠ HAI CÂU TRẢ LỜI CHO CÙNG MỘT CÂU HỎI. Màn phân quyền dựng nền bằng
   * "mọi tính năng thừa hưởng mô-đun cha". Nếu lúc chạy có tính năng KHÔNG
   * thừa hưởng nữa mà bảng vẫn tick sẵn, thì quản lý nhìn bảng tưởng NVBH
   * đã có "Công nợ NCC", còn menu của NVBH thì không có mục đó — rồi đi
   * tìm xem "app hỏng ở đâu".
   */
  it("nền của bảng cũng tôn trọng defaultRoles", () => {
    expect(PERM_PAGE).toContain(
      "if (feature.defaultRoles && !feature.defaultRoles.includes(role)) return []"
    )
  })
})
