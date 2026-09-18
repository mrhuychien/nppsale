import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildOrderTimeline,
  dayLabel,
  groupOrdersByDay,
  orderTone,
  vnDateKey,
} from "../src/lib/orders/status-tone"
import { hidesMobileAppBar } from "../src/lib/nav/mobile-chrome"
import { ORDER_STATUS_MAP } from "../src/lib/constants"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const LIST = code(read("src/app/(dashboard)/orders/page.tsx"))
const DETAIL = code(read("src/app/(dashboard)/orders/[id]/page.tsx"))
const MLIST = code(read("src/components/orders/mobile-order-list.tsx"))
const MDETAIL = code(read("src/components/orders/mobile-order-detail.tsx"))
const REORDER = code(read("src/app/(dashboard)/sell/reorder/[id]/page.tsx"))
const SHELL = code(read("src/components/layout/dashboard-shell.tsx"))
const HEADER = code(read("src/components/layout/header.tsx"))
const TONE = code(read("src/lib/orders/status-tone.ts"))

/**
 * Hai màn làm lại theo mẫu thiết kế "Đơn của tôi" / "Chi tiết đơn"
 * (claude.ai/artifact/EHVDpeVPTSTEjmMw1AWcPL). Mẫu là bản mobile; desktop
 * giữ nguyên. Mọi chốt dưới đây giữ những chỗ mẫu đẹp nhưng DỮ LIỆU THẬT
 * không cho phép làm y hệt — và ghi vì sao.
 */

describe("Huy hiệu trạng thái: một màu cho mỗi TÌNH TRẠNG, không phải mỗi cột status", () => {
  /**
   * ⚠ Workflow v2 bỏ trạng thái ảo "Chờ duyệt": đã gửi là `submitted`,
   * một trạng thái thật. Nháp chưa gửi và phiếu tạm vẫn phải hai màu khác
   * nhau, không thì NVBH lưu tạm xong tưởng đã gửi rồi ngồi đợi.
   */
  it("nháp chưa gửi và phiếu tạm ra hai huy hiệu khác nhau", () => {
    const draft = orderTone("draft")
    const submitted = orderTone("submitted")
    expect(draft.label).toBe("Nháp")
    expect(submitted.label).toBe("Phiếu tạm")
    expect(draft.bg).not.toBe(submitted.bg)
    expect(submitted.accent).toBe("#fdb022")
  })

  it("nhãn lấy từ ORDER_STATUS_MAP — desktop và mobile không viết hai kiểu", () => {
    for (const k of ["draft", "submitted", "completed", "cancelled"]) {
      expect(orderTone(k).label).toBe(ORDER_STATUS_MAP[k].label)
    }
    expect(TONE).toContain("ORDER_STATUS_MAP[status]?.label ?? status")
  })

  it("trạng thái lạ không làm vỡ màn: rơi về màu nháp, giữ nguyên chữ", () => {
    const t = orderTone("weird")
    expect(t.label).toBe("weird")
    expect(t.bg).toBe(orderTone("draft").bg)
  })
})

describe("Nhóm theo ngày: 'Hôm nay' / 'Hôm qua' theo giờ Việt Nam", () => {
  // 17/9/2026 00:30 giờ VN = 16/9 17:30 UTC — đúng ranh giới mà tính theo
  // UTC sẽ xếp nhầm sang "Hôm qua".
  const now = new Date("2026-09-16T17:30:00Z")

  it("cột DATE so bằng chuỗi, không đi qua new Date()", () => {
    expect(vnDateKey(now)).toBe("2026-09-17")
    expect(dayLabel("2026-09-17", now)).toBe("Hôm nay")
    expect(dayLabel("2026-09-16", now)).toBe("Hôm qua")
    expect(dayLabel("2026-09-01", now)).toBe("01/09/2026")
    expect(TONE).toContain('const key = (orderDate || "").slice(0, 10)')
  })

  it("giữ thứ tự đầu vào, cộng tổng từng nhóm", () => {
    const g = groupOrdersByDay(
      [
        { id: "a", order_date: "2026-09-17", total: 100 },
        { id: "b", order_date: "2026-09-17", total: 50 },
        { id: "c", order_date: "2026-09-16", total: 7 },
      ],
      now
    )
    expect(g.map((x) => x.label)).toEqual(["Hôm nay", "Hôm qua"])
    expect(g[0].items.map((x) => x.id)).toEqual(["a", "b"])
    expect(g[0].total).toBe(150)
    expect(g[1].total).toBe(7)
  })
})

