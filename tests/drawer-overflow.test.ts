import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * NGĂN KÉO XEM NHANH KHÔNG ĐƯỢC TRÀN.
 *
 * Chủ nhà báo: "Xem nhanh Đơn hàng từ Danh sách đơn hàng hiển thị bị
 * tràn khi có hàng đổi trả."
 *
 * ⚠ NHƯNG KHÔNG PHẢI LỖI CỦA KHỐI HÀNG ĐỔI/TRẢ. Khối đó chỉ là nội dung
 * đủ dài để làm lộ hai lỗi bố cục vốn đã có sẵn:
 *
 *   1. Vùng cuộn là con của một flex cột nhưng thiếu `min-h-0`. Flex item
 *      mặc định `min-height: auto` nên KHÔNG co dưới chiều cao nội dung —
 *      `overflow-y-auto` không bao giờ chạy, khối phình ra và đẩy hàng nút
 *      dưới đáy ra ngoài ngăn kéo.
 *   2. Ngăn kéo để `w-[460px]` cứng, rộng hơn màn hình 375px của điện
 *      thoại.
 *
 * Cả hai chỉ lộ ra khi có thêm nội dung, nên rất dễ sửa nhầm chỗ.
 */

const ROOT = resolve(__dirname, "..")
/**
 * ⚠ BỎ CHÚ THÍCH TRƯỚC KHI SOI. Chính khối chú thích giải thích lỗi này
 * có nhắc chữ `overflow-y-auto`, nên `indexOf` sẽ dừng ở lời giải thích
 * chứ không phải ở lớp CSS thật — chốt đỏ (hoặc tệ hơn là xanh) vì đọc
 * nhầm chỗ. Đã dính đúng như vậy khi viết chốt này.
 */
const read = (rel: string) =>
  readFileSync(resolve(ROOT, rel), "utf-8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")

const DRAWERS = [
  ["đơn hàng", "src/components/orders/order-drawer.tsx"],
  ["hóa đơn bán", "src/components/sales-invoices/invoice-drawer.tsx"],
] as const

describe("ngăn kéo Xem nhanh", () => {
  it.each(DRAWERS)("%s: vùng cuộn có min-h-0 nên overflow-y-auto mới chạy", (_l, rel) => {
    const src = read(rel)
    const at = src.indexOf("overflow-y-auto")
    expect(at, "không tìm thấy vùng cuộn").toBeGreaterThan(0)
    // Cắt đúng thuộc tính className chứa nó — cửa sổ ký tự sẽ lẫn sang
    // khối khác và làm chốt xanh oan.
    const start = src.lastIndexOf('className="', at)
    const cls = src.slice(start + 11, src.indexOf('"', start + 11))
    expect(cls, `vùng cuộn thiếu min-h-0: ${cls}`).toContain("min-h-0")
    expect(cls, `vùng cuộn thiếu min-w-0: ${cls}`).toContain("min-w-0")
    expect(cls).toContain("flex-1")
  })

  it.each(DRAWERS)("%s: bề ngang co được dưới 460px trên điện thoại", (_l, rel) => {
    const src = read(rel)
    const at = src.indexOf("<SheetContent")
    expect(at).toBeGreaterThan(0)
    const tag = src.slice(at, src.indexOf(">", at))
    // ⚠ `w-[460px]` TRẦN là 460px trên cả màn 375px — ngăn kéo tự tràn.
    expect(tag, `ngăn kéo ghim bề ngang cứng: ${tag}`).not.toMatch(/\sw-\[460px\]/)
    expect(tag).toContain("w-full")
    expect(tag).toContain("max-w-[460px]")
  })
})

describe("khối hàng đổi / trả", () => {
  const RS = read("src/components/orders/return-summary.tsx")

  /**
   * ⚠ Ô LƯỚI MẶC ĐỊNH KHÔNG CO DƯỚI MIN-CONTENT. Một tên hàng dài như
   * "Xúc xích xiên que koko vị sụn gà 30g(30 cái/bịch x 12 bịch/th)cty
   * hương đạt" sẽ đẩy ngang cả ngăn kéo thay vì bị cắt.
   */
  it("khối và từng thẻ đều co được, thẻ tự cắt phần thừa", () => {
    expect(RS).toContain('<div className="grid min-w-0 gap-2">')
    // `key={r.id}` đứng TRƯỚC `className` trong thẻ, nên phải dò XUÔI.
    const cardAt = RS.indexOf("key={r.id}")
    const clsAt = RS.indexOf('className="', cardAt)
    const cls = RS.slice(clsAt + 11, RS.indexOf('"', clsAt + 11))
    expect(cls).toContain("min-w-0")
    expect(cls).toContain("overflow-hidden")
  })

  /** Con số tiền không được co lại thành "−1.234…" */
  it("số tiền trừ giữ nguyên bề ngang, lý do trả thì cắt được", () => {
    expect(RS).toContain('className="shrink-0 text-right text-[13px] font-extrabold tabular-nums')
    expect(RS).toContain('className="min-w-0 truncate text-[12px] font-bold text-on-surface"')
  })
})
