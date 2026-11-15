import type { OfflineReturnLine } from "@/lib/orders/create"
import { RETURN_REASONS as CONSTANT_REASONS } from "@/lib/constants"
import { ceilingFor } from "@/lib/sell/cart"
import { timXepHang } from "@/lib/search"

/**
 * Hàng trả / đổi đi kèm một đơn bán.
 *
 * HAI LOẠI DÒNG, KHÁC NHAU Ở CHỖ TIỀN
 *   · TRẢ TIỀN: hàng nhập lại kho, và tiền hàng TRỪ vào đơn này.
 *   · ĐỔI HÀNG: hàng nhập lại kho, nhưng KHÔNG trừ tiền — khách đã lấy
 *     hàng khác thay thế, và hàng thay thế đó nằm trong phần bán.
 *
 * ⚠ Nhầm hai loại là sai tiền theo cả hai chiều: coi dòng đổi là trả thì
 * bớt tiền hai lần, coi dòng trả là đổi thì khách trả tiền cho hàng đã
 * đưa lại.
 */
export interface ReturnCartLine {
  productId: string
  unit: string
  qty: number
  /** Đơn giá dùng để quy ra tiền trả. */
  price: number
  vatRate: number
  isExchange: boolean
  note: string
  /** Lý do trả của riêng dòng — xem `OfflineReturnLine.reason`. */
  reason?: string
}

/**
 * ⚠ MỘT DANH SÁCH LÝ DO DUY NHẤT, và nó phải khớp ràng buộc CHECK của cột
 * `returns.reason` dưới database. Trước đây màn bán hàng có bản riêng
 * THIẾU "Hết hạn sử dụng": cùng một việc mà hai màn cho hai bộ lựa chọn,
 * và lý do hay gặp nhất của hàng FMCG thì chỉ một màn chọn được.
 */
export { RETURN_REASONS } from "@/lib/constants"

export function returnReasonLabel(value: string): string {
  return CONSTANT_REASONS.find((r) => r.value === value)?.label ?? value
}

/**
 * Tiền trừ vào đơn.
 *
 * ⚠ CHỈ CỘNG DÒNG TRẢ TIỀN. Dòng đổi hàng không trừ đồng nào — xem chú
 * thích đầu file.
 */
export function returnCreditOf(lines: ReturnCartLine[]): number {
  return Math.round(
    lines.filter((l) => !l.isExchange).reduce((s, l) => s + l.qty * l.price * (1 + (l.vatRate || 0)), 0)
  )
}

export function findReturnLine(lines: ReturnCartLine[], productId: string, unit: string): number {
  return lines.findIndex((l) => l.productId === productId && l.unit === unit)
}

/** Thêm dòng trả; trùng (sản phẩm + đơn vị) thì cộng dồn, giữ nguyên chỗ. */
export function addReturnLine(lines: ReturnCartLine[], line: ReturnCartLine): ReturnCartLine[] {
  const i = findReturnLine(lines, line.productId, line.unit)
  if (i >= 0) {
    const next = [...lines]
    next[i] = { ...next[i], qty: next[i].qty + line.qty }
    return next
  }
  return [line, ...lines]
}

/**
 * CHỌN NHIỀU Ở MÀN HÀNG TRẢ (chủ nhà yêu cầu 23/09/2026) — đặt số lượng
 * TUYỆT ĐỐI cho nhiều mặt hàng một lần, cùng luật với `setLinesQty` của
 * giỏ bán: dòng đã có giữ giá (có thể đã sửa tay), trả/đổi, ghi chú, lý do
 * và vị trí; `qty <= 0` là bỏ dòng; dòng mới lên đầu, mặc định TRẢ TIỀN.
 * Hai lựa chọn trùng (sản phẩm + đơn vị): lựa chọn sau thắng.
 */
export function setReturnLinesQty(lines: ReturnCartLine[], picks: ReturnCartLine[]): ReturnCartLine[] {
  const cuoi = new Map<string, ReturnCartLine>()
  for (const p of picks) cuoi.set(`${p.productId}|${p.unit}`, p)
  let next = [...lines]
  const moi: ReturnCartLine[] = []
  cuoi.forEach((p) => {
    const i = findReturnLine(next, p.productId, p.unit)
    if (i >= 0) {
      if (p.qty <= 0) next = next.filter((_, k) => k !== i)
      else next[i] = { ...next[i], qty: p.qty }
    } else if (p.qty > 0) {
      moi.push(p)
    }
  })
  return [...moi, ...next]
}

