import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import {
  canSeeHref,
  canEnterHref,
  duocVaoTrang,
  laManLuongCu,
  LEGACY_V2_HREFS,
  NAV_PERMISSION,
} from "../src/lib/nav/nav-permission"
import { LEGACY_FLOW_WRITES_LOCKED, LEGACY_LOCK_HINT } from "../src/lib/nav/legacy-flow"

/**
 * P7 — ẩn module luồng cũ, KHÔNG xoá mã.
 *
 * Ba việc khác nhau, phải không lẫn vào nhau:
 *   1. ẨN khỏi menu — `canSeeHref`;
 *   2. vẫn VÀO XEM được chứng từ cũ — `canEnterHref`;
 *   3. KHOÁ các nút GHI — `LEGACY_FLOW_WRITES_LOCKED`.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const STOCK_OUT = read("src/app/(dashboard)/inventory/stock-out/page.tsx")
const ENTRIES = read("src/app/(dashboard)/inventory/entries/[id]/page.tsx")
const COLLECT = read("src/app/(dashboard)/inventory/stock-out/collect/[entryId]/page.tsx")
const HANDOVER = read("src/app/(dashboard)/deliveries/[id]/handover/page.tsx")
const PENDING = read("src/app/(dashboard)/inventory/pending/page.tsx")
const HUB = read("src/app/(dashboard)/inventory/page.tsx")
const ENTRIES_LIST = read("src/app/(dashboard)/inventory/entries/page.tsx")

/**
 * ⚠ TRANG TRỢ GIÚP PHẢI ĐỌC BẢN ĐÃ BỎ CHÚ THÍCH. Khối chú thích đầu tệp
 * kể lại luồng cũ để giải thích VÌ SAO phải đổi — chữ "Đã duyệt" nằm ở
 * đó là đúng chỗ. Hỏi cả chú thích thì chốt bắt nhầm chính lời giải
 * thích, và cách "sửa" duy nhất là xoá lời giải thích đi.
 */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const HELP = code(read("src/app/(dashboard)/help/page.tsx"))

/**
 * Cắt đúng THÂN của khối `if (…) { … }` bắt đầu tại `from`, bằng cách đếm
 * ngoặc.
 *
 * ⚠ ĐỪNG THAY BẰNG `slice(from, from + N).toContain("return")`. Đã thử:
 * chốt vẫn xanh sau khi bỏ hẳn `return` khỏi guard, vì trong cửa sổ đó
 * còn một `return` khác của hàm (`if (!user?.org_id) return`). Chốt hỏi
 * "có chữ return quanh đây không" là chốt không hỏi gì cả.
 */
function braceBlock(src: string, from: number): string {
  const open = src.indexOf("{", from)
  if (open < 0) return ""
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1)
  }
  return ""
}

