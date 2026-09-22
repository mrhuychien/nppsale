import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  NAV_PERMISSION,
  LEGACY_V2_HREFS,
  canSeeHref,
  filterByPermission,
  filterNavGroups,
  duocVaoTrang,
} from "../src/lib/nav/nav-permission"
import {
  setPermissionsCache,
  rowsToCache,
  ROLES,
  RETIRED_ROLES,
  ROLE_LABELS,
} from "../src/lib/permissions"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const SIDEBAR = read("src/components/layout/sidebar.tsx")
const HOME = read("src/app/(dashboard)/home/page.tsx")
const MOBILE_NAV = read("src/components/layout/mobile-nav.tsx")

/**
 * Mã đã bỏ chú thích.
 *
 * ⚠ Phần giải thích trong mã có nhắc lại nguyên văn đoạn code CŨ đã sai
 * ("if (!role) return TILES") — nhắc để người sau khỏi làm lại. Soi cả
 * chú thích thì phép kiểm bắt nhầm lời giải thích và ép phải xoá nó đi,
 * tức là phạt đúng việc nên làm.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const HOME_CODE = stripComments(HOME)

/** Mọi `href: "…"` trong một danh sách menu. */
const hrefsIn = (src: string) =>
  (src.match(/href: "\/[^"]*"/g) ?? []).map((s) => s.slice('href: "'.length, -1))

/** Lưới Trang chủ — chỉ lấy trong mảng TILES, không lấy href trong JSX. */
const TILES_BLOCK = HOME.slice(HOME.indexOf("const TILES: Tile[] = ["), HOME.indexOf("\n]\n", HOME.indexOf("const TILES: Tile[] = [")))

const MENUS = [
  { name: "ngăn kéo (sidebar)", hrefs: hrefsIn(SIDEBAR) },
  { name: "lưới Trang chủ", hrefs: hrefsIn(TILES_BLOCK) },
  { name: "thanh dưới màn hình", hrefs: hrefsIn(MOBILE_NAV) },
]

afterEach(() => setPermissionsCache(null))

describe("Ba menu tra chung MỘT bảng quyền", () => {
  /**
   * ⚠ LỖI GỐC. Ngăn kéo kiểm tới TÍNH NĂNG (`payables`,
   * `finance.cash_receipts`), còn lưới Trang chủ chỉ kiểm tới MÔ-ĐUN
   * (`receivables`). Thu hồi quyền "Công nợ NCC" của một vai trò thì ngăn
   * kéo giấu đi, nhưng ô trên Trang chủ vẫn còn — hai câu trả lời khác
   * nhau cho cùng một câu hỏi.
   */
  it.each(MENUS)("$name: mọi đường dẫn đều có khai quyền", ({ hrefs }) => {
    expect(hrefs.length).toBeGreaterThan(0)
    for (const h of hrefs) {
      expect(NAV_PERMISSION[h], `chưa khai quyền cho ${h}`).toBeTruthy()
    }
  })

  /**
   * ⚠ Không màn nào được tự kiểm quyền nữa. Còn một chỗ tự kiểm là còn
   * chỗ cho hai câu trả lời — và chỗ đó sẽ lệch, vì nó đã lệch một lần.
   */
  it.each([
    { file: "sidebar.tsx", src: stripComments(SIDEBAR) },
    { file: "home/page.tsx", src: HOME_CODE },
    { file: "mobile-nav.tsx", src: stripComments(MOBILE_NAV) },
  ])("$file không tự gọi canAccessModule / canAccessFeature", ({ src }) => {
    expect(src).not.toContain("canAccessModule(")
    expect(src).not.toContain("canAccessFeature(")
    expect(src).not.toContain("hasPermission(")
    expect(src).toContain('from "@/lib/nav/nav-permission"')
  })

  /**
   * ⚠ Soi ĐÚNG HÌNH DẠNG câu lệnh lọc, không phải "có nhắc tới hàm kia ở
   * đâu đó trong file".
   *
   * Phép kiểm bản đầu chỉ đòi file có chứa chuỗi `canSeeHref(`. Thử phá
   * cho thấy nó nói dối: đổi phép lọc của ngăn kéo thành `group.items`
   * nguyên xi (hiện đủ mọi mục cho mọi vai trò) mà phép kiểm vẫn XANH, vì
   * `canSeeHref(` còn nằm ở dòng nút "Tạo đơn mới".
   */
  it("ngăn kéo lọc bằng đúng một câu, không tự chế lại", () => {
    expect(stripComments(SIDEBAR)).toMatch(
      /const visibleGroups = filterNavGroups\(role, NAV_GROUPS\)/
    )
  })

  it("thanh dưới lọc bằng đúng một câu, không tự chế lại", () => {
    const src = stripComments(MOBILE_NAV)
    expect(src).toMatch(
      /const items = filterByPermission\(role, ROLE_NAV\[role\] \|\| ROLE_NAV\.sales\)\.slice\(0, 4\)/
    )
    expect(src).toMatch(
      /const showAction = !!action && canSeeHref\(role, action\.href\) && items\.length >= 2/
    )
  })

  it("lưới Trang chủ lọc bằng đúng một câu, không tự chế lại", () => {
    expect(HOME_CODE).toMatch(
      /const visibleTiles = useMemo\(\(\) => filterByPermission\(role, TILES\), \[role\]\)/
    )
  })

  /**
   * ⚠ ĐÍCH CỦA MỘT NÚT, KHÔNG PHẢI MỘT MỤC MENU. Ba đường này vẫn là
   * trang thật, `useRoleGuard` vẫn phải canh cửa, nhưng người dùng tới
   * đó bằng cách bấm nút chứ không bằng cách mở ngăn kéo.
   *
   * ⚠ DANH SÁCH NÀY PHẢI NGẮN VÀ PHẢI GIẢI THÍCH ĐƯỢC. Nó là lỗ duy
   * nhất trong chốt "khai quyền mà không dùng là rác"; thêm một đường
   * vào đây mà không có nút thật trỏ tới là tự tay đục lỗ. Chốt ngay
   * dưới đi tìm đúng cái nút ấy trong mã nguồn.
   */
  const NUT_KHONG_PHAI_MENU: Record<string, string> = {
    "/sell": "nút CTA \"Tạo đơn mới\"",
    "/inventory/stock-in": "nút \"Tạo phiếu → Nhập kho\" ở màn Phiếu kho",
    "/inventory/stock-issue": "nút \"Tạo phiếu → Xuất kho\" ở màn Phiếu kho",
    "/inventory/stocktake-adjust": "nút \"Tạo phiếu → Kiểm kê\" ở màn Phiếu kho (và hai nút ở màn Điều chỉnh)",
    "/purchasing/invoices": "ô tra cứu trên trang Mua hàng (rời khỏi menu 20/09/2026)",
  }

  /**
   * ⚠ KHAI LÀ "ĐÍCH CỦA NÚT" THÌ PHẢI CÓ NÚT THẬT. Không kiểm điều này
   * thì `NUT_KHONG_PHAI_MENU` biến thành chỗ nhét mọi khai quyền chết —
   * đúng thứ mà chốt "không có khai quyền thừa" sinh ra để chặn.
   */
  it("mỗi đường ngoài menu đều có nút thật trỏ tới", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "src/app/(dashboard)/inventory/entries/page.tsx"),
      "utf-8"
    )
    for (const href of ["/inventory/stock-in", "/inventory/stock-issue", "/inventory/stocktake-adjust"]) {
      expect(
        ENTRIES.includes(`router.push("${href}")`),
        `khai ${href} là đích của nút, nhưng màn Phiếu kho không có nút nào trỏ tới`
      ).toBe(true)
    }
    /**
     * ⚠ "Hoá đơn mua (tra cứu)" RỜI KHỎI MENU chứ không bị xoá (chủ nhà
     * chốt 20/09/2026: "bỏ Hoá đơn mua"). Ô trên trang Mua hàng là cửa
     * vào DUY NHẤT còn lại — gỡ nốt nó là một trang còn sống mà không
     * ai tới được, và khai quyền cho nó thành rác thật.
     */
    const PURCHASING_HUB = readFileSync(
      resolve(__dirname, "..", "src/app/(dashboard)/purchasing/page.tsx"),
      "utf-8"
    )
    expect(
      PURCHASING_HUB.includes('href: "/purchasing/invoices"'),
      "trang Mua hàng không còn ô nào dẫn tới /purchasing/invoices — trang đó thành không tới được"
    ).toBe(true)
  })

  /** Khai quyền mà không dùng thì là rác — và rác che mất chỗ thiếu. */
  it("không có khai quyền thừa", () => {
    const used = new Set(MENUS.flatMap((m) => m.hrefs))
    for (const h of Object.keys(NUT_KHONG_PHAI_MENU)) used.add(h)
    for (const h of Object.keys(NAV_PERMISSION)) {
      expect(used.has(h), `khai quyền cho ${h} nhưng không menu nào dùng`).toBe(true)
    }
  })
})

