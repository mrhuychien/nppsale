/**
 * KIỂU DỮ LIỆU CỦA MÀN POS — spec chốt 21/09/2026.
 *
 * ⚠ ĐÂY LÀ HÌNH DẠNG CỦA GIAO DIỆN, KHÔNG PHẢI CỦA BẢNG. Spec §"Không
 * đụng vào" cấm đổi schema; các kiểu dưới đây gom đúng những gì một
 * dòng trên màn cần vẽ, rồi nơi gọi tự ánh xạ từ API đang có sang.
 * Trộn hai thứ làm một là đến lúc muốn đổi một nhãn trên màn thì phải
 * đụng vào tầng dữ liệu.
 */

import type { DiscountInput } from "@/lib/pos/discount"

export interface PosUnitOption {
  unit_name: string
  /** Hệ số quy đổi về đơn vị cơ sở. */
  conversion: number
}

export interface PosLotOption {
  id: string
  /** `L2609` */
  code: string
  /** `12/26`, hoặc rỗng nếu hàng không có hạn. */
  expiry: string
}

/** Một dòng hàng trên bảng — dùng chung cho cả 6 loại chứng từ. */
export interface PosLine {
  /** Khoá ổn định trong phiên; KHÔNG phải mã dòng dưới cơ sở dữ liệu. */
  key: string
  productId: string
  sku: string
  name: string
  unit: string
  units: PosUnitOption[]
  qty: number
  price: number
  /**
   * GIÁ BẢNG của đúng (mặt hàng + đơn vị + nhóm giá của khách).
   *
   * ⚠ KHÔNG PHẢI `price` LÚC MỚI THÊM. Đây là số `unitPriceFor` tra ra
   * từ bảng giá; `price` là số đang áp dụng, có thể đã bị sửa tay. Hai
   * số ấy KHÁC NGHĨA và cả hai đều đi xuống sổ:
   * `sales_order_lines.line_discount` = `(listPrice − price) × qty`
   * (xem `lineDiscountOf`). Để `listPrice = price` là mọi đơn ghi chiết
   * khấu 0 dù người bán vừa hạ giá — và không báo cáo nào lần ra được.
   *
   * ⚠ CŨNG LÀ MỐC CỦA CHỐT CHẶN GIÁ. `priceViolation` so `price` với
   * `listPrice`: thiếu nó thì sàn giá của NVBH biến mất trong im lặng.
   */
  listPrice?: number
  /** Thuế suất theo TỈ LỆ (0,1 = 10%) của riêng dòng này. */
  vatRate?: number
  discount: DiscountInput
  note?: string

  lotId?: string | null
  lots?: PosLotOption[]

  /* ---- dòng phụ dưới tên hàng, spec §4 ---- */
  /** Tồn kho bán, theo đơn vị cơ sở. */
  stock?: number | null
  /** Đã đặt (đơn hàng) / đã nhập (phiếu nhập). */
  ordered?: number | null
  /**
   * Số ĐÃ XUẤT của dòng này.
   *
   * ⚠ ĐÂY LÀ RÀNG BUỘC DUY NHẤT CỦA MÀN SỬA ĐƠN (spec §7.1): stepper
   * có `min = số đã xuất`. Giảm xuống dưới phần đã giao là ghi một đơn
   * nhỏ hơn số hàng đã rời kho.
   */
  issued?: number | null
  /** Giá bán gần nhất cho khách này + số lần mua — gợi ý, bật/tắt ở drawer. */
  lastPrice?: number | null
  lastBuyCount?: number | null

  /* ---- dòng hàng trả / đổi ---- */
  /**
   * `true` = dòng ĐỔI (lấy hàng mới ra, KHÔNG trừ tiền).
   * `false` = dòng TRẢ (nhận hàng về, CÓ trừ tiền).
   *
   * ⚠ MẶC ĐỊNH `false` LÀ HƯỚNG AN TOÀN, giống `returnLinesToCart` của
   * phần nghiệp vụ: đoán nhầm thành ĐỔI là âm thầm bỏ mất một khoản
   * giảm công nợ của khách.
   */
  isExchange?: boolean

  /* ---- màn sửa: số CŨ để gạch ngang, spec §7 ---- */
  /** Thành tiền trước khi sửa. `null`/thiếu = dòng mới thêm. */
  prevAmount?: number | null
}

/** Trạng thái hiển thị trên sub-header. */
export type PosBadgeTone = "tam" | "mot-phan" | "xong" | "dang-sua" | "da-kho"

export interface PosBadge {
  label: string
  tone: PosBadgeTone
}

/**
 * ⚠ BIẾN, KHÔNG PHẢI MÃ MÀU — và cả ba nơi dùng bảng này (`/pos`,
 *   `DocSubHeader`, `DocTabs`) đều nằm TRONG `.pos-scope`, nơi các biến
 *   ấy được khai. Đem bảng này ra một màn ngoài `/pos` là ba nhãn mất
 *   màu, không phải đổi màu — nhớ điều đó trước khi tái sử dụng.
 *
 * ⚠ XUẤT MỘT PHẦN DÙNG TÔNG XANH, không dùng amber. Spec §7.1 chốt như
 *   vậy: amber ở đây lẫn với PHIẾU TẠM, mà hai trạng thái ấy cho phép
 *   sửa khác hẳn nhau.
 */
export const POS_BADGE_STYLE: Record<PosBadgeTone, { bg: string; fg: string }> = {
  tam: { bg: "var(--pos-warn-soft)", fg: "var(--pos-warn)" },
  "mot-phan": { bg: "var(--pos-primary-soft)", fg: "var(--pos-primary-deep)" },
  xong: { bg: "var(--pos-ok-soft)", fg: "var(--pos-ok)" },
  "dang-sua": { bg: "var(--pos-warn-soft)", fg: "var(--pos-warn)" },
  "da-kho": { bg: "var(--pos-warn-soft)", fg: "var(--pos-warn)" },
}

/** Phương thức thanh toán trên panel — spec §6 và §9. */
export type PosPayMethod = "no" | "tien-mat" | "chuyen-khoan"

export const POS_PAY_LABEL: Record<PosPayMethod, string> = {
  no: "Ghi nợ hết",
  "tien-mat": "Tiền mặt",
  "chuyen-khoan": "Chuyển khoản",
}
