/**
 * MUA HÀNG — quy tắc của màn 9–12 (spec §6, §7.2, §8).
 *
 * ⚠ BA CHỖ BẢN THIẾT KẾ NÓI KHÁC CƠ CHẾ ĐANG CHẠY. Spec §7.2 chốt
 * "Nội dung banner mô tả cơ chế đang có… Chỉnh lại câu chữ cho khớp
 * hành vi thật nếu khác", nên chúng được chỉnh ở đây chứ không chép
 * nguyên:
 *
 *   1. KHÔNG CÓ HÀM "LẬP LẠI" CHO MUA HÀNG. Bên bán có
 *      `reissue_invoice` — huỷ và lập lại trong MỘT lời gọi. Bên mua
 *      chỉ có `cancel_purchase_invoice` và `complete_purchase_invoice`
 *      rời nhau. Nên câu "huỷ và lập lại trong cùng một giao dịch"
 *      (artboard 10) KHÔNG đúng với phiếu nhập, và câu "giữ nguyên số
 *      phiếu" (artboard 12) cũng không: huỷ rồi lập lại là một phiếu
 *      MỚI, mang số mới.
 *
 *   2. KHÔNG CÓ "GIÁ VỐN BÌNH QUÂN". `complete_purchase_invoice` ghi
 *      `batches.unit_cost` cho TỪNG LÔ:
 *
 *        v_unit_cost := (quantity * unit_price - line_discount) / base_qty
 *
 *      Giá vốn ở hệ này là giá vốn THEO LÔ, không phải một số bình
 *      quân trôi theo mỗi lần nhập. Ô delta `GIÁ VỐN BQ` của spec §7.2
 *      không ứng với thứ gì có thật — đổi thành `GIÁ VỐN LÔ`.
 *
 *   3. HAI PHÍA CÓ HAI BỘ KHOÁ RIÊNG, và chúng không giống bên bán.
 *      Xem `purchaseCancelLock` / `supplierReturnCancelLock`.
 */

import { discountAmount, lineGross, type DiscountInput } from "@/lib/pos/discount"
import { posTotals, type PosTotalLine } from "@/lib/pos/totals"

/* ==================================================================
 * §8.1 — LÔ & HSD KHI NHẬP: MÁY CHỦ TỰ SINH
 * ================================================================== */

/**
 * Mã lô mà `complete_purchase_invoice` SẼ đặt cho dòng thứ `index`.
 *
 * ⚠ SPEC §8 MỤC 1 NÓI "LÔ & HSD BẮT BUỘC", VÀ BẢN ĐẦU CỦA MÀN NHẬP ĐÃ
 * DỰNG MỘT Ô GÕ TAY CHO NÓ. Ô ấy không đi tới đâu cả:
 *
 *   · `purchase_invoice_lines` KHÔNG có cột lô nào — `linePayloadOf`
 *     (`src/lib/purchasing/save-receipt.ts:34`) ghi đúng 10 cột và
 *     không có cột nào nhận mã lô.
 *   · `complete_purchase_invoice` (migration 145, dòng 141) tự đặt
 *     `batch_code := <mã phiếu> || '-' || lpad(seq,3,'0')`.
 *   · Hạn dùng cũng không do người nhập gõ: cùng hàm ấy lấy
 *     `products.shelf_life_days` (dòng 107) rồi cộng vào ngày hôm nay.
 *
 * Nên bắt người dùng gõ một mã lô rồi vứt đi là hai điều sai cùng lúc:
 * đòi một việc vô ích, và hứa rằng mã họ gõ sẽ tra ra được về sau.
 * Hàm này trả về mã THẬT sẽ xuất hiện trong kho, để màn hình hiện đúng
 * thứ sắp xảy ra.
 *
 * ⚠ CHƯA CÓ MÃ PHIẾU THÌ TRẢ `null`, KHÔNG BỊA MỘT TIỀN TỐ. Phiếu mới
 * chưa lưu chưa có `receipt_code`; đoán bừa là hiện ra một mã lô không
 * bao giờ tồn tại.
 */