describe("Ẩn khỏi menu, nhưng vẫn mở được chứng từ cũ", () => {
  it("ba màn luồng cũ nằm trong danh sách ẩn", () => {
    for (const h of ["/deliveries", "/inventory/stock-out", "/inventory/pending"]) {
      expect(LEGACY_V2_HREFS.has(h), `${h} chưa được ẩn`).toBe(true)
    }
  })

  /**
   * ⚠ GÀI BẰNG QUYỀN LÀ KHÔNG GIẤU ĐƯỢC. `canAccessFeature` trả true vô
   * điều kiện cho `owner`, mà chủ nhà đúng là người dùng chính của những
   * màn này — nên phải là một danh sách riêng, xét TRƯỚC mọi phép kiểm.
   */
  it("ẩn với MỌI vai trò, kể cả chủ", () => {
    for (const role of ["owner", "manager", "warehouse", "sales", "accountant"] as const) {
      expect(canSeeHref(role, "/deliveries"), `${role} vẫn thấy`).toBe(false)
    }
  })

  /**
   * ⚠ LUẬT NÀY ĐÃ ĐỔI 22/09/2026, chủ nhà chốt: CHẶN HẲN.
   *
   *   Luật cũ là "ẩn ≠ chặn": dữ liệu luồng cũ là chứng từ nên gõ thẳng
   *   đường dẫn vẫn vào XEM được. Lý lẽ ấy đứng được khi màn chỉ để
   *   xem. Nhưng `/inventory/stock-out` KHÔNG chỉ xem — đã đo trên
   *   Postgres 16: nó chèn `stock_entries` và `swap_stock_movements`
   *   xong mới đổi đơn sang `picking`, một trạng thái workflow v2 không
   *   có, nên lệnh cuối ném và hai lệnh đầu đã ghi. Không cùng giao
   *   dịch. Mỗi lần ai đó gõ vào rồi bấm là sổ kho thêm một phiếu mồ
   *   côi.
   *
   *   Cái mất đã được cân nhắc và nói ra: không còn mở lại phiếu soạn
   *   hàng / chuyến giao / biên bản bàn giao bằng đường dẫn nữa.
   */
  it("chặn cửa vào với mọi vai trò, kể cả chủ", () => {
    expect(NAV_PERMISSION["/deliveries"], "bảng quyền mất mục này thì chốt soi chỗ trống").toBeTruthy()
    for (const role of ["owner", "manager", "warehouse", "sales", "accountant"] as const) {
      expect(canEnterHref(role, "/deliveries"), `${role} vẫn vào được`).toBe(false)
    }
  })

  /**
   * ⚠ MÀN CON MỚI LÀ CHỖ CÓ NÚT BẤM, và chúng KHÔNG khai trong
   *   `NAV_PERMISSION` nên `useRoleGuard` rơi về phép kiểm mô-đun. Chặn
   *   đúng ba đường gốc là bỏ ngỏ đúng phần nguy hiểm.
   */
  it("chặn cả màn con, không chỉ ba đường gốc", () => {
    for (const href of [
      "/deliveries/abc-123",
      "/deliveries/abc-123/settle",
      "/inventory/stock-out/collect/xyz-9",
      "/inventory/pending/gi-do",
    ]) {
      expect(laManLuongCu(href), `${href} lọt lưới`).toBe(true)
      expect(canEnterHref("owner", href), `${href} vẫn vào được`).toBe(false)
    }
  })

  /** ⚠ Tiền tố phải kèm dấu `/` — nếu không, một màn mới tên gần giống bị chặn oan. */
  it("không chặn nhầm đường dẫn chỉ trùng tiền tố", () => {
    expect(laManLuongCu("/deliveries-v2"), "chặn oan một màn khác").toBe(false)
    expect(laManLuongCu("/inventory"), "chặn oan cả màn kho").toBe(false)
    expect(laManLuongCu("/inventory/entries"), "chặn oan phiếu kho").toBe(false)
  })

  /**
   * ⚠ CHẠY LUẬT, ĐỪNG SOI CHỮ. Bản trước của chốt này đọc tệp
   *   `use-role-guard.ts` và kiểm xem có chuỗi `laManLuongCu(` không.
   *   Đã đột biến thử: đổi thành `false && laManLuongCu(...)` — chữ còn
   *   nguyên, luật chết, chốt vẫn XANH. Vì thế luật đã được tách ra
   *   thành `duocVaoTrang`, và chốt gọi thẳng nó.
   *
   * ⚠ CA QUAN TRỌNG NHẤT LÀ ĐƯỜNG DẪN ĐỘNG. `/deliveries/<id>/settle`
   *   không khai trong `NAV_PERMISSION`, nên nếu luồng cũ không được
   *   xét trước thì nó rơi về phép kiểm mô-đun `deliveries` — mà thủ
   *   kho CÓ quyền ấy, tức vào được.
   */
  it("cửa vào chặn cả đường dẫn động của luồng cũ", () => {
    expect(
      duocVaoTrang("warehouse", "/deliveries/abc/settle", "deliveries"),
      "thủ kho vẫn vào được màn đối soát của luồng đã bỏ"
    ).toBe(false)
    expect(
      duocVaoTrang("owner", "/inventory/stock-out/collect/x1", "receivables"),
      "chủ nhà vẫn vào được màn thu hộ của luồng đã bỏ"
    ).toBe(false)
    expect(duocVaoTrang("owner", "/deliveries", "deliveries")).toBe(false)
  })

  /** ⚠ Và KHÔNG được chặn lan sang màn còn dùng. */
  it("cửa vào không chặn nhầm màn đang dùng", () => {
    expect(duocVaoTrang("owner", "/inventory/entries", "inventory")).toBe(true)
    expect(duocVaoTrang("owner", "/orders/abc-123", "orders")).toBe(true)
  })

  /** Chưa đăng nhập thì không vào đâu cả. */
  it("chưa có vai trò thì không vào được", () => {
    expect(duocVaoTrang(null, "/orders", "orders")).toBe(false)
  })

  /**
   * ⚠ CHẶN Ở `canEnterHref` CHỈ ĂN KHI MÀN GỌI `useRoleGuard`. Thêm một
   *   `page.tsx` mới dưới ba thư mục ấy mà quên gọi là cửa mở lại, và
   *   không có gì báo — màn mới chỉ đơn giản là vào được.
   */
  it("mọi màn của luồng cũ đều có cửa gác", () => {
    const thieu: string[] = []
    const duyet = (dir: string) => {
      for (const ten of readdirSync(dir)) {
        const p = join(dir, ten)
        if (statSync(p).isDirectory()) duyet(p)
        else if (ten === "page.tsx" && !readFileSync(p, "utf-8").includes("useRoleGuard")) {
          thieu.push(p.slice(ROOT.length + 1))
        }
      }
    }
    for (const goc of ["deliveries", "inventory/stock-out", "inventory/pending"]) {
      duyet(resolve(ROOT, "src/app/(dashboard)", goc))
    }
    expect(thieu, "màn luồng cũ không gọi useRoleGuard — chặn không tới").toEqual([])
  })

  /**
   * ⚠ LINK CÒN SÓT LÀ MỘT NGÕ CỤT. Chặn cửa vào mà để nguyên link ở màn
   *   khác thì người dùng bấm và bị đá về trang chủ, không lời giải
   *   thích. Ba chỗ từng có: chi tiết đơn (máy tính và điện thoại) và
   *   chi tiết phiếu thu.
   */
  it("không màn nào còn link dẫn vào luồng cũ", () => {
    const pham: string[] = []
    const duyet = (dir: string) => {
      for (const ten of readdirSync(dir)) {
        const p = join(dir, ten)
        if (statSync(p).isDirectory()) {
          if (/(deliveries|stock-out|pending)$/.test(p)) continue
          duyet(p)
        } else if (/\.tsx?$/.test(ten)) {
          const rel = p.slice(ROOT.length + 1)
          if (/nav-permission|use-role-guard|mobile-nav|sidebar|header/.test(rel)) continue
          const b = readFileSync(p, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "")
          if (/href=\{?["'`]?\/(deliveries|inventory\/stock-out|inventory\/pending)\//.test(b)) {
            pham.push(rel)
          }
        }
      }
    }
    duyet(resolve(ROOT, "src"))
    expect(pham, "còn link dẫn vào màn đã chặn — bấm vào là bị đá về trang chủ").toEqual([])
  })

  /** Ẩn khỏi menu mà để lại ô trên màn kho thì vẫn bấm tới được. */
  it("màn kho không còn ô bấm sang hai màn đã ẩn", () => {
    expect(HUB).toContain('LEGACY_V2_HREFS.has("/inventory/stock-out")')
    expect(HUB).toContain('LEGACY_V2_HREFS.has("/inventory/pending")')
  })

  /**
   * ⚠ "TẠO PHIẾU" LÀ LỜI MỜI TẠO MỚI, không phải đường tra cứu. Mục
   * "Xuất kho" trong đó dẫn tới màn soạn hàng đã khoá ghi — bấm vào chỉ
   * nhận một dòng chữ từ chối, ở một màn không ai giải thích vì sao lại
   * mở ra được.
   */
  /**
   * ⚠ CANH HÀNH VI, KHÔNG CANH CÁCH VIẾT. Bản đầu đòi có đúng câu
   * `!LEGACY_V2_HREFS.has("/inventory/stock-out")` bọc quanh mục menu —
   * tức là ép một CÁCH LÀM. Khi mục ấy được thay hẳn bằng đường mới
   * (`/inventory/stock-issue`, 20/09/2026) thì chốt đỏ dù hành vi đã
   * đúng hơn trước: giờ không còn dòng nào trỏ về màn cũ, chứ không
   * phải chỉ bị ẩn đi.
   *
   * Thứ thật sự phải canh: "Tạo phiếu" KHÔNG được dẫn tới màn soạn hàng
   * đã khoá ghi ở P7 — bấm vào đó chỉ nhận một dòng từ chối.
   */
  it("danh sách phiếu kho không mời tạo phiếu xuất theo lối cũ", () => {
    expect(ENTRIES_LIST, "vẫn còn đường dẫn tới màn soạn hàng đã khoá ghi")
      .not.toContain('router.push("/inventory/stock-out")')
    expect(ENTRIES_LIST, "mất luôn cửa tạo phiếu xuất kho lẻ")
      .toContain('router.push("/inventory/stock-issue")')
  })
})

/**
 * ⚠ BỘ DEMO KHÔNG CHÈN ĐƯỢC NỮA THÌ NGƯỜI CÀI MỚI ĐỨNG GIỮA ĐƯỜNG. Các
 * tệp `supabase/mockup/*.sql` chèn thẳng `sales_orders.status` và
 * `returns.status`. Sau mig 119, `chk_sales_orders_status_v2` và
 * `chk_returns_status_v2` từ chối năm giá trị của luồng cũ — mỗi INSERT
 * đó ném ràng buộc, và bộ demo dừng lại với nửa dữ liệu đã nằm trong
 * CSDL.
 */
describe("Bộ dữ liệu demo chèn được sau migration 119", () => {
  const sqlOf = (rel: string) =>
    // Bỏ chú thích `--` để không bắt nhầm chính lời giải thích vì sao
    // các giá trị đó đã chết.
    read(rel).replace(/^\s*--.*$/gm, "")

  const ORDERS = sqlOf("supabase/mockup/05_sales_orders.sql")
  const RETURNS = sqlOf("supabase/mockup/07_returns_visits.sql")

  it("không còn trạng thái đơn nào của luồng cũ", () => {
    for (const dead of ["'confirmed'", "'picking'", "'delivering'", "'pending_approval'"]) {
      expect(ORDERS, `còn chèn ${dead}`).not.toContain(dead)
    }
  })

  it("không còn trạng thái phiếu trả nào của luồng cũ", () => {
    for (const dead of ["'approved'", "'rejected'", "'pending'"]) {
      expect(RETURNS, `còn chèn ${dead}`).not.toContain(dead)
    }
  })

  /**
   * ⚠ `completed` NGHĨA LÀ ĐÃ TRỪ TỒN VÀ ĐÃ GHI CÔNG NỢ. Đơn demo nào
   * mang giá trị đó phải có mốc `completed_at`, nếu không màn hình hiện
   * ô trống ở đúng cột nói "hàng đi lúc nào".
   */
  it("đơn hoàn thành trong bộ demo đều có mốc xuất hàng", () => {
    const n = (ORDERS.match(/'completed'/g) || []).length
    expect(n, "bộ demo không còn đơn hoàn thành nào").toBeGreaterThan(0)
    expect((ORDERS.match(/completed_at/g) || []).length).toBeGreaterThanOrEqual(n)
  })

  /**
   * ⚠ ĐỂ PHIẾU TRẢ Ở `completed` LÀ DỰNG SẴN HAI CON SỐ NÓI DỐI: tồn
   * thiếu đúng bằng số hàng trả, công nợ thừa đúng bằng credit_note.
   * Bộ demo không có phiếu nhập kho nào kèm theo.
   */
  it("phiếu trả demo nằm chờ, chưa nhập kho", () => {
    expect(RETURNS).toContain("'submitted'")
    expect(RETURNS).not.toContain("'completed'")
  })
})

/**
 * ⚠ CẨM NANG SAI KHÔNG BẮN LỖI NÀO. Người dùng đọc trang Trợ giúp rồi đi
 * làm theo; nó còn dạy luồng sáu trạng thái thì họ đi tìm nút Duyệt, tìm
 * màn Giao hàng, và kết luận hệ thống hỏng.
 */
describe("Trang Trợ giúp dạy đúng quy trình v2", () => {
  it("không còn chữ nào của sáu trạng thái cũ", () => {
    for (const dead of ["Đang lấy", "Đang giao", "Đã duyệt", "6 trạng thái", "delivered"]) {
      expect(HELP, `còn dạy '${dead}'`).not.toContain(dead)
    }
  })

  it("nói đúng bốn trạng thái mới", () => {
    expect(HELP).toContain("Nháp → Phiếu tạm → Hoàn thành")
    expect(HELP).toContain("status = completed")
  })

  /** Ô module dẫn thẳng sang màn đã ẩn — không lọc quyền, nên phải bỏ. */
  it("không còn ô module dẫn sang màn giao hàng", () => {
    expect(HELP).not.toContain('href: "/deliveries"')
  })

  /**
   * ⚠ BỎ ĐI MÀ KHÔNG NÓI LÀ BỎ THÌ NGƯỜI DÙNG ĐI TÌM. Câu hỏi thường gặp
   * phải trả lời thẳng "màn đó đâu rồi".
   */
  it("trả lời thẳng vì sao màn Giao hàng / Xuất kho biến mất", () => {
    expect(HELP).toContain("Sao tôi không tìm thấy màn Giao hàng / Xuất kho nữa?")
  })
})

describe("Khoá nút GHI của luồng cũ", () => {
  /**
   * ⚠ ĐỂ NGUYÊN THÌ TỆ HƠN LÀ BÁO LỖI. Ba màn này ghi theo NHIỀU BƯỚC
   * rời nhau và bước đổi trạng thái đơn nằm ở CUỐI — mà migration 119 nay
   * từ chối trạng thái đó. Người dùng không nhận được "bấm vào thì báo
   * lỗi", họ nhận được GHI DỞ: kho đã trừ hoặc tiền đã ghi, đơn thì
   * không đổi, không giao dịch nào cuộn lại.
   */
  it("năm hàm ghi đều chặn ở ĐẦU, trước khi ghi gì", () => {
    const CASES: Array<[string, string, string]> = [
      ["soạn hàng", STOCK_OUT, "const handleMerge = async () => {"],
      ["phiếu kho", ENTRIES, "const handleSelfDeliver = async () => {"],
      ["thu theo phiếu xuất", COLLECT, "const handleSubmit = async () => {"],
      ["bàn giao", HANDOVER, "const handleSubmit = async () => {"],
      ["hàng chờ", PENDING, "const handleRestock = async () => {"],
    ]
    for (const [name, src, anchor] of CASES) {
      const i = src.indexOf(anchor)
      expect(i, `không tìm thấy hàm ghi của ${name}`).toBeGreaterThan(0)
      const head = src.slice(i, i + 1400)
      expect(head, `${name}: chưa chặn`).toContain("if (LEGACY_FLOW_WRITES_LOCKED) {")
      const guardAt = head.indexOf("if (LEGACY_FLOW_WRITES_LOCKED)")
      // ⚠ Phải `return` — cảnh báo rồi chạy tiếp thì vẫn ghi dở. Và phải
      //   là lệnh CUỐI của guard, không phải một chữ `return` nào đó ở
      //   gần đấy.
      expect(braceBlock(head, guardAt), `${name}: cảnh báo nhưng không dừng`).toMatch(
        /\breturn\b\s*\}$/
      )
      // Và phải nằm TRƯỚC mọi lệnh ghi của hàm.
      const writeAt = head.search(/\.(insert|update|delete)\(/)
      if (writeAt >= 0) {
        expect(guardAt, `${name}: chặn nằm SAU lệnh ghi`).toBeLessThan(writeAt)
      }
    }
  })

  it("khoá đang bật, và mỗi màn có câu chỉ đường thay thế", () => {
    expect(LEGACY_FLOW_WRITES_LOCKED).toBe(true)
    for (const k of ["stock-out", "entries", "collect", "handover", "pending"]) {
      expect(LEGACY_LOCK_HINT[k], `thiếu câu chỉ đường cho ${k}`).toBeTruthy()
      // ⚠ Nói THAY BẰNG GÌ, không chỉ nói "không dùng được nữa" — người
      // dùng đang có việc cần làm.
      expect(LEGACY_LOCK_HINT[k].length).toBeGreaterThan(40)
    }
  })

  /**
   * ⚠ HAI MÀN NÀY LÀ CHỖ GIAO DIỆN LÀ LỚP CHẶN DUY NHẤT. Bảng `returns`
   * không có trigger chặn chuyển trạng thái, và mig 120 đã gỡ trigger
   * nhập kho tự động — nên lệnh đẩy phiếu trả vào 'completed' VẪN CHẠY
   * THÀNH CÔNG mà hàng không vào kho. Cơ sở dữ liệu không cãi.
   */
  it("hai màn ghi thẳng phiếu trả nói rõ vì sao giao diện phải chặn", () => {
    for (const src of [HANDOVER, PENDING]) {
      expect(src).toContain("GIAO DIỆN LÀ LỚP CHẶN DUY")
    }
  })
})
