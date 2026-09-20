import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * BỐN TAB PHẢI PHỦ HẾT SÁU TRẠNG THÁI — chủ nhà báo 20/09/2026: "đơn
 * hàng hoàn thành xong thấy biến mất luôn, không ở bên hoàn thành".
 *
 * ⚠ ĐƠN KHÔNG MẤT, NÓ RƠI VÀO KHE GIỮA CÁC TAB. Ràng buộc
 * `chk_sales_orders_status_v2` (mig 119) cho phép SÁU giá trị:
 *   draft · submitted · partially_invoiced · completed · closed · cancelled
 * Màn đơn có bốn tab, và trước hôm nay mỗi tab lọc đúng MỘT trạng thái —
 * nên `partially_invoiced` và `closed` không nằm trong tab nào. Đã dựng
 * lại trên Postgres thật: một đơn xuất thiếu một dòng ra
 * `partially_invoiced`, và không tab nào thấy nó.
 *
 * ⚠ VÀ ĐÂY KHÔNG PHẢI NGOẠI LỆ HIẾM. Từ 20/09/2026 nhân viên được đặt
 * vượt tồn (chủ nhà chốt), nên xuất thiếu là chuyện THƯỜNG.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const ORDERS = read("src/app/(dashboard)/orders/page.tsx")
const TABLE = read("src/components/orders/desktop-order-table.tsx")
const DRAWER = read("src/components/orders/order-drawer.tsx")
const MIG124 = read("supabase/migrations/124_wf2b_sales_invoices.sql")

/** Sáu trạng thái mà database cho phép — đọc từ chính migration. */
const ALL_STATUSES = [
  "draft", "submitted", "partially_invoiced", "completed", "closed", "cancelled",
] as const

describe("không trạng thái nào rơi khỏi màn hình", () => {
  /**
   * ⚠ ĐỌC TỪ MIGRATION, KHÔNG VIẾT TAY. Danh sách viết tay trong test sẽ
   * đứng yên khi database thêm trạng thái thứ bảy, và chốt này im lặng
   * đúng lúc cần kêu nhất.
   */
  it("danh sách trạng thái trong test khớp ràng buộc của database", () => {
    /**
     * ⚠ ĐỌC Ở MIG 124, KHÔNG PHẢI 119. Mig 119 chỉ cho bốn giá trị; mig
     * 124 mới nới ràng buộc lên sáu khi thêm `partially_invoiced` và
     * `closed`. Đọc nhầm file là chốt này tự xác nhận một sự thật đã cũ.
     */
    const i = MIG124.lastIndexOf("chk_sales_orders_status_v2")
    const blk = MIG124.slice(i, MIG124.indexOf(";", i))
    for (const st of ALL_STATUSES) {
      expect(blk, `mig 124 không còn trạng thái ${st}`).toContain(`'${st}'`)
    }
  })

  /** Mỗi trạng thái phải nằm trong đúng một nhóm tab, hoặc là `draft`. */
  it("mỗi trạng thái có đúng một chỗ trong bốn tab", () => {
    const i = ORDERS.indexOf("const TAB_STATUSES")
    expect(i, "không tìm thấy bảng nhóm trạng thái").toBeGreaterThan(0)
    const decl = ORDERS.slice(i, ORDERS.indexOf("\n}", i))

    for (const st of ALL_STATUSES) {
      const hits = (decl.match(new RegExp(`"${st}"`, "g")) ?? []).length
      if (st === "draft") {
        /**
         * ⚠ `draft` CỐ Ý KHÔNG CÓ TAB: màn này không làm được gì với một
         * bản nháp, và chính sách SELECT của mig 119 chỉ cho mỗi người
         * thấy nháp của mình. Nó vẫn nằm trong "Tất cả", và nút
         * "N đơn nháp" ở đầu trang dẫn sang /sell/drafts.
         */
        expect(hits, "draft không được có tab riêng").toBe(0)
        continue
      }
      expect(hits, `trạng thái ${st} không nằm trong tab nào`).toBe(1)
    }
  })

  /**
   * ⚠ ĐƠN XUẤT MỘT PHẦN VỀ "PHIẾU TẠM" — nó còn hàng phải giao, nên
   * thuộc hàng đợi việc, không phải cột đã xong.
   */
  /**
   * ⚠ "XUẤT MỘT PHẦN" CÓ VIÊN RIÊNG (chủ nhà chốt 20/09/2026: "thêm
   * stats thống kê cạnh Hoàn thành"). Bản trước gộp nó vào "Phiếu tạm";
   * chủ nhà muốn thấy riêng con số ấy, và dải viên thuốc cuộn ngang
   * không còn giới hạn số ô nên gộp cũng không còn lý do.
   *
   * ⚠ `closed` VẪN ĐI CÙNG "HOÀN THÀNH": cả hai đều là KẾT, không còn gì
   * để giao. Huy hiệu trên từng dòng vẫn phân biệt (xanh / xám đậm) nên
   * gộp tab không xoá mất khác biệt — xem chốt huy hiệu bên dưới.
   */
  it("xuất một phần có viên riêng, đóng đơn đi cùng Hoàn thành", () => {
    const i = ORDERS.indexOf("const TAB_STATUSES")
    const decl = ORDERS.slice(i, ORDERS.indexOf("\n}", i))
    expect(decl).toContain('submitted: ["submitted"]')
    expect(decl).toContain('partially_invoiced: ["partially_invoiced"]')
    expect(decl).toContain('completed: ["completed", "closed"]')
  })

  /**
   * ⚠ LỌC BẰNG `.in(...)`, KHÔNG `.eq(...)`. Đây là chỗ biến bảng nhóm ở
   * trên thành hành vi thật; thiếu nó thì bảng chỉ là chú thích.
   */
  it("truy vấn lọc theo cả nhóm trạng thái", () => {
    expect(ORDERS).toContain('x.in("status", group)')
    // Và giá trị KHÔNG phải tab (deep-link ?status=draft) vẫn lọc đúng nó.
    expect(ORDERS).toContain('x.eq("status", status)')
  })

  /**
   * ⚠ SỐ TRÊN THẺ PHẢI LÀ SỐ CỦA CẢ NHÓM. Đếm riêng `submitted` rồi dán
   * lên tab đang lọc hai trạng thái là con số trên thẻ nhỏ hơn số dòng
   * đếm được ngay bên dưới nó.
   */
  it("số đếm trên thẻ cộng theo nhóm", () => {
    expect(ORDERS).toContain("for (const [tab, group] of Object.entries(TAB_STATUSES))")
    expect(ORDERS).toContain("group.reduce((n, st) => n + (counts[st] ?? 0), 0)")
    // Và phải đếm đủ sáu trạng thái thì mới cộng ra được.
    const i = ORDERS.indexOf("const COUNTED_STATUSES")
    const decl = ORDERS.slice(i, ORDERS.indexOf("] as const", i))
    for (const st of ALL_STATUSES) {
      expect(decl, `không đếm ${st}`).toContain(`"${st}"`)
    }
  })
})

