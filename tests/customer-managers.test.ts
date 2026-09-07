import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { adoptNewKeys } from "../src/hooks/use-list-view-prefs"
import {
  buildManagers,
  scopeLabel,
  managersSummary,
  managersWarning,
  type AssignmentRow,
  type Manager,
} from "../src/lib/customers/managers"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Quét theo dòng — xem ghi chú ở tests/mobile-actions-lines.test.ts. */
const strip = (s: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (inBlock) { if (t.includes("*/")) inBlock = false; continue }
    if (t.startsWith("{/*") || t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}

const USERS = [
  { id: "u1", full_name: "Trần Bình", is_active: true },
  // Cố ý viết thường: nhập liệu thực tế có cả hai kiểu, và đây cũng là
  // ca DUY NHẤT phân biệt được localeCompare("vi") với so sánh mã ký tự
  // — "Bảo" (B=66) đứng trước "an nguyễn" (a=97) nếu so bằng mã.
  { id: "u2", full_name: "an nguyễn", is_active: true },
  { id: "u3", full_name: "Bảo", is_active: false },
]
const SUPPLIERS = [
  { id: "s1", name: "Vinamilk" },
  { id: "s2", name: "Bánh kẹo Hải Hà" },
]
const LINKS = [
  { user_id: "u1", supplier_id: "s1" },
  { user_id: "u2", supplier_id: "s2" },
  { user_id: "u2", supplier_id: "s1" },
]
const a = (o: Partial<AssignmentRow> & { user_id: string }): AssignmentRow => ({
  role: "secondary", status: "active", ...o,
})

describe("Ghép người phụ trách", () => {
  /** Cả bài này sinh ra vì một điểm bán có NHIỀU người, mỗi người một hàng. */
  it("giữ đủ nhiều người, không rút về một người chính", () => {
    const m = buildManagers(
      [a({ user_id: "u1", role: "primary" }), a({ user_id: "u2" })],
      USERS, LINKS, SUPPLIERS
    )
    expect(m).toHaveLength(2)
    expect(m.map((x) => x.fullName)).toEqual(["Trần Bình", "an nguyễn"])
  })

  it("người phụ trách chính lên đầu, còn lại xếp theo tên tiếng Việt", () => {
    const m = buildManagers(
      [a({ user_id: "u2" }), a({ user_id: "u3" }), a({ user_id: "u1", role: "primary" })],
      USERS, LINKS, SUPPLIERS
    )
    expect(m[0].fullName).toBe("Trần Bình")
    expect(m[0].isPrimary).toBe(true)
    // Thứ tự tiếng Việt: "an nguyễn" trước "Bảo". So bằng mã ký tự thì
    // ngược lại vì chữ hoa xếp trước chữ thường.
    expect(m.slice(1).map((x) => x.fullName)).toEqual(["an nguyễn", "Bảo"])
  })

  it("mỗi người kèm đúng ngành hàng của mình", () => {
    const m = buildManagers([a({ user_id: "u1" }), a({ user_id: "u2" })], USERS, LINKS, SUPPLIERS)
    expect(m.find((x) => x.userId === "u1")!.suppliers).toEqual(["Vinamilk"])
    // Sắp xếp tên NCC để thứ tự ổn định giữa các lần nạp.
    expect(m.find((x) => x.userId === "u2")!.suppliers).toEqual(["Bánh kẹo Hải Hà", "Vinamilk"])
  })

  /** ⚠ Phân công đã gỡ mà vẫn hiện là chỉ sai người để gọi. */
  it("bỏ phân công đã ngừng", () => {
    const m = buildManagers([a({ user_id: "u1", status: "inactive" })], USERS, LINKS, SUPPLIERS)
    expect(m).toHaveLength(0)
  })

  /**
   * ⚠ Ẩn người đã nghỉ đi thì điểm bán trông như "không ai phụ trách" và
   * không ai hiểu vì sao. Hiện ra kèm cờ thì gỡ được ngay.
   */
  it("người đã nghỉ vẫn hiện, có gắn cờ", () => {
    const m = buildManagers([a({ user_id: "u3" })], USERS, LINKS, SUPPLIERS)
    expect(m).toHaveLength(1)
    expect(m[0].userInactive).toBe(true)
  })

  /** RLS che mất dòng user → đừng lặng lẽ bỏ, sẽ báo thiếu người. */
  it("không tra được người thì vẫn hiện, đánh dấu không rõ", () => {
    const m = buildManagers([a({ user_id: "u-la" })], USERS, LINKS, SUPPLIERS)
    expect(m[0].unknownUser).toBe(true)
    expect(m[0].fullName).toBe("Không rõ người dùng")
  })

  /** Dữ liệu cũ có thể trùng dòng — hai dòng cùng tên trông như hai người. */
  it("cùng một người hai lần thì gộp", () => {
    const m = buildManagers([a({ user_id: "u1" }), a({ user_id: "u1", role: "primary" })], USERS, LINKS, SUPPLIERS)
    expect(m).toHaveLength(1)
  })

  /** NCC không tra được tên thì bỏ — uuid thô trên màn hình vô nghĩa. */
  it("không hiện id NCC thô khi thiếu tên", () => {
    const m = buildManagers(
      [a({ user_id: "u1" })], USERS,
      [{ user_id: "u1", supplier_id: "khong-co-trong-bang" }], SUPPLIERS
    )
    expect(m[0].suppliers).toEqual([])
  })
})

describe("Nhãn ngành hàng", () => {
  const mk = (suppliers: string[]): Manager => ({
    userId: "u", fullName: "X", isPrimary: false, userInactive: false, unknownUser: false, suppliers,
  })

  /**
   * ⚠ KHÔNG được viết "tất cả ngành hàng" khi rỗng. Theo RLS ở migration
   * 081, NVBH chưa gán NCC nào chỉ thấy sản phẩm không gắn NCC — tức là
   * gần như không bán được gì. Đó là thiếu sót, phải nói đúng như vậy.
   */
  it("rỗng nghĩa là CHƯA GÁN, không phải tất cả", () => {
    expect(scopeLabel(mk([]))).toBe("Chưa gán ngành hàng")
    expect(scopeLabel(mk([]))).not.toContain("tất cả")
  })

  it("có thì liệt kê ra", () => {
    expect(scopeLabel(mk(["Vinamilk", "Hải Hà"]))).toBe("Vinamilk, Hải Hà")
  })
})

describe("Tóm tắt cho ô bảng", () => {
  const mk = (name: string): Manager => ({
    userId: name, fullName: name, isPrimary: false, userInactive: false, unknownUser: false, suppliers: [],
  })

  it("chưa ai phụ trách thì nói ra", () => {
    expect(managersSummary([])).toBe("Chưa phân công")
  })

  /** Đổ 5 tên vào một ô bảng làm hàng cao gấp ba và cả bảng khó đọc. */
  it("nêu 2 tên rồi gộp phần còn lại", () => {
    expect(managersSummary([mk("A"), mk("B"), mk("C"), mk("D")])).toBe("A, B +2")
    expect(managersSummary([mk("A"), mk("B")])).toBe("A, B")
  })
})

describe("Cảnh báo cho người quản lý", () => {
  const mk = (o: Partial<Manager>): Manager => ({
    userId: "u", fullName: "X", isPrimary: true, userInactive: false, unknownUser: false, suppliers: ["V"], ...o,
  })

  it("không ai phụ trách", () => {
    expect(managersWarning([])).toContain("Chưa có ai phụ trách")
  })

  it("người đã nghỉ mà phân công còn treo", () => {
    expect(managersWarning([mk({ fullName: "Đã Nghỉ", userInactive: true })])).toContain("còn treo")
  })

  /**
   * ⚠ Không có người CHÍNH thì công nợ đầu kỳ và thông báo nhắc ảnh đều
   * không biết gửi cho ai — hai chỗ đó đều đọc `role = 'primary'`.
   */
  it("có người phụ nhưng không có người chính", () => {
    const w = managersWarning([mk({ isPrimary: false })])
    expect(w).toContain("CHÍNH")
  })

  it("có người chưa được gán ngành hàng", () => {
    expect(managersWarning([mk({ suppliers: [] })])).toContain("chưa được gán ngành hàng")
  })

  it("đủ cả thì im lặng", () => {
    expect(managersWarning([mk({})])).toBeNull()
  })
})

// =====================================================================
describe("Trang chi tiết khách hàng", () => {
  const PAGE = strip(read("src/app/(dashboard)/customers/[id]/page.tsx"))

  it("có khối Phụ trách điểm bán ở tab Tổng quan", () => {
    expect(PAGE).toContain("Phụ trách điểm bán")
    expect(PAGE).toContain("<CustomerManagers managers={managers} />")
  })

  /** ⚠ Không nạp user_suppliers thì cột ngành hàng luôn rỗng. */
  it("nạp ngành hàng của người phụ trách", () => {
    expect(PAGE).toContain('from("user_suppliers").select("user_id, supplier_id")')
    expect(PAGE).toContain("buildManagers(")
  })

  /** Không có ai phụ trách thì đừng bắn hai truy vấn thừa. */
  it("bỏ qua truy vấn khi chưa phân công cho ai", () => {
    expect(PAGE).toContain("if (managerIds.length === 0) {")
  })

  it("tab Phân công cũng thấy ngành hàng khi đang sửa", () => {
    const i = PAGE.indexOf('<TabsContent value="assignments"')
    expect(i).toBeGreaterThan(0)
    expect(PAGE.slice(i, i + 700)).toContain("<CustomerManagers")
  })
})

describe("Danh sách khách hàng", () => {
  const LIST = strip(read("src/app/(dashboard)/customers/page.tsx"))
  const TABLE = strip(read("src/components/customers/customer-table.tsx"))
  const CONFIG = read("src/app/(dashboard)/customers/list-config.ts")

  /**
   * ⚠ Truy vấn cũ lọc role='primary'. Giữ nguyên thì cột mới chỉ hiện
   * một người, đúng cái mà yêu cầu này muốn bỏ.
   */
  it("nạp ĐỦ người phụ trách, không chỉ người chính", () => {
    const i = LIST.indexOf('from("customer_assignments")')
    expect(i).toBeGreaterThan(0)
    const q = LIST.slice(i, LIST.indexOf("])", i))
    expect(q).not.toContain('.eq("role", "primary")')
    expect(q).toContain('.eq("status", "active")')
  })

  /**
   * ⚠ Nhưng bộ lọc "nhân viên phụ trách" vẫn phải hiểu là người CHÍNH —
   * thêm cột không được đổi nghĩa bộ lọc đang có.
   */
  it("bộ lọc theo NVBH vẫn chỉ tính người chính", () => {
    expect(LIST).toContain('if (a.role === "primary" && !repMap[a.customer_id])')
  })

  it("cột Phụ trách có trong cấu hình và hiện mặc định", () => {
    expect(CONFIG).toContain('{ key: "managers", label: "Phụ trách" }')
    // Cắt từ dấu "[" MỞ MẢNG, không từ tên hằng: `]` đầu tiên sau tên
    // nằm ngay trong kiểu `CustomerColumnKey[]` trên cùng dòng, nên lát
    // cắt rỗng và assert không đo được gì (đã đo).
    // Neo phải TỒN TẠI. Trước đây tôi tìm "DEFAULT_CUSTOMER_COLUMNS = "
    // trong khi khai báo có chú thích kiểu ở giữa, nên indexOf trả -1,
    // lát cắt chạy từ đầu file và trúng mảng CUSTOMER_COLUMNS — assert
    // vẫn xanh kể cả khi đã bỏ cột khỏi danh sách mặc định (đã đo).
    const decl = CONFIG.indexOf("DEFAULT_CUSTOMER_COLUMNS")
    expect(decl, "không thấy khai báo cột mặc định").toBeGreaterThan(0)
    const start = CONFIG.indexOf("[", CONFIG.indexOf("=", decl))
    expect(start).toBeGreaterThan(decl)
    const body = CONFIG.slice(start, CONFIG.indexOf("]", start))
    expect(body).toContain('"managers"')
  })

  it("bảng có cả tiêu đề lẫn ô cho cột mới", () => {
    expect(TABLE).toContain('{show("managers") && <TableHead>Phụ trách</TableHead>}')
    expect(TABLE).toContain("<CustomerManagersCell managers={managers[c.id] || []} />")
  })

  /** Điện thoại không có cột — phải nhét vào thẻ, không thì mất hẳn. */
  it("bản mobile cũng hiện người phụ trách", () => {
    expect(LIST).toContain("managersSummary(managersMap[c.id] || [])")
  })
})

describe("Khối hiển thị", () => {
  const CMP = strip(read("src/components/customers/customer-managers.tsx"))

  /** Ngành hàng là LÝ DO có nhiều người ở cùng một điểm bán. */
  it("hiện ngành hàng ở cả bản đầy đủ lẫn bản gọn", () => {
    expect(CMP.match(/scopeLabel\(m\)/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("đánh dấu người đã nghỉ ở cả hai bản", () => {
    expect(CMP.match(/m\.userInactive \|\| m\.unknownUser/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("phân biệt phụ trách chính với phụ", () => {
    expect(CMP).toContain('m.isPrimary ? "Phụ trách chính" : "Phụ"')
  })
})

// =====================================================================
describe("Tuỳ chọn cột đã lưu gặp cột MỚI", () => {
  const CAT = ["owner", "phone", "channel", "managers", "lastVisit"] as const
  type K = (typeof CAT)[number]

  /**
   * ⚠ ĐÂY LÀ LÝ DO cột "Phụ trách" không hiện dù đã thêm vào danh mục.
   * localStorage giữ danh sách cột từ trước; mã cũ chỉ LỌC BỎ key lạ, không
   * bao giờ THÊM key mới — nên ai đã từng mở bảng chọn cột sẽ không bao giờ
   * thấy cột mới, dù chú thích của hook hứa ngược lại.
   */
  it("dữ liệu lưu từ trước (chưa có `known`) thì nhận cột mới", () => {
    const saved: K[] = ["owner", "phone", "channel", "lastVisit"]
    expect(adoptNewKeys(saved, undefined, CAT)).toContain("managers")
  })

  it("giữ đúng thứ tự danh mục, không nối vào cuối", () => {
    const saved: K[] = ["owner", "phone", "channel", "lastVisit"]
    expect(adoptNewKeys(saved, undefined, CAT)).toEqual([
      "owner", "phone", "channel", "managers", "lastVisit",
    ])
  })

  /** Cột người dùng CỐ Ý tắt thì phải nằm im — đừng bật lại sau mỗi lần nạp. */
  it("cột đã tắt (có trong `known`) không bị bật lại", () => {
    const saved: K[] = ["owner", "phone"]
    const known: K[] = ["owner", "phone", "channel", "lastVisit"]
    const out = adoptNewKeys(saved, known, CAT)
    expect(out).not.toContain("channel")
    expect(out).not.toContain("lastVisit")
    // "managers" chưa từng có trong `known` → là cột MỚI → bật lên.
    expect(out).toContain("managers")
  })

  it("không có gì mới thì trả về nguyên si", () => {
    const saved: K[] = ["owner", "managers"]
    expect(adoptNewKeys(saved, [...CAT], CAT)).toEqual(saved)
  })

  it("danh sách lưu rỗng vẫn nhận cột mới", () => {
    expect(adoptNewKeys([] as K[], ["owner", "phone"] as K[], CAT)).toEqual([
      "channel", "managers", "lastVisit",
    ])
  })
})

describe("Hook lưu tuỳ chọn cột", () => {
  const HOOK = strip(read("src/hooks/use-list-view-prefs.ts"))

  it("CẢ HAI nhánh cột và bộ lọc đều đi qua adoptNewKeys", () => {
    const i = HOOK.indexOf("const raw = window.localStorage.getItem")
    expect(i).toBeGreaterThan(0)
    const load = HOOK.slice(i, HOOK.indexOf("}, [storageKey", i))
    // Soi TỪNG nhánh. Chỉ đếm "có chứa adoptNewKeys" là xanh cả khi một
    // nhánh đã bị gỡ, vì nhánh kia vẫn còn (đã đo).
    expect(load).toContain("parsed.knownColumns")
    expect(load).toContain("parsed.knownFilters")
    expect(load.match(/adoptNewKeys\(/g)?.length).toBe(2)
  })

  /** Không ghi `known` thì lần nạp sau lại coi mọi cột đã tắt là cột mới. */
  it("khi ghi có đóng dấu danh mục hiện tại", () => {
    expect(HOOK).toContain("knownColumns: [...defaultColsRef.current]")
    expect(HOOK).toContain("knownFilters: [...defaultFiltersRef.current]")
  })

  /**
   * ⚠ `persist` phải khai báo TRƯỚC effect nạp: effect đưa nó vào mảng
   * deps, mà mảng deps được đọc lúc render — một `const` đứng sau sẽ còn
   * trong vùng chết và nổ ReferenceError.
   */
  it("persist khai báo trước effect dùng nó", () => {
    expect(HOOK.indexOf("const persist = useCallback")).toBeLessThan(
      HOOK.indexOf("const raw = window.localStorage.getItem")
    )
    expect(HOOK).toContain("}, [storageKey, persist])")
  })
})