describe("Phép lọc dùng chung", () => {
  const GROUPS = [
    {
      label: "Kế toán",
      items: [
        { label: "Công nợ", href: "/receivables" },
        { label: "Phiếu thu", href: "/finance/cash-receipts" },
      ],
    },
    { label: "Cài đặt", items: [{ label: "Phân quyền", href: "/settings/permissions" }] },
  ]

  it("bỏ mục không có quyền", () => {
    const got = filterByPermission("warehouse", [
      { href: "/inventory" },
      { href: "/customers" },
      { href: "/settings/permissions" },
    ])
    expect(got.map((g) => g.href)).toEqual(["/inventory"])
  })

  /**
   * ⚠ MÀN LUỒNG CŨ ẨN VỚI MỌI VAI TRÒ, KỂ CẢ CHỦ. Gài bằng quyền là
   * không giấu được: `canAccessFeature` trả true vô điều kiện cho owner,
   * mà chủ nhà đúng là người dùng chính của những màn đó.
   */
  it("phép lọc bỏ luôn màn của luồng cũ", () => {
    for (const role of ["owner", "manager", "warehouse", "driver"] as const) {
      const got = filterByPermission(role, [{ href: "/deliveries" }, { href: "/orders" }])
      expect(got.map((g) => g.href), `${role} vẫn thấy màn luồng cũ`).not.toContain("/deliveries")
    }
  })

  it("chưa biết vai trò thì trả danh sách rỗng", () => {
    expect(filterByPermission(null, [{ href: "/orders" }, { href: "/help" }])).toEqual([])
    expect(filterNavGroups(null, GROUPS)).toEqual([])
  })

  /** Nhóm trống trơn trông như menu hỏng, không như "bạn không có quyền". */
  it("nhóm không còn mục nào thì bỏ luôn cả nhóm", () => {
    const got = filterNavGroups("sales", GROUPS)
    expect(got.map((g) => g.label)).toEqual(["Kế toán"])
  })

  it("chủ doanh nghiệp giữ nguyên mọi nhóm", () => {
    const got = filterNavGroups("owner", GROUPS)
    expect(got.map((g) => g.label)).toEqual(["Kế toán", "Cài đặt"])
    expect(got[0].items).toHaveLength(2)
  })
})

