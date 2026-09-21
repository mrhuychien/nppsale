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

export const POS_BADGE_STYLE: Record<PosBadgeTone, { bg: string; fg: string }> = {
  tam: { bg: "#fef3c7", fg: "#92400e" },
  /* ⚠ XUẤT MỘT PHẦN DÙNG TÔNG XANH, không dùng amber. Spec §7.1 chốt
     `#1e40af` trên `#dbeafe` — amber ở đây lẫn với PHIẾU TẠM, mà hai
     trạng thái ấy cho phép sửa khác hẳn nhau. */
  "mot-phan": { bg: "#dbeafe", fg: "#1e40af" },
  xong: { bg: "#f0fdf4", fg: "#166534" },
  "dang-sua": { bg: "#fef3c7", fg: "#92400e" },
  "da-kho": { bg: "#fef3c7", fg: "#92400e" },
}

/** Phương thức thanh toán trên panel — spec §6 và §9. */
export type PosPayMethod = "no" | "tien-mat" | "chuyen-khoan"

export const POS_PAY_LABEL: Record<PosPayMethod, string> = {
  no: "Ghi nợ hết",
  "tien-mat": "Tiền mặt",
  "chuyen-khoan": "Chuyển khoản",
}