describe("đơn xuất một phần vẫn xuất tiếp được", () => {
  /**
   * ⚠ BA CHỖ PHẢI NÓI CÙNG MỘT LUẬT. Thanh chọn nhiều vốn đã nhận cả đơn
   * xuất một phần; nút trên từng dòng và nút trong ngăn xem nhanh thì
   * bỏ sót, nên người dùng phải mở từng đơn một chỉ để bấm đúng cái nút
   * ấy — và bây giờ đơn xuất một phần còn nằm ngay trong tab Phiếu tạm.
   */
  it.each([
    ["bảng máy tính", "src/components/orders/desktop-order-table.tsx"],
    ["ngăn xem nhanh", "src/components/orders/order-drawer.tsx"],
  ])("%s: nút Xuất hàng nhận cả đơn xuất một phần", (_l, rel) => {
    const src = read(rel).replace(/\s+/g, " ")
    expect(src).toMatch(
      /const pending =[^=]*?status === "submitted" \|\| \w+\.status === "partially_invoiced"/
    )
  })

  it("thanh chọn nhiều vẫn nhận cả hai trạng thái", () => {
    expect(ORDERS.replace(/\s+/g, " ")).toContain(
      '(o) => o.status === "submitted" || o.status === "partially_invoiced"'
    )
  })

  /** Huy hiệu vẫn phân biệt `completed` với `closed` dù chung một tab. */
  it("gộp tab không xoá mất khác biệt trên huy hiệu", () => {
    const TONE = read("src/lib/orders/status-tone.ts")
    const i = TONE.indexOf("const TONES")
    const decl = TONE.slice(i, TONE.indexOf("\n}", i))
    expect(decl).toContain("completed:")
    expect(decl).toContain("closed:")
    const green = /completed: \{ bg: "([^"]+)"/.exec(decl)?.[1]
    const grey = /closed: \{ bg: "([^"]+)"/.exec(decl)?.[1]
    expect(green).toBeTruthy()
    expect(grey).toBeTruthy()
    expect(grey, "closed và completed dùng chung màu").not.toBe(green)
  })
})

/** Một chốt độc lập với các chốt trên, và cũng là câu tôi đã hứa với chủ nhà. */
describe("gộp tab KHÔNG làm mất đơn theo chiều ngược lại", () => {
  /**
   * ⚠ "TẤT CẢ" VẪN PHẢI LÀ TẤT CẢ. Gộp nhóm xong mà tab "Tất cả" đi lọc
   * theo nhóm thì nó hoá thành tab thứ tư trùng nội dung — và `draft`
   * lại mất chỗ.
   */
  it("tab Tất cả không lọc trạng thái nào", () => {
    const i = ORDERS.indexOf("const applyStatusFilter")
    const fn = ORDERS.slice(i, ORDERS.indexOf("\n  }", i))
    expect(fn).toContain('if (status === "all") return x as T')
  })
})