describe("Hai cửa đóng sẵn", () => {
  /**
   * ⚠ Bản cũ của lưới Trang chủ là `if (!role) return TILES` — trong lúc
   * chờ hồ sơ tải, MỌI người thấy đủ 23 ô, kể cả Phân quyền và Nhân sự.
   * Đoán rộng khi chưa biết là cách nhanh nhất để lộ màn hình không nên lộ.
   */
  it("chưa biết vai trò thì không thấy gì", () => {
    expect(canSeeHref(null, "/orders")).toBe(false)
    expect(canSeeHref(undefined, "/settings/permissions")).toBe(false)
    // Kể cả mục "luôn hiện" — chưa đăng nhập xong thì chưa có menu nào cả.
    expect(canSeeHref(null, "/help")).toBe(false)
    expect(HOME_CODE).not.toContain("if (!role) return TILES")
  })

  /**
   * ⚠ Thêm mục menu mà quên khai quyền thì mục đó phải BIẾN MẤT, không
   * được mở toang. Phép kiểm ở trên bắt ngay lúc dựng, nhưng mặc định lúc
   * chạy cũng phải là "cấm".
   */
  it("đường dẫn chưa khai thì coi như cấm", () => {
    for (const role of ROLES) {
      expect(canSeeHref(role, "/mot-trang-moi-chua-khai")).toBe(false)
    }
  })
})

