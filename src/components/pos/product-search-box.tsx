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
 * ⚠ NÚT "THÊM SẢN PHẨM" Ở CỘT TRÁI KHÔNG NẰM Ở ĐÂY. Chủ nhà chốt
 *   *"bấm vào đó nhảy sang ô thêm sản phẩm bên phải"*, và bản thiết kế
 *   vẽ nút ấy TRONG khối tiêu đề của màn đơn — nên nó ở
 *   `order-screen.tsx`, dựng thẳng, gọi `focusPosPicker`. Từng có một
 *   component dùng chung ở đây; sau khi khối tiêu đề của bản vẽ vào thì
 *   không màn nào gọi nữa nên đã gỡ. Nút ấy KHÔNG được có ô nhập hay
 *   dải gợi ý riêng — làm thế là quay lại "hai chỗ thêm hàng" mà chủ
 *   nhà đã bác.
 *
 * ⚠ SỔ ĐĂNG KÝ GIỮ NGUYÊN (`store/pos/product-search`). Ô vẽ ở đây,
 *   nhưng danh mục hàng và việc "thêm vào chứng từ" thuộc về MÀN đang
 *   mở — màn đưa hai thứ ấy lên qua `useRegisterPosProductSearch`.
 */

import { ProductPicker } from "@/components/ui/product-picker"
import { POS_PICKER_ID, usePosProductSearchHost } from "@/store/pos/product-search"

/** Sắc của dải "thêm vào…" — khớp màu của chính khối bảng ấy. */
const TONE = {
  warn: "bg-[var(--pos-warn-soft)] text-[var(--pos-warn)]",
  primary: "bg-[var(--pos-primary-soft)] text-[var(--pos-primary-deep)]",
  ok: "bg-[var(--pos-ok-soft)] text-[var(--pos-ok)]",
} as const

/** Viền của nút trên dải — cùng họ với sắc nền. */
const TONE_NUT = {
  warn: "border-[var(--pos-warn-border)] text-[var(--pos-warn)]",
  primary: "border-[var(--pos-primary-border)] text-[var(--pos-primary-deep)]",
  ok: "border-[var(--pos-ok-edge)] text-[var(--pos-ok)]",
} as const

/**
 * Ô tìm hàng ở đỉnh cột phải.
 *
 * Màn nào KHÔNG đăng ký (trang gốc `/pos`, màn xem hóa đơn) thì không
 * vẽ gì — vẽ một ô rỗng ở đó là mời người dùng gõ vào một chỗ không
 * trả lời.
 */
export function PosProductSearchBox({
  note,
}: {
  /**
   * Chứng từ có HAI giỏ (màn phiếu trả: hàng trả · hàng đổi; màn đơn:
   * hàng bán · hàng khách trả kèm) thì nói rõ mã sắp gõ rơi vào giỏ nào.
   *
   * ⚠ `action` LÀ ĐƯỜNG RA, và nó phải nằm NGAY TRÊN DẢI. Màn đơn có
   *   một chế độ bật/tắt ("đang thêm hàng trả"); người dùng đang nhìn
   *   vào ô tìm, nên cái nút để thoát chế độ phải ở ngay đó — bắt họ đi
   *   tìm một cái nút ở cột bên kia là lý do người ta gõ tiếp mấy mã nữa
   *   vào nhầm giỏ.
   */
  note?: {
    text: string
    tone: keyof typeof TONE
    action?: { label: string; onClick: () => void }
  }
}) {
  const { term, setTerm, reg } = usePosProductSearchHost()
  if (!reg) return null

  return (
    <div className="shrink-0 rounded-[12px] border-[1.5px] border-[var(--pos-line)] bg-white p-3">
      {/*
        ⚠ NÓI RÕ ĐANG THÊM VÀO ĐÂU, VÀ DÙNG ĐÚNG SẮC CỦA KHỐI ẤY. Màn
          phiếu trả có hai bảng nằm chồng nhau, mỗi bảng một sắc (hàng
          trả nâu, hàng đổi xanh). Một dải trung tính ở đây là người
          dùng gõ xong một mã mới biết nó rơi vào giỏ kia — và ở màn
          này, gõ nhầm giỏ nghĩa là ghi một món KHÁCH TRẢ thành một món
          MÌNH ĐƯA THÊM, tức lệch hẳn chiều tiền.
      */}
      {note && (
        <div
          className={`mb-2 flex min-w-0 items-center gap-2 rounded-[8px] px-2.5 py-1.5 ${TONE[note.tone]}`}
        >
          <span className="min-w-0 flex-grow truncate text-[11px] font-extrabold uppercase tracking-[0.06em]">
            Thêm vào: {note.text}
          </span>
          {note.action && (
            <button
              type="button"
              onClick={note.action.onClick}
              className={`h-7 shrink-0 whitespace-nowrap rounded-[8px] border-[1.5px] bg-white px-2.5 text-[11.5px] font-extrabold ${TONE_NUT[note.tone]}`}
            >
              {note.action.label}
            </button>
          )}
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
        persistent
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