export function setReturnQty(
  lines: ReturnCartLine[],
  index: number,
  qty: number
): ReturnCartLine[] {
  if (index < 0 || index >= lines.length) return lines
  if (qty <= 0) return lines.filter((_, i) => i !== index)
  const next = [...lines]
  next[index] = { ...next[index], qty }
  return next
}

export function patchReturnLine(
  lines: ReturnCartLine[],
  index: number,
  patch: Partial<ReturnCartLine>
): ReturnCartLine[] {
  if (index < 0 || index >= lines.length) return lines
  const next = [...lines]
  next[index] = { ...next[index], ...patch }
  return next
}

/**
 * Chuyển sang dạng lưu xuống DB.
 *
 * ⚠ LUÔN gửi `is_exchange`, kể cả khi `false`. PostgREST suy ra danh sách
 * cột từ DÒNG ĐẦU TIÊN của mảng, nên một dòng có cột đó đứng sau các dòng
 * không có sẽ mất giá trị một cách lặng lẽ và mọi dòng đổi thành dòng trả
 * tiền — sai tiền mà không báo gì.
 */
export function toReturnLine(l: ReturnCartLine): OfflineReturnLine {
  const note = l.note?.trim()
  return {
    product_id: l.productId,
    unit_name: l.unit,
    quantity: l.qty,
    unit_price: l.price,
    vat_rate: l.vatRate || 0,
    line_total: Math.round(l.qty * l.price * (1 + (l.vatRate || 0))),
    is_exchange: l.isExchange,
    ...(l.reason ? { reason: l.reason } : {}),
    ...(note ? { note } : {}),
  }
}

/** Dòng trả bỏ cột `reason` (mig 159) — cho máy chủ chưa chạy migration ấy. */
export function boCotMoiCuaDongTra(l: OfflineReturnLine): OfflineReturnLine {
  const con = { ...l }
  delete con.reason
  return con
}

/**
 * Giá của một dòng hàng trả có hợp lệ không.
 *
 * VÌ SAO LUẬT NGƯỢC VỚI DÒNG BÁN
 *   Dòng BÁN bị chặn khi giá THẤP hơn bảng giá — bán rẻ là mất tiền.
 *   Dòng TRẢ thì ngược: tiền đi RA khỏi công ty, nên chỗ nguy hiểm là giá
 *   CAO. Trả về cao hơn mức cho phép là một đường rút tiền: mua 100k, trả
 *   lại 150k, và không quy tắc duyệt nào chạm tới vì đây không phải dòng
 *   bán.
 *
 * ⚠ TRẦN GIÁ TRẢ = TRẦN GIÁ BÁN CỦA CHÍNH NGƯỜI ĐÓ. Ai được nâng giá bán
 * trong biên độ 5% thì cũng được trả trong biên độ 5% — cùng một thẩm
 * quyền về tiền, cùng một con số. Để hai bên hai trần khác nhau là bắt
 * người dùng nhớ hai luật cho một việc, và cái nào chặt hơn thì trông như
 * lỗi.
 *
 * ⚠ CÓ SÀN: KHÔNG THẤP HƠN GIÁ NIÊM YẾT QUÁ 20% (chủ nhà 15/11/2026: "giá trả
 * không được thấp quá 20% giá niêm yết" — thay luật cũ "hạ giá thì luôn
 * được, kể cả xuống 0"). Trả rẻ không phải chiều an toàn: tiền trả thấp làm
 * hàng trả trừ ít đi ở doanh số thuần và đẩy "chênh lệch trả" của nhân viên
 * lên (chênh trả = giá niêm yết − giá trả). Sàn = `sanGiaTra`; máy chủ chặn
 * cùng luật (mig 263, `_chot_gia_san_dong_tra`).
 */
export type ReturnPriceIssue = "above_ceiling" | "below_floor" | "negative"