export function generatedLotCode(
  receiptCode: string | null | undefined,
  index: number
): string | null {
  const ma = (receiptCode ?? "").trim()
  if (!ma || index < 1) return null
  return `${ma}-${String(index).padStart(3, "0")}`
}

/* ==================================================================
 * §8.5 — TRẢ NCC KHÔNG VƯỢT SỐ ĐÃ NHẬP CÒN LẠI
 * ================================================================== */

/**
 * Trần số lượng của một dòng trả NCC.
 *
 * ⚠ `null` = CHƯA BIẾT, và khi đó KHÔNG chặn. Chặn theo một con số
 * chưa đọc được là khoá người dùng khỏi một việc hợp lệ mà không giải
 * thích nổi. Máy chủ vẫn có chốt thật (`cancel_supplier_return` kiểm
 * lô, và lô hết hàng thì không trả thêm được).
 */
export function supplierReturnMax(receivedRemaining: number | null | undefined): number | null {
  if (receivedRemaining == null) return null
  return Math.max(0, Math.floor(Number(receivedRemaining)))
}

/**
 * ĐỔI ĐƠN VỊ MỘT DÒNG PHIẾU TRẢ NCC (chủ nhà 07/10/2026: "Phiếu trả hàng NCC cả ở pos và mobile chưa chọn được đơn vị
 * tính").
 * - Giá: đang là giá gợi ý của đơn vị cũ (`goiY`, bảng giá nhập) → giá gợi ý của đơn vị mới; không thì quy theo hệ số
 *   (`giá / hệ số cũ × hệ số mới`) — giá vốn không có bảng giá riêng từng đơn vị như giá bán.
 * - Trần "đã nhập" (`ordered`, theo ĐƠN VỊ của dòng) quy đổi theo — 2 thùng ×24 đổi sang hộp là trần 48 hộp; SL đang
 *   gõ vượt trần mới thì kẹp lại.
 * Thiếu hệ số của một trong hai đơn vị thì giữ giá / trần — đoán là ghi sai.
 */
export function doiDonViDongTraNcc<
  L extends { unit: string; price: number; qty: number; units: ReadonlyArray<{ unit_name: string; conversion: number }>; ordered?: number | null }
>(l: L, donVi: string, goiY?: (unit: string) => number): { unit: string; price: number; qty: number; ordered?: number | null } {
  if (donVi === l.unit) return { unit: l.unit, price: l.price, qty: l.qty, ordered: l.ordered }
  const cu = l.units.find((u) => u.unit_name === l.unit)?.conversion
  const moi = l.units.find((u) => u.unit_name === donVi)?.conversion
  const coHeSo = !!cu && !!moi && cu > 0 && moi > 0
  const giaCu = goiY ? goiY(l.unit) : 0
  const giaMoi = goiY ? goiY(donVi) : 0
  const price =
    giaCu > 0 && l.price === giaCu && giaMoi > 0
      ? giaMoi
      : coHeSo
        ? Math.round((l.price / (cu as number)) * (moi as number))
        : l.price
  const ordered = l.ordered == null || !coHeSo ? l.ordered : (l.ordered * (cu as number)) / (moi as number)
  const tran = supplierReturnMax(ordered)
  return { unit: donVi, price, qty: tran == null ? l.qty : Math.min(l.qty, tran), ordered }
}

/* ==================================================================
 * KHOÁ — vì sao chưa huỷ / sửa được
 * ================================================================== */

export type PurchaseLockCode = "DA_TRA_TIEN" | "HANG_DA_XUAT"
export type SupplierReturnLockCode = "DA_CAN_TRU" | "LO_DA_DONG"