describe("Dòng thời gian dựng từ dữ liệu THẬT, không bịa giờ", () => {
  const base = {
    created_at: "2026-09-17T01:00:00Z",
    sales_user: { full_name: "Nam" },
  }

  /** Ba bước, đúng ba trạng thái thật của workflow v2. */
  it("đơn mới gửi: Tạo đơn → Gửi đơn, chưa tới bước xuất hàng", () => {
    const t = buildOrderTimeline(
      { ...base, status: "submitted", submitted_at: "2026-09-17T01:05:00Z" },
      []
    )
    expect(t.map((s) => s.key)).toEqual(["draft", "submitted", "completed"])
    expect(t[1].done).toBe(true)
    expect(t[1].current).toBe(true)
    expect(t[1].at).toBe("2026-09-17T01:05:00Z")
    expect(t[2].done).toBe(false)
    expect(t[2].at).toBeNull()
  })

  /** ⚠ Không có mốc giờ thì để trống — mẫu thiết kế bịa giờ cho đẹp, app thì không. */
  it("mốc giờ lấy từ order_status_history, thiếu thì null", () => {
    const t = buildOrderTimeline({ ...base, status: "completed" }, [
      { to_status: "submitted", changed_at: "2026-09-17T02:00:00Z", changer: { full_name: "Nam" } },
      { to_status: "completed", changed_at: "2026-09-17T03:00:00Z", changer: { full_name: "Kho" } },
    ])
    const byKey = Object.fromEntries(t.map((s) => [s.key, s]))
    expect(byKey.submitted.at).toBe("2026-09-17T02:00:00Z")
    expect(byKey.submitted.by).toBe("Nam")
    expect(byKey.completed.at).toBe("2026-09-17T03:00:00Z")
    expect(byKey.completed.current).toBe(true)
  })

  /**
   * ⚠ CHỐT NÀY SINH RA TỪ MỘT LẦN THỬ PHÁ. Bỏ điều kiện `done ? at : null`
   * mà bộ kiểm thử vẫn xanh — vì mọi ca đang có đều không có mốc giờ cho
   * bước chưa tới. Ca thật thì có: đơn phiếu tạm bị RÚT VỀ NHÁP; lịch sử
   * vẫn giữ mốc "Gửi đơn 10:15", nhưng bước đó bây giờ CHƯA xong. In mốc
   * cũ lên là kể rằng đơn đang nằm ở nhà phân phối, đúng điều vừa bị rút.
   */
  it("bước quay lại sau khi rút đơn về nháp: không xong, không in mốc giờ cũ", () => {
    const t = buildOrderTimeline({ ...base, status: "draft" }, [
      { to_status: "submitted", changed_at: "2026-09-17T02:00:00Z", changer: { full_name: "Nam" } },
      { to_status: "draft", changed_at: "2026-09-17T05:00:00Z" },
    ])
    const byKey = Object.fromEntries(t.map((s) => [s.key, s]))
    expect(byKey.draft.current).toBe(true)
    expect(byKey.submitted.done).toBe(false)
    expect(byKey.submitted.at).toBeNull()
    expect(byKey.submitted.by).toBeNull()
  })

  it("đơn huỷ: giữ bước đã qua, kết bằng bước huỷ tô đỏ, không vẽ bước chưa tới", () => {
    const t = buildOrderTimeline({ ...base, status: "cancelled" }, [
      { to_status: "submitted", changed_at: "2026-09-17T02:00:00Z" },
      { to_status: "cancelled", changed_at: "2026-09-17T04:00:00Z", changer: { full_name: "Chủ" } },
    ])
    expect(t.map((s) => s.key)).toEqual(["draft", "submitted", "cancelled"])
    const last = t[t.length - 1]
    expect(last.error).toBe(true)
    expect(last.by).toBe("Chủ")
    expect(last.at).toBe("2026-09-17T04:00:00Z")
  })
})

