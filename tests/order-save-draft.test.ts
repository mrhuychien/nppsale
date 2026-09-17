import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { gateForSave, DRAFT_APPROVAL_REASON, type SaveGateInput } from "../src/lib/orders/save-gate"

const ROOT = resolve(__dirname, "..")
const FORM = readFileSync(resolve(ROOT, "src/components/orders/order-form.tsx"), "utf-8")
const FORM_CODE = FORM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const input = (over: Partial<SaveGateInput> = {}): SaveGateInput => ({
  asDraft: false,
  hasCustomer: true,
  lineCount: 2,
  overstock: [],
  allowOversell: false,
  priceViolations: [],
  ...over,
})

describe("Lưu nháp: nới đúng chỗ nên nới", () => {
  /**
   * Đó chính là lúc cần lưu nháp nhất — đang đứng ở quầy, ghi được tên
   * khách thì khách bận.
   */
  it("nháp lưu được khi chưa có mặt hàng nào", () => {
    expect(gateForSave(input({ asDraft: true, lineCount: 0 })).block).toBeNull()
  })

  it("đơn thật vẫn phải có hàng", () => {
    const g = gateForSave(input({ asDraft: false, lineCount: 0 }))
    expect(g.block?.title).toContain("thêm sản phẩm")
  })

  /**
   * ⚠ Bản nháp không ra kho hôm nay, mà tồn kho đổi từng giờ — chặn một
   * bản nháp vì tồn của lúc này là chặn nhầm. Nhưng vẫn phải NÓI.
   */
  it("nháp chỉ cảnh báo khi vượt tồn, không chặn", () => {
    const g = gateForSave(input({ asDraft: true, overstock: ["Sữa: cần 5, còn 2"] }))
    expect(g.block).toBeNull()
    expect(g.warn?.title).toContain("vượt tồn")
    expect(g.warn?.description).toContain("Sữa")
  })

  it("đơn thật vẫn chặn khi vượt tồn", () => {
    const g = gateForSave(input({ overstock: ["Sữa: cần 5, còn 2"] }))
    expect(g.block?.title).toBe("Số lượng vượt tồn kho")
  })

  it("NPP bật cho phép bán vượt tồn thì đơn thật chỉ cảnh báo", () => {
    const g = gateForSave(input({ overstock: ["Sữa: cần 5, còn 2"], allowOversell: true }))
    expect(g.block).toBeNull()
    expect(g.warn?.title).toContain("vượt tồn")
  })
})

describe("Lưu nháp KHÔNG được thành đường vòng", () => {
  /**
   * ⚠ LỖ HỔNG DỄ TẠO RA NHẤT Ở TÍNH NĂNG NÀY. Nếu nháp bỏ qua giá sàn thì
   * "Lưu nháp" là cách bán dưới giá sàn: lưu nháp giá thấp rồi nhờ duyệt —
   * mà bước duyệt KHÔNG kiểm lại giá sàn. Thẩm quyền của một NVBH không
   * đổi theo thời gian, nên nháp phải chặn y như đơn thật.
   */
  it("nháp vẫn chặn giá dưới sàn, y như đơn thật", () => {
    for (const asDraft of [true, false]) {
      const g = gateForSave(input({ asDraft, priceViolations: ["Sữa: thấp hơn sàn 5%"] }))
      expect(g.block?.title, `asDraft=${asDraft}`).toBe("Giá ngoài giới hạn cho phép")
      expect(g.block?.description).toContain("Sữa")
    }
  })

  /** Không có khách thì bản nháp không biết nháp cho ai. */
  it("cả hai nút đều đòi có khách hàng", () => {
    for (const asDraft of [true, false]) {
      expect(gateForSave(input({ asDraft, hasCustomer: false })).block).not.toBeNull()
    }
  })

  /** Luật nằm ở MỘT chỗ — hai hàm riêng là cách chắc nhất để hai nút lệch nhau. */
  it("màn tạo đơn dùng chung một bộ luật cho cả hai nút", () => {
    expect(FORM_CODE).toContain("gateForSave({")
    expect((FORM_CODE.match(/gateForSave\(/g) ?? []).length).toBe(1)
    // Không còn kiểm tay rải rác nữa.
    expect(FORM_CODE).not.toContain('title: "Số lượng vượt tồn kho"')
    expect(FORM_CODE).not.toContain('title: "Giá ngoài giới hạn cho phép"')
  })
})

describe("Đơn nháp không chạm vào bộ máy duyệt", () => {
  /**
   * ⚠ Chưa gửi đi thì chưa có gì để duyệt. Chạy quy tắc lúc này chỉ tạo ra
   * một kết quả sẽ cũ mất trước khi ai kịp đọc, vì người dùng còn sửa tiếp.
   */
  it("không chạy evaluateApproval cho bản nháp", () => {
    expect(FORM_CODE).toMatch(/const decision: ApprovalDecision = asDraft/)
    expect(FORM_CODE).toContain("reason: DRAFT_APPROVAL_REASON")
    expect(FORM_CODE).toContain("autoApprove: false")
  })

  /**
   * ⚠ Chưa gửi đi mà đã kêu quản lý vào duyệt thì lần sau họ bỏ qua thông
   * báo thật.
   */
  it("không báo cho người duyệt khi mới chỉ là nháp", () => {
    expect(FORM_CODE).toContain("if (user?.org_id && !asDraft && !decision.autoApprove) {")
  })

  /**
   * ⚠ `approval_reason` để trống nghĩa là "đã duyệt, không có gì vướng".
   * Đơn nháp chưa ai xem nên phải nói rõ vì sao nó còn nằm đó.
   */
  it("đơn nháp có ghi lý do, không để trống", () => {
    expect(DRAFT_APPROVAL_REASON.trim().length).toBeGreaterThan(0)
    expect(DRAFT_APPROVAL_REASON).toContain("nháp")
  })
})

describe("Hai nút trên màn tạo đơn", () => {
  it("có nút lưu nháp ở cả bản điện thoại lẫn máy tính", () => {
    const calls = FORM_CODE.match(/handleSubmit\(null, \{ asDraft: true \}\)/g) ?? []
    expect(calls.length).toBe(2)
  })

  /**
   * ⚠ Nút nháp KHÔNG được khoá theo tồn kho — khoá thì nới luật ở
   * `gateForSave` thành vô nghĩa, vì người dùng không bấm được vào để tới
   * đó. Nhưng vẫn khoá theo giá sàn.
   */
  it("nút nháp không khoá theo tồn kho, vẫn khoá theo giá sàn", () => {
    const blocks = FORM_CODE.match(
      /disabled=\{loading[^}]*\}\n\s*onClick=\{\(\) => handleSubmit\(null, \{ asDraft: true \}\)\}/g
    ) ?? []
    expect(blocks.length, "không tìm thấy nút nháp nào").toBe(2)
    for (const b of blocks) {
      expect(b, `nút nháp bị khoá theo tồn kho: ${b}`).not.toContain("hasOverstock")
      expect(b).toContain("hasPriceViolation")
      expect(b).toContain("!customerId")
    }
  })

  /** Nút nháp phải là `type="button"` — không thì nó gửi luôn form. */
  it("nút nháp không phải nút submit", () => {
    const i = FORM_CODE.indexOf("handleSubmit(null, { asDraft: true })")
    const before = FORM_CODE.slice(Math.max(0, i - 400), i)
    expect(before).toContain('type="button"')
  })
})