export interface ReturnPriceRules {
  /** % được nâng so với giá tham chiếu — CÙNG con số với giá bán. */
  maxIncreasePct: number
  /** Chủ / kế toán: không trần, không sàn. Xem `userPriceRulesFrom`. */
  free?: boolean
}

/** Giá trả thấp nhất được phép, tính bằng % giảm so với giá niêm yết (chủ nhà 15/11/2026: "không được thấp quá 20%"). */
export const GIAM_TOI_DA_GIA_TRA_PCT = 20

/**
 * SÀN GIÁ TRẢ của một dòng (0 = không có sàn).
 *   · `niemYet` — giá bảng ĐÚNG đơn vị của dòng, theo nhóm giá của khách (`unitPriceFor`; máy chủ `_gia_bang_don_vi`).
 *     Chưa có giá (0) thì không có sàn — như trần.
 *   · `daBan` — giá đã bán THẤP NHẤT của mặt hàng + đơn vị trên hoá đơn gắn phiếu (đơn giá sau giảm dòng, trước thuế,
 *     bỏ dòng hàng đổi). Thấp hơn sàn (khuyến mãi, NPP giảm sâu) thì sàn là giá đã bán: khách trả lại đúng số tiền đã
 *     trả, công ty không phải bù hơn số đã thu.
 * ⚠ Cùng phép tính với máy chủ: round(niêm yết × 80 / 100) — số nguyên × 80 / 100 không bao giờ rơi đúng ,5.
 */
export function sanGiaTra(niemYet: number, daBan?: number | null): number {
  const ny = Number(niemYet)
  if (!Number.isFinite(ny) || ny <= 0) return 0
  const san = Math.round((ny * (100 - GIAM_TOI_DA_GIA_TRA_PCT)) / 100)
  const db = daBan == null ? NaN : Number(daBan)
  return Number.isFinite(db) && db >= 0 && db < san ? db : san
}

/**
 * Giá đã bán THẤP NHẤT của (mặt hàng, đơn vị) trên các dòng hoá đơn gắn phiếu — bỏ dòng hàng đổi (0đ, không phải giá
 * bán). Không có dòng nào → null. Cùng phép `min(unit_price)` của máy chủ (mig 263).
 */
export function giaDaBanThapNhat(
  dong: ReadonlyArray<{ productId: string; unit: string; price: number; isExchange?: boolean | null }>,
  productId: string,
  unit: string
): number | null {
  let min: number | null = null
  for (const d of dong) {
    if (d.isExchange || d.productId !== productId || d.unit !== unit) continue
    const g = Number(d.price)
    if (!Number.isFinite(g)) continue
    if (min === null || g < min) min = g
  }
  return min
}

/** Giá tham chiếu cho SÀN khi khác giá tham chiếu của trần (phiếu gắn hoá đơn: trần theo giá đã bán, sàn theo niêm yết). */
export interface ThamChieuSanTra {
  /** Giá niêm yết đúng đơn vị (nhóm giá của khách). Thiếu → dùng `listPrice` của `returnPriceViolation`. */
  niemYet?: number
  /** Giá đã bán thấp nhất trên hoá đơn gắn phiếu — xem `sanGiaTra`. */
  daBan?: number | null
}

export function returnPriceViolation(
  line: Pick<ReturnCartLine, "price"> & { isExchange?: boolean },
  listPrice: number,
  rules: ReturnPriceRules = { maxIncreasePct: 0 },
  thamChieuSan: ThamChieuSanTra = {}
): ReturnPriceIssue | null {
  const p = Number(line.price)
  if (!Number.isFinite(p) || p < 0) return "negative"
  if (rules.free) return null
  // ⚠ Dòng HÀNG ĐỔI không trừ đồng nào — không trần, không sàn (máy chủ cũng bỏ qua dòng đổi).
  if (line.isExchange) return null
  // ⚠ Chưa tra ra giá tham chiếu (bằng 0) thì KHÔNG lấy 0 làm trần — làm
  // vậy là chặn mọi dòng trả của mặt hàng chưa có giá, trong khi khách vẫn
  // đang đứng đó với hàng trên tay.
  if (listPrice > 0 && p > ceilingFor(listPrice, rules.maxIncreasePct)) return "above_ceiling"
  // Dung sai 1 đồng như máy chủ.
  const san = sanGiaTra(thamChieuSan.niemYet ?? listPrice, thamChieuSan.daBan)
  if (san > 0 && p < san - 1) return "below_floor"
  return null
}