export interface DocLock<C extends string> {
  /** Đúng mã máy chủ sẽ ném ra — để hai bên lần ra nhau được. */
  code: C
  message: string
}

/**
 * Phiếu nhập này có huỷ được không — `null` = được.
 *
 * Bản sao của hai phép kiểm trong `cancel_purchase_invoice`:
 *
 *   RAISE 'DA_TRA_TIEN: Phiếu này đã trả NCC % — huỷ phiếu là xoá mất
 *          khoản đã trả. Gỡ phiếu chi trước, hoặc lập phiếu trả hàng NCC.'
 *   RAISE 'HANG_DA_XUAT: Không huỷ được vì hàng của phiếu đã xuất bớt
 *          — %. Lập phiếu trả hàng NCC hoặc phiếu điều chỉnh kho — hoặc
 *          bật "Cho phép bán vượt tồn kho" …'   (chỉ khi NPP CHƯA cho
 *          phép tồn kho âm — mig 238, chủ nhà 08/10/2026)
 *
 * ⚠ NÓI KHOÁ HÀNG ĐÃ XUẤT TRƯỚC. Gỡ phiếu chi là một thao tác ghi sổ;
 * bắt người dùng làm nó xong mới biết hàng đã xuất nên vẫn không huỷ
 * được là bắt họ trả giá cho một việc không thành.
 */
export function purchaseCancelLock(i: {
  paidToSupplier: number
  /** Hàng của phiếu đã bị xuất bớt khỏi kho. */
  stockIssued: boolean
  /** NPP bật "Cho phép bán vượt tồn kho" (`organizations.allow_oversell`) — huỷ được, phần đã xuất thành tồn âm. */
  allowNegativeStock?: boolean
}): DocLock<PurchaseLockCode> | null {
  if (i.stockIssued && !i.allowNegativeStock) {
    return {
      code: "HANG_DA_XUAT",
      message:
        "Hàng của phiếu này đã xuất bớt khỏi kho nên không huỷ được. " +
        "Lập phiếu trả hàng NCC hoặc phiếu nhập kho điều chỉnh thay vì sửa phiếu này — " +
        "hoặc bật “Cho phép bán vượt tồn kho” (Cài đặt › Đơn vị) để huỷ: phần đã xuất thành tồn âm.",
    }
  }
  if (Number(i.paidToSupplier) > 0) {
    return {
      code: "DA_TRA_TIEN",
      message:
        "Phiếu này đã trả tiền NCC nên chưa huỷ được — huỷ phiếu là xoá mất khoản đã trả. " +
        "Gỡ phiếu chi trước, hoặc lập phiếu trả hàng NCC.",
    }
  }
  return null
}

/**
 * Phiếu trả NCC này có huỷ được không — `null` = được.
 *
 * Bản sao của hai phép kiểm trong `cancel_supplier_return`:
 *
 *   RAISE 'DA_CAN_TRU: Khoản giảm công nợ của phiếu này đã được cấn
 *          trừ (%). Gỡ phần cấn trừ trước rồi mới huỷ phiếu.'
 *   RAISE 'LO_DA_DONG: Không huỷ được vì lô hàng đã lấy không còn mở
 *          — %. Lập phiếu nhập kho điều chỉnh thay vì huỷ phiếu này.'
 */
export function supplierReturnCancelLock(i: {
  creditOffset: number
  /** Có lô đã lấy nay không còn ở trạng thái `available`. */
  lotClosed: boolean
}): DocLock<SupplierReturnLockCode> | null {
  if (i.lotClosed) {
    return {
      code: "LO_DA_DONG",
      message:
        "Lô hàng phiếu này đã lấy nay không còn mở nên không huỷ được. " +
        "Lập phiếu nhập kho điều chỉnh thay vì sửa phiếu này.",
    }
  }
  if (Number(i.creditOffset) > 0) {
    return {
      code: "DA_CAN_TRU",
      message:
        "Khoản giảm công nợ của phiếu này đã được cấn trừ nên chưa huỷ được. " +
        "Gỡ phần cấn trừ trước rồi mới sửa phiếu.",
    }
  }
  return null
}

