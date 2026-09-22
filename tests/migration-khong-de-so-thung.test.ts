import { describe, it, expect } from "vitest"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * DÃY SỐ MIGRATION KHÔNG ĐƯỢC THỦNG MÀ KHÔNG AI BIẾT VÌ SAO.
 *
 * ⚠ ĐÂY LÀ CÁCH MỘT LỖI SẢN XUẤT SỐNG SÓT BA NGÀY. 21/09/2026 chủ nhà
 *   báo hai lần `NO_BATCH_TO_RESTOCK` — huỷ hoá đơn không được, dù kho
 *   có hàng, và sau khi bán âm. Hai bản vá 156 và 157 được viết và
 *   nằm trên nhánh `newdesign`. Nhánh `main` — nhánh đang chạy sản
 *   xuất — nhảy thẳng từ 155 sang 158. Không có gì đỏ lên. Người dùng
 *   tiếp tục gặp đúng lỗi ấy cho tới 22/09 mới có người đi đếm số.
 *
 *   Đo lại trên chính `main` trước khi mang hai bản vá sang:
 *     bán âm: xuất hóa đơn ĐƯỢC → HUỶ HỎNG: NO_BATCH_TO_RESTOCK
 *     lô ở kho "date": xuất ĐƯỢC → HUỶ HỎNG: NO_BATCH_TO_RESTOCK
 *   Sau khi mang sang: cả hai HUỶ ĐƯỢC, và mặt hàng bán âm KHÔNG bị
 *   dựng tồn kho ảo (0, đúng ý mig 157).
 *
 * ⚠ CHỐT NÀY KHÔNG ĐÒI "KHÔNG ĐƯỢC THỦNG". Hai nhánh đi song song thì
 *   thủng là chuyện bình thường. Nó đòi MỖI LỖ PHẢI CÓ TÊN VÀ CÓ LÝ
 *   DO — để lần sau, người thêm migration nhìn thấy cái lỗ và phải trả
 *   lời "số này đi đâu?" thay vì lướt qua.
 *
 * ⚠ DANH SÁCH NÀY LÀ CHUYỆN CỦA RIÊNG NHÁNH NÀY, và đó là cố ý. Nó nói
 *   về quan hệ giữa nhánh này với nhánh kia, nên khi trộn hai nhánh nó
 *   SẼ xung đột — và xung đột đúng chỗ ấy là thứ tốt: nó bắt người trộn
 *   phải trả lời từng số một.
 */

const DIR = resolve(__dirname, "..", "supabase/migrations")

/**
 * Số migration vắng mặt trên nhánh này, kèm lý do.
 *
 * ⚠ LÝ DO PHẢI NÓI ĐƯỢC "VÌ SAO NHÁNH NÀY KHÔNG CẦN", không phải "nó ở
 *   chỗ khác". "Nó nằm trên newdesign" là mô tả, không phải lý do — và
 *   đó đúng là câu đã để 156/157 nằm ngoài sản xuất ba ngày.
 */
const LO_CO_LY_DO: Record<number, string> = {
  159:
    "thêm cột `return_lines.reason` cho ô chọn lý do TỪNG DÒNG của màn POS. " +
    "Giao diện trên `main` chỉ có lý do cho cả phiếu (`returns.reason`) nên " +
    "không đọc tới cột ấy. Thêm một cột mà sản xuất không dùng là nới lược " +
    "đồ thật vì một màn chưa ra mắt — để lại cho lúc trộn nhánh.",
  161:
    "lời RÚT LẠI hai bản 161 từng nới quyền đọc đơn nháp. `main` chưa bao " +
    "giờ chạy bản nào trong hai bản ấy, nên không có gì để rút. Đã ĐO trên " +
    "`main`: NVBH lập một đơn nháp, chủ NPP đếm được 0 trong khi sổ có 1 — " +
    "luật 'nháp là sổ tay riêng của NVBH' còn nguyên.",
}

describe("dãy số migration", () => {
  const SO = readdirSync(DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .map((f) => Number(f.slice(0, 3)))
    .sort((a, b) => a - b)

  it("có migration để mà soi", () => {
    expect(SO.length).toBeGreaterThan(100)
  })

  it("mọi số vắng mặt đều có tên và có lý do", () => {
    const thung: number[] = []
    for (let n = SO[0] + 1; n < SO[SO.length - 1]; n++) {
      if (!SO.includes(n) && !(n in LO_CO_LY_DO)) thung.push(n)
    }
    expect(
      thung,
      "số migration vắng mặt mà không ai ghi vì sao — rất có thể là một bản vá " +
        "đang nằm ở nhánh khác và sản xuất chưa bao giờ nhận được"
    ).toEqual([])
  })

  /**
   * ⚠ LÝ DO CHẾT LÀ LÝ DO NGUY HIỂM NHẤT. Khi một số được mang sang
   *   nhánh này, mục giải thích của nó phải bị xoá — để nguyên thì lần
   *   sau người đọc tin rằng số ấy vẫn còn thiếu có chủ ý.
   */
  it("không còn lý do nào nói về một số ĐÃ CÓ mặt", () => {
    const thua = Object.keys(LO_CO_LY_DO)
      .map(Number)
      .filter((n) => SO.includes(n))
    expect(thua, "migration này đã có trên nhánh — xoá mục giải thích đi").toEqual([])
  })

  /** ⚠ Lý do phải là một câu, không phải một chữ cho xong chốt. */
  it("mỗi lý do đều nói được vì sao nhánh này không cần", () => {
    for (const [n, lyDo] of Object.entries(LO_CO_LY_DO)) {
      expect(lyDo.length, `${n}: lý do quá ngắn để nói được điều gì`).toBeGreaterThan(80)
    }
  })

  /** Không được có hai tệp cùng số — chạy xong không biết bản nào thắng. */
  it("không số nào bị dùng hai lần", () => {
    const dem = new Map<number, number>()
    for (const n of SO) dem.set(n, (dem.get(n) ?? 0) + 1)
    const trung = Array.from(dem.entries()).filter(([, c]) => c > 1).map(([n]) => n)
    expect(trung, "hai migration cùng một số — thứ tự chạy không xác định").toEqual([])
  })
})