/** Trần giá trả — hiện lên màn hình để người dùng biết mình đi tới đâu. */
export function returnCeilingFor(listPrice: number, rules: ReturnPriceRules): number {
  return rules.free ? Infinity : ceilingFor(listPrice, rules.maxIncreasePct)
}

/**
 * CHỈ KIỂM SÀN — cho màn POS: trần ở đó do máy chủ chốt theo giá đã bán trên hoá đơn (mig 230), màn không có đủ dữ liệu
 * để kiểm trần mà không chặt hơn máy chủ. `true` = giá dưới sàn (dòng đổi, chủ / kế toán, chưa có giá niêm yết: luôn `false`).
 */
export function duoiSanGiaTra(
  line: Pick<ReturnCartLine, "price"> & { isExchange?: boolean },
  niemYet: number,
  rules: Pick<ReturnPriceRules, "free">,
  daBan?: number | null
): boolean {
  return returnPriceViolation(line, 0, { maxIncreasePct: 0, free: rules.free }, { niemYet, daBan }) === "below_floor"
}

/** Sàn giá trả theo quyền (chủ / kế toán: 0 — không sàn). */
export function returnFloorFor(niemYet: number, rules: ReturnPriceRules, daBan?: number | null): number {
  return rules.free ? 0 : sanGiaTra(niemYet, daBan)
}

/**
 * Câu báo dưới ô giá / ở chốt chặn lưu — nói ĐÚNG con số dừng ở đâu (người đọc phải sửa được ngay, không đoán).
 */
export function cauGiaTraSai(
  issue: ReturnPriceIssue,
  gioiHan: { tran?: number; san?: number },
  dinhDang: (n: number) => string
): string {
  if (issue === "negative") return "Đơn giá không được âm"
  if (issue === "above_ceiling") {
    return gioiHan.tran != null && Number.isFinite(gioiHan.tran)
      ? `Giá trả vượt trần — tối đa ${dinhDang(gioiHan.tran)}`
      : "Giá trả vượt trần"
  }
  return gioiHan.san != null && gioiHan.san > 0
    ? `Giá trả thấp quá — tối thiểu ${dinhDang(gioiHan.san)} (không dưới giá niêm yết quá ${GIAM_TOI_DA_GIA_TRA_PCT}%)`
    : `Giá trả không được dưới giá niêm yết quá ${GIAM_TOI_DA_GIA_TRA_PCT}%`
}

/**
 * LỌC DANH MỤC CHO Ô THÊM HÀNG Ở PHIẾU TRẢ.
 *
 * ⚠ MỘT DÒNG, NHƯNG PHẢI NẰM Ở ĐÂY CHỨ KHÔNG NẰM TRONG MÀN HÌNH. Đã thử
 * phá: chặn lại ô trống ngay trong `page.tsx` mà chốt vẫn XANH — vì chốt
 * chỉ soi được MỘT CÁCH VIẾT (`if (!term) return []`), còn luật thì viết
 * được mười kiểu. Một luật không ai canh là một luật sẽ trôi, và luật
 * này đã trôi hai lần rồi.
 *
 * ⚠ TỪ KHOÁ RỖNG THÌ KHỚP TẤT CẢ, KHÔNG TRẢ VỀ RỖNG. Chủ nhà chốt
 * 20/09/2026 "bấm vào là phải xổ list rồi", nhắc lại 21/09/2026 đúng màn
 * này. `viMatchAllWords` vốn đã khớp tất cả khi không có từ nào —
 * thứ phải giữ là ĐỪNG chặn trước nó.
 *
 * ⚠ VẪN CÓ TRẦN. Đổ cả 1.700 mã xuống là dựng lại đúng cái danh sách
 * phải cuộn mà ô tìm sinh ra để thay thế.
 */
export function searchReturnable<
  T extends { name: string; sku: string; barcode?: string | null }
>(products: T[], term: string, limit: number): T[] {
  return timXepHang(products, term, (x) => [x.sku, x.barcode, x.name], { gioiHan: limit, nho: "hang" }).ketQua
}