describe("Danh sách đơn mobile theo mẫu", () => {
  it("dùng MobileOrderList, không còn MobileRecordCard, giữ chế độ chọn", () => {
    expect(LIST).toContain("<MobileOrderList")
    expect(LIST).not.toContain("MobileRecordCard")
    expect(LIST).toContain("onToggle={toggleOne}")
    expect(LIST).toContain("onEnterSelect={(id) => {")
    expect(LIST).toContain("showSalesName={!isSales}")
  })

  /** Băng "N đơn chờ đẩy lên khi có mạng" lấy từ hộp chờ thật, không phải số cứng. */
  it("băng ngoại tuyến đọc từ useOrderSync", () => {
    expect(LIST).toContain("const { pendingCount: outboxCount } = useOrderSync()")
    expect(LIST).toContain("{outboxCount} đơn chờ đẩy lên khi có mạng")
  })

  it("chip trạng thái theo mẫu: 34px, chọn = nền tối, số đếm trong viên", () => {
    expect(LIST).toContain('"border-on-surface bg-on-surface text-surface"')
    expect(LIST).toContain("h-[34px]")
    expect(LIST).toContain("aria-pressed={active}")
  })

  it("hàng đơn: vạch màu, tên khách, dòng phụ, tổng, huy hiệu; cả hàng là một vùng chạm", () => {
    expect(MLIST).toContain("style={{ background: accent }}")
    expect(MLIST).toContain("groupOrdersByDay(orders, now)")
    expect(MLIST).toContain("{g.items.length} đơn · {formatCurrency(g.total)}")
    expect(MLIST).not.toContain("<Checkbox")
    // Nhấn giữ: bộ đếm trong ref, huỷ khi trượt, chặn click sau khi nổ.
    expect(MLIST).toContain("const timer = useRef<number | null>(null)")
    expect(MLIST).toContain("> 10) clear()")
    expect(MLIST).toContain("if (fired.current) {")
  })

  /** NVBH xem đơn của mình thì tên NVBH trên dòng phụ là thừa. */
  it("tên NVBH chỉ in khi xem đơn của nhiều người", () => {
    expect(MLIST).toContain("showSalesName ? o.sales_user?.full_name : null")
  })
})

