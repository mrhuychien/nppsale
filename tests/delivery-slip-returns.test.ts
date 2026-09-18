import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * ⚠ MẪU IN ĐÃ RỜI KHỎI MÀN. Từ P5 nó nằm ở
 * `components/printing/delivery-slip.tsx` để workflow v2 in được ngay sau
 * khi Xuất hàng. Chốt này soi VĂN BẢN NGUỒN nên phải trỏ sang tệp mới —
 * và phải kiểm thêm rằng màn cũ vẫn gọi component ấy với đủ ba tham số
 * ngoài phạm vi đơn, nếu không bản in của luồng cũ đổi chữ.
 */
const SLIP = code(read("src/components/printing/delivery-slip.tsx"))
const PAGE = code(read("src/app/(dashboard)/inventory/entries/[id]/page.tsx"))

/**
 * NGƯỜI DÙNG YÊU CẦU: trong mẫu in phiếu xuất kho / giao hàng TỪNG KHÁCH,
 * bỏ phần viết tay "Hàng trả về (thu về kho) — Đơn chưa có yêu cầu trả …
 * ghi tay vào các dòng trống … Tổng trả (ghi tay): _______".
 *
 * Bảng hàng trả vẫn in khi đơn CÓ phiếu trả thật (đó là số liệu, không
 * phải chỗ trống để viết). Dòng "Số phải thu" giữ nguyên.
 */
describe("Phiếu giao từng khách: không còn phần hàng trả viết tay", () => {
  it("bỏ hẳn câu mời ghi tay, dòng trống và 'Tổng trả (ghi tay)'", () => {
    for (const src of [SLIP, PAGE]) {
      expect(src).not.toContain("ghi tay vào các dòng trống")
      expect(src).not.toContain("Tổng trả (ghi tay)")
      expect(src).not.toContain("_______")
      expect(src).not.toContain("blank-${i}")
      expect(src).not.toContain("Array.from({ length: 3 }")
    }
  })

  /**
   * ⚠ MÀN CŨ PHẢI IN Y HỆT NHƯ TRƯỚC. Mẫu in đọc ba thứ nằm NGOÀI phạm vi
   * một đơn — mã phiếu kho và số trang trong chuyến. Quên truyền chúng
   * (hoặc để mặc định khác) là dòng đầu trang phiếu cũ đổi chữ, tức đã
   * đụng vào luồng cũ.
   */
  it("màn phiếu kho cũ vẫn gọi mẫu in với đủ ba tham số ngoài phạm vi đơn", () => {
    expect(PAGE).toContain("<DeliverySlip")
    expect(PAGE).toContain("entryCode={entry.entry_code}")
    expect(PAGE).toContain("pageIndex={idx + 1}")
    expect(PAGE).toContain("pageTotal={refOrders.length}")
  })

  /**
   * ⚠ GỐC MỖI TRANG PHẢI GIỮ CẢ HAI LỚP. `globals.css` viết luật 8pt cho
   * cả `print-page` lẫn `a5-doc`, NHƯNG luật thu nhỏ khối chữ ký chỉ gắn
   * vào `.a5-doc` — mất lớp đó là chữ ký in to hơn và trang tràn sang tờ
   * thứ hai. Và component KHÔNG tự bọc `.print-only`: lớp đó là việc của
   * nơi gọi, đúng khuôn ba component in có sẵn.
   */
  it("giữ đúng lớp in: print-page a5-doc ở gốc, không tự bọc print-only", () => {
    expect(SLIP).toContain('className="print-page a5-doc p-4"')
    expect(SLIP).not.toContain("print-only")
  })

  it("bảng hàng trả chỉ dựng khi hasReturns; dòng hàng trả và tổng trừ công nợ vẫn còn", () => {
    const i = SLIP.indexOf("Hàng trả về (thu về kho)")
    expect(i).toBeGreaterThan(0)
    // Tiêu đề nằm TRONG nhánh `{hasReturns && (` — không in cho đơn không có phiếu trả.
    const gate = SLIP.lastIndexOf("{hasReturns && (", i)
    expect(gate).toBeGreaterThan(0)
    expect(SLIP.slice(gate, i)).not.toContain("</div>")
    expect(SLIP).toContain("{allReturnLines.map((l, i) => {")
    expect(SLIP).toContain("Tổng trả (trừ công nợ):")
  })

  it("dòng 'Số phải thu' vẫn in cho mọi đơn, nằm ngoài nhánh hasReturns", () => {
    const due = SLIP.indexOf('{hasReturns ? "Còn phải thu:" : "Số phải thu:"}')
    expect(due).toBeGreaterThan(0)
    const gate = SLIP.lastIndexOf("{hasReturns && (", due)
    // ⚠ Không có nhánh thì "ngoài nhánh" là vô nghĩa — bản cũ từng xanh vì thế.
    expect(gate).toBeGreaterThan(0)
    // Fragment của nhánh đã đóng (`</>`) trước dòng phải thu.
    const close = SLIP.indexOf("</>", gate)
    expect(close).toBeGreaterThan(gate)
    expect(close).toBeLessThan(due)
  })
})

/**
 * Mẫu in sau khi tách: những chỗ migration 119 làm hỏng mà không ai thấy,
 * vì phiếu giao chỉ sai khi có phiếu trả kèm theo.
 */
describe("Phiếu giao đọc trạng thái phiếu trả theo workflow v2", () => {
  /**
   * ⚠ BỘ LỌC HỎI GIÁ TRỊ KHÔNG CÒN TỒN TẠI = PHẦN HÀNG TRẢ LẶNG LẼ BIẾN
   * MẤT. Migration 119 backfill `pending`/`approved` đi và
   * `chk_returns_status_v2` cấm chúng, nên truy vấn cũ trả về rỗng —
   * phiếu giao in ra không có bảng hàng trả, lái xe không biết phải thu
   * lại gì, và không có thông báo lỗi nào.
   */
  it("truy vấn phiếu trả lọc theo giá trị còn tồn tại", () => {
    expect(PAGE).toContain('.in("status", ["draft", "submitted", "completed"])')
    expect(PAGE).not.toContain('["pending", "approved", "completed"]')
  })

  /** Và nhãn in ra phải là tiếng Việt, không phải giá trị enum trần. */
  it("bảng nhãn trạng thái phủ đủ bốn giá trị của v2", () => {
    const i = SLIP.indexOf("const statusText = r.status")
    expect(i).toBeGreaterThan(0)
    const map = SLIP.slice(i, SLIP.indexOf("}", SLIP.indexOf("{", i) + 1) + 1)
    for (const s of ["draft", "submitted", "completed", "cancelled"]) {
      expect(map, `bảng nhãn thiếu ${s}`).toContain(`${s}:`)
    }
    expect(map, "còn nhãn của trạng thái đã bị bỏ").not.toContain("pending:")
    expect(map).not.toContain("approved:")
  })
})
