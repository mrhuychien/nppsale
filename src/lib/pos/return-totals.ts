/**
 * CỘNG TIỀN CHO PHIẾU TRẢ HÀNG — spec §6 mục "Phiếu trả hàng (3, 8)".
 *
 * ⚠ CÁC CON SỐ DƯỚI ĐÂY LẤY THẲNG TỪ BẢN THIẾT KẾ, để khỏi phải đoán
 * thứ tự trừ và đoán cái gì tham gia phép cộng:
 *
 *     Giá gốc hàng mua                     528.000
 *     Tổng tiền hàng trả                   528.000
 *     Phí trả hàng                       − 20.000
 *     Giá trị hàng đổi     không trừ tiền  348.000
 *     ┌──────────────────────────────────────────┐
 *     │ Cần trả khách                    508.000 │
 *     └──────────────────────────────────────────┘
 *     Trừ vào công nợ · còn lại         13.308.000
 *
 * 528.000 − 20.000 = 508.000. **HÀNG ĐỔI KHÔNG THAM GIA.**
 *
 * ⚠ ĐÂY LÀ CHỖ DỄ SAI NHẤT CỦA CẢ MÀN. Dòng ĐỔI lấy hàng mới ra khỏi
 * kho bán và KHÔNG trừ tiền — nó chỉ là một lần giao hàng thay thế.
 * Cộng 348.000 ấy vào là trả cho khách số tiền của món họ vừa nhận.
 * Bản thiết kế in hẳn chữ "không trừ tiền" cạnh con số vì lý do đó, và
 * phần nghiệp vụ đang chạy cũng tính đúng như vậy
 * (`trg_return_lines_sync_credit` chỉ cộng dòng không phải hàng đổi).
 *
 * ⚠ "GIÁ GỐC HÀNG MUA" CHỈ ĐỂ ĐỐI CHIẾU, KHÔNG VÀO PHÉP CỘNG. Nó là
 * giá khách đã mua món ấy trên hóa đơn gốc; người lập phiếu nhìn nó để
 * biết mình có đang trả lại nhiều hơn số đã bán hay không.
 */

import { discountAmount, lineGross, type DiscountInput } from "@/lib/pos/discount"

export interface ReturnTotalLine {
  qty: number
  price: number
  /** `true` = dòng ĐỔI (không trừ tiền). */
  isExchange?: boolean
}

export interface ReturnTotals {
  /** Σ dòng TRẢ. */
  goodsReturned: number
  /** Σ dòng ĐỔI — hiện ra để đối chiếu, KHÔNG vào phép cộng. */
  exchangeValue: number
  /** Phí trả hàng, quy ra đồng. */
  fee: number
  /** Số cần trả khách. Kẹp về 0. */
  dueToCustomer: number
  /** Số dòng mỗi loại — dùng cho câu cảnh báo kho. */
  returnLineCount: number
  exchangeLineCount: number
  /** Tổng số lượng mỗi loại. */
  returnQty: number
  exchangeQty: number
}

export function returnTotals(i: {
  lines: readonly ReturnTotalLine[]
  /** Phí trả hàng — `%` tính trên TỔNG TIỀN HÀNG TRẢ. */
  fee?: DiscountInput
}): ReturnTotals {
  let goodsReturned = 0
  let exchangeValue = 0
  let returnLineCount = 0
  let exchangeLineCount = 0
  let returnQty = 0
  let exchangeQty = 0

  for (const l of i.lines) {
    const t = lineGross(l.qty, l.price)
    const sl = Math.max(0, Math.round(Number(l.qty) || 0))
    if (l.isExchange) {
      exchangeValue += t
      exchangeLineCount += 1
      exchangeQty += sl
    } else {
      goodsReturned += t
      returnLineCount += 1
      returnQty += sl
    }
  }

  /**
   * ⚠ PHÍ THEO `%` TÍNH TRÊN TIỀN HÀNG TRẢ, không trên tiền hàng đổi và
   * cũng không trên tổng hai thứ. Phí là khoản khấu trừ vào số hoàn cho
   * khách; hàng đổi không sinh ra khoản hoàn nào để mà trừ phí.
   */
  const fee = i.fee ? discountAmount(i.fee, goodsReturned) : 0

  return {
    goodsReturned,
    exchangeValue,
    fee,
    // ⚠ Kẹp về 0 — phí lớn hơn tiền hàng thì không trả khách đồng nào,
    //   chứ không phải khách nợ thêm. Đòi thêm tiền qua ô "phí trả
    //   hàng" là một con đường không ai định mở.
    dueToCustomer: Math.max(0, goodsReturned - fee),
    returnLineCount,
    exchangeLineCount,
    returnQty,
    exchangeQty,
  }
}

/**
 * Công nợ khách CÒN LẠI sau khi trừ phiếu trả này.
 *
 * ⚠ `null` LÀ "CHƯA ĐỌC ĐƯỢC", KHÔNG PHẢI 0 — và khi đó trả về `null`
 * để màn hình nói "chưa xác định". Cộng từ 0 ra một con số trông như
 * thật là nói với người đi đòi tiền rằng khách này sạch nợ.
 */
export function debtAfterReturn(
  currentDebt: number | null | undefined,
  dueToCustomer: number
): number | null {
  if (currentDebt == null) return null
  return Math.max(0, Number(currentDebt) - Math.max(0, dueToCustomer))
}

/**
 * Câu mô tả giao dịch kho, hiện trong box cảnh báo amber cuối panel.
 *
 * ⚠ NÓI ĐÚNG HAI CHIỀU, VÀ NÓI RÕ LÀ MỘT GIAO DỊCH. Hàng trả ĐI VÀO
 * kho nhận, hàng đổi ĐI RA khỏi kho bán — hai chiều ngược nhau trong
 * cùng một lần bấm. Người lập phiếu phải thấy cả hai trước khi bấm, vì
 * sau đó là bút toán kho thật.
 *
 * ⚠ TÊN KHO NHẬN DO NƠI GỌI TRUYỀN VÀO, KHÔNG VIẾT CỨNG "Kho hàng lỗi".
 * `complete_return` chỉ nhận HAI vùng — `sale` và `date` (xem
 * `ReturnZone`). Không có vùng "hàng lỗi" nào cả; gọi tên một vùng
 * không tồn tại là người dùng đi tìm nó trong báo cáo kho và không
 * thấy, rồi tưởng hàng trả đã bốc hơi.
 */
export function warehouseSentence(t: ReturnTotals, zoneLabel = "kho nhận hàng trả"): string | null {
  const ve: string[] = []
  if (t.returnQty > 0) ve.push(`nhập ${t.returnQty} sản phẩm vào ${zoneLabel}`)
  if (t.exchangeQty > 0) ve.push(`xuất ${t.exchangeQty} sản phẩm hàng đổi khỏi Kho bán`)
  // ⚠ Phiếu rỗng thì không có câu nào — đừng hứa một giao dịch không xảy ra.
  if (ve.length === 0) return null
  return `Ghi nhận sẽ ${ve.join(" và ")} trong cùng một giao dịch.`
}