describe("Từng vai trò chỉ thấy phần của mình", () => {
  /** ⚠ Trừ màn của luồng cũ — chúng ẩn với mọi vai trò, xem `LEGACY_V2_HREFS`. */
  it("chủ doanh nghiệp thấy tất cả, trừ màn luồng cũ đã ẩn", () => {
    for (const h of Object.keys(NAV_PERMISSION)) {
      if (LEGACY_V2_HREFS.has(h)) continue
      expect(canSeeHref("owner", h), h).toBe(true)
    }
    // Và danh sách ẩn không được rỗng — rỗng nghĩa là P7 đã bị gỡ.
    expect(LEGACY_V2_HREFS.size).toBeGreaterThan(0)
  })

  /**
   * ⚠ CHỐT NÀY ĐÃ ĐẢO CHIỀU, CÓ CHỦ Ý — chủ nhà chốt "bỏ driver".
   *
   * Bản cũ chốt tài xế KHÔNG thấy Khách hàng / Kho / Cài đặt nhưng VẪN
   * thấy màn thu tiền. Từ mig 122 vai này ngưng dùng: nó không còn hàng
   * nào trong ma trận quyền, nên `hasPermission` trả false ở MỌI ô.
   *
   * ⚠ Đó là lý do mig 122 phải KHOÁ các tài khoản đó. Một vai không có
   * quyền gì mà vẫn đăng nhập được thì người dùng thấy một ứng dụng
   * trống trơn, không câu nào giải thích — đúng kiểu hỏng âm thầm cả
   * đợt này đang chống.
   */
  it("vai đã ngưng dùng không còn thấy gì", () => {
    for (const href of [
      "/customers",
      "/inventory",
      "/settings",
      "/deliveries",
      "/receivables/collect",
      "/orders",
    ]) {
      expect(canSeeHref("driver", href), `${href} vẫn hiện cho vai đã bỏ`).toBe(false)
    }
  })

  /** `driver` không còn nằm trong danh sách vai gán được. */
  it("driver biến khỏi danh sách vai gán được, nhưng nhãn còn lại", () => {
    expect(ROLES).not.toContain("driver")
    expect(RETIRED_ROLES).toContain("driver")
    // ⚠ Bỏ nhãn là ô "Vai trò" của tài khoản cũ trống trơn ở màn Người dùng.
    expect(ROLE_LABELS.driver).toContain("ngưng dùng")
  })

  it("thủ kho không thấy Khách hàng và Công nợ", () => {
    expect(canSeeHref("warehouse", "/customers")).toBe(false)
    expect(canSeeHref("warehouse", "/receivables")).toBe(false)
    expect(canSeeHref("warehouse", "/inventory")).toBe(true)
  })

  /**
   * ⚠ ĐÂY LÀ CÁI LƯỚI TRANG CHỦ ĐANG HIỆN SAI. Bốn ô Chi phí / Nhân sự /
   * Phân quyền / Cài đặt đều thuộc mô-đun `settings`, mà NVBH có
   * `settings: []`. Kiểm theo mô-đun thì đúng ra đã giấu — nhưng kiểm
   * theo tính năng mới giấu đúng phần còn lại.
   */
  it("nhân viên bán hàng không thấy Cài đặt, Nhân sự, Phân quyền", () => {
    expect(canSeeHref("sales", "/settings")).toBe(false)
    expect(canSeeHref("sales", "/settings/permissions")).toBe(false)
    expect(canSeeHref("sales", "/hr")).toBe(false)
    expect(canSeeHref("sales", "/finance/expenses")).toBe(false)
  })

  /** Chỉ được XEM đơn thì không được thấy nút "Tạo đơn mới". */
  it("vai trò không có quyền tạo thì không thấy đường tạo đơn", () => {
    setPermissionsCache(
      rowsToCache([{ role: "sales", module: "orders", action: "create", allowed: false }])
    )
    expect(canSeeHref("sales", "/orders")).toBe(true)
    expect(canSeeHref("sales", "/sell")).toBe(false)
  })
})

describe("Thu hồi quyền TÍNH NĂNG thì mọi menu đều giấu", () => {
  /**
   * ⚠ Đây chính là ca đã lệch ngoài đời. Thu hồi riêng `payables` mà vẫn
   * giữ mô-đun `receivables`: kiểm theo mô-đun sẽ vẫn cho thấy, kiểm theo
   * tính năng mới giấu. Vì cả ba menu nay dùng chung `canSeeHref`, giấu
   * một lần là giấu cả ba.
   */
  it("thu hồi 'Công nợ NCC' của quản lý", () => {
    expect(canSeeHref("manager", "/payables")).toBe(true)
    setPermissionsCache(
      rowsToCache(
        (["read", "create", "update", "delete", "approve", "export"] as const).map((a) => ({
          role: "manager" as const,
          module: "payables",
          action: a,
          allowed: false,
        }))
      )
    )
    expect(canSeeHref("manager", "/payables")).toBe(false)
    // Công nợ khách hàng KHÔNG bị ảnh hưởng — thu hồi phải trúng đích.
    expect(canSeeHref("manager", "/receivables")).toBe(true)
  })

  it("thu hồi 'Phiếu thu' của kế toán", () => {
    expect(canSeeHref("accountant", "/finance/cash-receipts")).toBe(true)
    setPermissionsCache(
      rowsToCache(
        (["read", "create", "update", "delete", "approve", "export"] as const).map((a) => ({
          role: "accountant" as const,
          module: "finance.cash_receipts",
          action: a,
          allowed: false,
        }))
      )
    )
    expect(canSeeHref("accountant", "/finance/cash-receipts")).toBe(false)
  })
})