/* ==================================================================
 * TIỀN — PHIẾU NHẬP (màn 9, 10)
 * ================================================================== */

export interface PurchaseTotals {
  goods: number
  lineDiscount: number
  docDiscount: number
  /** Chi phí nhập khác — CỘNG vào, không trừ. */
  otherCost: number
  vat: number
  /** Cần trả NCC. Kẹp về 0. */
  dueToSupplier: number
}

/**
 * Cộng tiền phiếu nhập — đo đúng bản thiết kế:
 *
 *     Tổng tiền hàng                  42.700.000
 *     Giảm giá dòng                      138.000
 *     Giảm giá phiếu                     500.000
 *     Chi phí nhập khác                + 300.000
 *     Thuế GTGT đầu vào                        0
 *     ┌────────────────────────────────────────┐
 *     │ Cần trả NCC                 42.362.000 │
 *     └────────────────────────────────────────┘
 *
 * 42.700.000 − 138.000 − 500.000 + 300.000 = 42.362.000.
 *
 * ⚠ CHI PHÍ NHẬP KHÁC CỘNG VÀO, KHÔNG TRỪ — đây là tiền bốc xếp, vận
 * chuyển, mình trả THÊM. Dùng chung ô `[₫/%]` với giảm giá nên rất dễ
 * viết nhầm dấu; bản thiết kế in hẳn dấu `+` trước con số vì lý do ấy.
 *
 * ⚠ `%` CỦA CHI PHÍ TÍNH TRÊN TIỀN GỘP, cùng nền với giảm giá phiếu.
 * Hai ô cạnh nhau mà tính trên hai nền khác nhau là không ai kiểm lại
 * được bằng tay.
 */
/* ==================================================================
 * THUẾ GTGT CẢ PHIẾU KHI NẠP LẠI (chủ nhà 06/10/2026: "vá luôn vat đi")
 * ================================================================== */

/** Các mức thuế chọn được ở POS (phần trăm). */
export const MUC_VAT_POS = [0, 5, 8, 10] as const

/**
 * Phiếu đã lưu mang TIỀN thuế (`vat_override ?? vat`), màn POS chọn MỨC %. Nạp lại: tiền thuế khớp một mức (lệch ≤ 1đ
 * do làm tròn) → chọn mức đó; không khớp (số gõ tay theo hoá đơn giấy NCC, hoặc thuế từng dòng của phiếu cũ) → GIỮ
 * NGUYÊN SỐ TIỀN (`coDinh`).
 * ⚠ Trước đây POS không nạp thuế: sửa phiếu có VAT là lưu lại với thuế 0 — công nợ NCC hụt đúng tiền thuế.
 */
export function vatNapLai(vat: number | string | null | undefined, nenTinhThue: number): { rate: number; coDinh: number | null } {
  const v = Math.round(Number(vat) || 0)
  if (v <= 0) return { rate: 0, coDinh: null }
  const nen = Math.max(0, Number(nenTinhThue) || 0)
  for (const r of MUC_VAT_POS) {
    if (r > 0 && Math.abs(Math.round((nen * r) / 100) - v) <= 1) return { rate: r, coDinh: null }
  }
  return { rate: 0, coDinh: v }
}

/** Tiền thuế: số giữ theo phiếu thắng mức %. */
export function tienVatPos(nenTinhThue: number, rate: number | undefined, coDinh?: number | null): number {
  if (coDinh != null) return Math.max(0, Math.round(Number(coDinh) || 0))
  return Math.round((Math.max(0, Number(nenTinhThue) || 0) * Math.max(0, Number(rate) || 0)) / 100)
}

