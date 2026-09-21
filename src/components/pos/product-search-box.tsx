"use client"

/**
 * Ô TÌM HÀNG CỦA `/pos` — MỘT CÁI, NẰM Ở CỘT PHẢI.
 *
 * ⚠ ĐÃ ĐỔI CHỖ HAI LẦN, ĐỌC TRƯỚC KHI ĐỔI LẦN BA.
 *   · Bản đầu: HAI ô — một cái nút trên header (bấm vào kích `F3`) và
 *     một `ProductPicker` thật đặt trên bảng hàng. Hai chỗ làm cùng một
 *     việc, mà cái trên header thì không tự tìm được gì.
 *   · Đợt 9, chủ nhà chốt miệng: *"Bỏ bớt 1 cái thêm hàng. đang có 2
 *     cái. Bỏ cái dưới. giữ cái trên header"* → còn một ô, trên header.
 *   · Bản thiết kế 21/09/2026 đặt ô ấy ở CỘT PHẢI, và chủ nhà chốt
 *     *"2 bên phải"* → về cột phải.
 *
 *   Vẫn là ĐÚNG MỘT ô trong cả `/pos`. Điều chủ nhà bác từ đợt 9 là
 *   HAI chỗ thêm hàng, không phải vị trí — và luật ấy còn nguyên.
 *
 * ⚠ NÚT "THÊM SẢN PHẨM" Ở CỘT TRÁI KHÔNG PHẢI Ô THỨ HAI. Chủ nhà chốt
 *   *"bấm vào đó nhảy sang ô thêm sản phẩm bên phải"*: nó không có ô
 *   nhập, không có danh sách, chỉ đưa tiêu điểm sang đúng ô duy nhất.
 *   Biến nó thành một ô tìm nữa là quay lại cái đã bị bác.
 *
 * ⚠ SỔ ĐĂNG KÝ GIỮ NGUYÊN (`store/pos/product-search`). Ô vẽ ở đây,
 *   nhưng danh mục hàng và việc "thêm vào chứng từ" thuộc về MÀN đang
 *   mở — màn đưa hai thứ ấy lên qua `useRegisterPosProductSearch`.
 */

import { ProductPicker } from "@/components/ui/product-picker"
import {
  POS_PICKER_ID,
  focusPosPicker,
  usePosProductSearchHost,
} from "@/store/pos/product-search"

/**
 * Ô tìm hàng ở đỉnh cột phải.
 *
 * Màn nào KHÔNG đăng ký (trang gốc `/pos`, màn xem hóa đơn) thì không
 * vẽ gì — vẽ một ô rỗng ở đó là mời người dùng gõ vào một chỗ không
 * trả lời.
 */
export function PosProductSearchBox({ note }: { note?: string }) {
  const { term, setTerm, reg } = usePosProductSearchHost()
  if (!reg) return null

  return (
    <div className="shrink-0 rounded-[12px] border-[1.5px] border-[var(--pos-line)] bg-white p-3">
      {/* ⚠ NÓI RÕ ĐANG THÊM VÀO ĐÂU khi chứng từ có hai giỏ (màn phiếu
          trả: hàng trả và hàng đổi). Không có câu này thì người dùng gõ
          một mã rồi mới biết nó rơi vào giỏ kia. */}
      {note && (
        <div className="mb-2 rounded-[8px] bg-[var(--pos-ok-soft)] px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--pos-ok)]">
          {note}
        </div>
      )}
      {/*
        ⚠ CỠ Ô ĐẶT BẰNG BIẾN THỂ HẬU DUỆ, KHÔNG SỬA `ProductPicker`.
          `ProductPicker` đang chạy ở năm màn ngoài `/pos`; đổi cỡ mặc
          định của nó là đổi luôn cả năm màn ấy mà không ai yêu cầu.
          Bản thiết kế đòi ô cao 44px, bo 12px, chữ 15px — đặt ở đây.
      */}
      <ProductPicker
        id={POS_PICKER_ID}
        className="[&_input]:h-11 [&_input]:rounded-[12px] [&_input]:border-[1.5px] [&_input]:text-[15px] [&_input]:font-semibold"
        hideLabel
        closeOnPick
        label="Tìm hàng hóa"
        placeholder={reg.placeholder ?? "Tìm hàng hóa, mã SKU, mã vạch…"}
        emptyHint="Không tìm thấy mã nào khớp."
        disabled={reg.disabled}
        term={term}
        onTermChange={setTerm}
        items={reg.items}
        onPick={reg.onPick}
        renderMeta={reg.renderMeta}
      />
    </div>
  )
}

/**
 * Nút "Thêm sản phẩm" ở đỉnh cột trái — đưa tiêu điểm sang ô bên phải.
 *
 * ⚠ PHÍM VẪN LÀ `F3`, KHÔNG PHẢI `F2` NHƯ BẢN VẼ. `F3` là phím đã chạy
 *   ở cả năm màn, có trong câu gợi ý của bảng rỗng và trong `lib/pos/keys`.
 *   Đổi nhãn theo bản vẽ mà không đổi phím là nói dối người dùng; đổi cả
 *   phím là lấy đi thói quen tay của người đang dùng để đúng một con chữ
 *   trên bản vẽ. Đã báo cáo chỗ lệch này.
 */
export function PosAddProductButton({ disabled }: { disabled?: boolean }) {
  const { reg } = usePosProductSearchHost()
  if (!reg) return null
  return (
    <button
      type="button"
      disabled={disabled ?? reg.disabled}
      onClick={focusPosPicker}
      className="h-9 shrink-0 rounded-[10px] border-[1.5px] border-[var(--pos-edge)] bg-white px-3.5 text-[13px] font-bold text-[var(--pos-ink)] hover:border-[var(--pos-primary-border)] disabled:cursor-not-allowed disabled:text-[var(--pos-dim)]"
    >
      Thêm sản phẩm <span className="n text-[11px] opacity-70">F3</span>
    </button>
  )
}