describe("Trợ giúp và Trang chủ không bị giấu nhầm", () => {
  /**
   * ⚠ "Trợ giúp" thuộc mô-đun `settings` trên lưới Trang chủ. Kiểm theo
   * mô-đun thì NVBH (`settings: []`) mất luôn trang hướng dẫn — trong khi
   * ngăn kéo vẫn hiện "Hỗ trợ". Đúng kiểu lệch mà bảng chung phải dẹp.
   */
  it("mọi vai trò đều vào được Trợ giúp và Trang chủ", () => {
    for (const role of ROLES) {
      expect(canSeeHref(role, "/help"), role).toBe(true)
      expect(canSeeHref(role, "/home"), role).toBe(true)
    }
  })

  it("hai mục đó khai rõ là luôn hiện", () => {
    expect(NAV_PERMISSION["/help"].always).toBe(true)
    expect(NAV_PERMISSION["/home"].always).toBe(true)
  })
})

describe("Lưới Trang chủ lúc chờ và lúc rỗng", () => {
  /** Chưa biết vai trò → khung xương, không phải lưới đầy đủ. */
  it("có khung xương trong lúc chờ hồ sơ", () => {
    expect(HOME).toContain("loading: authLoading")
    expect(HOME).toContain("{authLoading ? (")
    expect(HOME).toContain("animate-pulse")
  })

  /**
   * ⚠ Rỗng vì TÌM KIẾM và rỗng vì CHƯA ĐƯỢC CẤP QUYỀN là hai chuyện khác
   * nhau. Nói "Thử từ khóa khác" cho người không có quyền là chỉ họ đi
   * làm một việc vô ích.
   */
  it("phân biệt rỗng do tìm kiếm với rỗng do chưa được cấp quyền", () => {
    expect(HOME).toContain("Chưa có tính năng nào được cấp")
    expect(HOME).toContain("Liên hệ quản lý để được cấp quyền.")
    expect(HOME).toContain("Không tìm thấy tính năng")
  })
})


/**
 * ⚠ MÀN LÀM ĐỔI TỒN KHO THẬT CHỈ MỞ CHO NGƯỜI GHI ĐƯỢC TỒN KHO.
 *
 *   Đo trên Postgres 16 (22/09/2026), lập phiếu kiểm kê nháp đúng như
 *   màn `/inventory/stocktake-adjust` lập:
 *     owner ĐƯỢC · warehouse ĐƯỢC · manager, accountant, sales: 42501
 *
 *   Trước khi khai `action: "create"` cho màn ấy, `duocVaoTrang` cho CẢ
 *   NĂM VAI vào — người ta đếm xong cả kho rồi mới bị từ chối lúc lưu.
 *
 * ⚠ CHỐT CHẠY LUẬT CỬA VÀO, không soi bảng khai. Soi bảng khai thì một
 *   đột biến đổi `create` thành `read` đi lọt nếu chốt chỉ hỏi "có khai
 *   không".
 */
describe("cửa vào màn ghi kho khớp chính sách database", () => {
  const VAI = ["owner", "manager", "accountant", "warehouse", "sales"] as const
  const GHI_DUOC = new Set(["owner", "warehouse"])

  it.each(["/inventory/stock-in", "/inventory/stock-issue", "/inventory/stocktake-adjust"])(
    "%s chỉ mở cho owner và warehouse",
    (href) => {
      for (const v of VAI) {
        expect(
          duocVaoTrang(v, href, "inventory"),
          `${v} ${GHI_DUOC.has(v) ? "không vào được" : "vào được — đếm xong mới bị từ chối lúc lưu"} ${href}`
        ).toBe(GHI_DUOC.has(v))
      }
    }
  )
})