export function purchaseTotals(i: {
  lines: readonly PosTotalLine[]
  docDiscount?: DiscountInput
  /** Chi phí nhập khác — cùng dạng `[₫/%]`. */
  otherCost?: DiscountInput
  /** Thuế suất đầu vào, đơn vị phần trăm. */
  vatRate?: number
  /** Tiền thuế giữ theo phiếu đã lưu (không khớp mức % nào) — thắng `vatRate`. */
  vatCoDinh?: number | null
}): PurchaseTotals {
  const t = posTotals({ lines: i.lines, docDiscount: i.docDiscount })
  const otherCost = i.otherCost ? discountAmount(i.otherCost, t.gross) : 0
  const sauGiam = Math.max(0, t.gross - t.lineDiscount - t.docDiscount)
  const vat = tienVatPos(sauGiam, i.vatRate, i.vatCoDinh)
  return {
    goods: t.gross,
    lineDiscount: t.lineDiscount,
    docDiscount: t.docDiscount,
    otherCost,
    vat,
    dueToSupplier: Math.max(0, sauGiam + otherCost + vat),
  }
}

/* ==================================================================
 * TIỀN — PHIẾU TRẢ NCC (màn 11, 12)
 * ================================================================== */

export interface SupplierReturnTotals {
  goods: number
  lineDiscount: number
  /** Chi phí trả hàng — TRỪ đi. */
  fee: number
  /** Thuế GTGT cả phiếu. */
  vat: number
  /** NCC cần hoàn. Kẹp về 0. */
  dueFromSupplier: number
}

/**
 * Cộng tiền phiếu trả NCC — đo đúng bản thiết kế:
 *
 *     Tổng tiền hàng trả               3.860.000
 *     Chi phí trả hàng                 − 150.000
 *     Giảm giá dòng                            0
 *     ┌────────────────────────────────────────┐
 *     │ NCC cần hoàn                 3.710.000 │
 *     └────────────────────────────────────────┘
 *
 * ⚠ CHI PHÍ TRẢ HÀNG TRỪ ĐI, ngược hẳn chi phí NHẬP. Cùng một ô
 * `[₫/%]`, cùng chữ "chi phí", hai chiều ngược nhau: lúc nhập mình
 * trả thêm, lúc trả mình được hoàn ít đi.
 */
export function supplierReturnTotals(i: {
  lines: readonly PosTotalLine[]
  fee?: DiscountInput
  /** Thuế GTGT cả phiếu (%), tính trên tiền hàng trả đã trừ giảm giá dòng — như `complete_supplier_return`. */
  vatRate?: number
  vatCoDinh?: number | null
}): SupplierReturnTotals {
  const t = posTotals({ lines: i.lines })
  const sauGiam = Math.max(0, t.gross - t.lineDiscount)
  const fee = i.fee ? discountAmount(i.fee, t.gross) : 0
  const vat = tienVatPos(sauGiam, i.vatRate, i.vatCoDinh)
  return {
    goods: t.gross,
    lineDiscount: t.lineDiscount,
    fee,
    vat,
    // ⚠ Kẹp về 0 — chi phí lớn hơn tiền hàng thì NCC không hoàn đồng
    //   nào, chứ không phải mình nợ thêm NCC qua ô chi phí. Máy chủ cũng tính `GREATEST(0, sub + vat − discount)`.
    dueFromSupplier: Math.max(0, sauGiam + vat - fee),
  }
}

/** Giá vốn của MỘT LÔ, đúng công thức `complete_purchase_invoice`. */
export function lotUnitCost(i: {
  qty: number
  price: number
  lineDiscount: number
  /** Số lượng quy về đơn vị cơ sở. */
  baseQty: number
}): number | null {
  const base = Number(i.baseQty) || 0
  // ⚠ Chia cho 0 ra `Infinity` — thà nói "chưa tính được".
  if (base <= 0) return null
  return (lineGross(i.qty, i.price) - Math.max(0, Number(i.lineDiscount) || 0)) / base
}