describe("Chi tiết đơn mobile theo mẫu", () => {
  it("bản mobile là màn đọc; đang sửa thì quay về bản có ô nhập", () => {
    expect(DETAIL).toContain("const mobileTemplate = !linesEditMode && !editMode")
    expect(DETAIL).toContain('<div className={mobileTemplate ? "hidden lg:block space-y-4" : "space-y-4"}>')
    expect(DETAIL).toContain("{mobileTemplate && (")
    expect(DETAIL).toContain("<MobileOrderDetail")
  })

  it("khung cảnh báo / nháp là MỘT JSX cho cả hai bản", () => {
    expect(DETAIL).toContain("const callouts = (")
    expect(DETAIL).toContain("callout={callouts}")
    expect(DETAIL).toContain("{callouts}")
    expect(DETAIL.match(/Bản nháp — chưa gửi/g)?.length).toBe(1)
  })

  /**
   * ⚠ WORKFLOW V2 KHÔNG CÓ NGƯỜI DUYỆT. Chữ "duyệt" còn sót lại trên màn
   * là chỉ người dùng đi chờ một bước không tồn tại: NVBH ngồi đợi ai đó
   * duyệt, trong khi việc thật là nhà phân phối bấm Xuất hàng.
   */
  it("không còn chữ gửi duyệt / chờ duyệt trên màn chi tiết", () => {
    expect(DETAIL).not.toContain("Gửi duyệt")
    expect(DETAIL).not.toContain("chờ duyệt")
    expect(DETAIL).not.toContain("handleSendForApproval")
  })

  /**
   * ⚠ "Sửa đơn" và "Đặt lại đơn này" KHÔNG được đứng trước một bước
   * chuyển trạng thái. Quản lý mở đơn chờ duyệt thì nút to phải là Duyệt.
   */
  it("nút chính: bước chuyển trạng thái trước, rồi mới tới Sửa / Đặt lại", () => {
    expect(DETAIL).toContain("const mobilePrimary = primaryTransition")
    expect(DETAIL).toContain("? null")
    expect(DETAIL).toContain(": deliveredNext ?? editAction ?? reorderAction")
    expect(DETAIL).toContain("const sellEdit = canEdit && isSellEditable(order.status)")
    expect(DETAIL).toContain('router.push(`/sell/reorder/${order.id}`)')
    // Nút không làm nút chính thì vào menu ⋮, đứng TRƯỚC Xoá đơn.
    const i = DETAIL.indexOf("{mobileExtras.map((a) => (")
    const j = DETAIL.indexOf("Xóa đơn hàng", i)
    expect(i).toBeGreaterThan(0)
    expect(j).toBeGreaterThan(i)
  })

  it("app bar chuẩn ẩn trên điện thoại cho route chi tiết đơn, desktop vẫn có", () => {
    expect(hidesMobileAppBar("/orders/abc-123")).toBe(true)
    expect(hidesMobileAppBar("/orders")).toBe(false)
    expect(hidesMobileAppBar("/orders/abc/edit")).toBe(false)
    expect(hidesMobileAppBar("/sell/cart")).toBe(false)
    expect(SHELL).toContain('className={hidesMobileAppBar(pathname) ? "hidden lg:flex" : undefined}')
    expect(HEADER).toContain("export function Header({ onMenuClick, className }: HeaderProps)")
  })

  it("thẻ khách có nút gọi; sản phẩm đã xoá nói thẳng", () => {
    expect(MDETAIL).toMatch(/href=\{`tel:\$\{customer\.phone\}`\}/)
    expect(MDETAIL).toContain("Sản phẩm đã xoá")
  })

  /** ⚠ Số lấy từ đơn đã lưu — không cộng lại từ dòng thành một con số thứ hai. */
  it("tổng tiền lấy từ đơn đã lưu, không cộng lại", () => {
    expect(MDETAIL).toContain("formatCurrency(order.subtotal)")
    expect(MDETAIL).toContain("formatCurrency(order.vat)")
    expect(MDETAIL).toContain("formatCurrency(order.total)")
    expect(MDETAIL).not.toMatch(/lines\.reduce\(/)
  })

  it("dòng thời gian không in giờ khi không biết", () => {
    expect(MDETAIL).toContain("{t.at ? `${formatDate(t.at)} ${vnTime(t.at)}` : \"\"}")
  })
})

describe("Đặt lại đơn này = đơn MỚI, giá HÔM NAY", () => {
  it("giỏ không mang editing, giá gán bằng giá bảng hiện hành", () => {
    expect(REORDER).toContain("editing: null,")
    expect(REORDER).toContain("price: r.listPrice,")
    expect(REORDER).toContain('router.replace("/sell/cart")')
  })

  /** Mặt hàng không còn trong danh mục thì bỏ và NÓI RA. */
  it("bỏ mặt hàng không còn trong danh mục và báo số bỏ", () => {
    expect(REORDER).toContain("const known = lines.filter((l) => products.some((p) => p.id === l.product_id))")
    expect(REORDER).toContain("Bỏ ${missing} mặt hàng không còn trong danh mục")
    expect(REORDER).toContain("Không mặt hàng nào của đơn này còn trong danh mục")
  })

  it("giỏ đang có hàng thì hỏi trước khi thay", () => {
    expect(REORDER).toContain("const clash = cart.ready && cart.cart.length > 0 && !confirmed")
    expect(REORDER).toContain("Thay giỏ, đặt lại đơn này")
  })
})
