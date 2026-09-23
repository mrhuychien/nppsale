import type { OfflineReturnLine } from "@/lib/orders/create"
import { RETURN_REASONS as CONSTANT_REASONS } from "@/lib/constants"
import { ceilingFor } from "@/lib/sell/cart"
import { viMatchAllWords } from "@/lib/search"

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
 * ⚠ HẠ GIÁ THÌ LUÔN ĐƯỢC, kể cả xuống 0. Hàng hư hỏng, hàng cận date, hàng
 * đã bóc lẻ — mỗi ca một mức bù khác nhau, và bắt trả đúng giá bảng là ép
 * công ty trả tiền cho thứ không bán lại được. Đây cũng là chiều AN TOÀN:
 * hạ giá là công ty chi ít đi.
 */
export type ReturnPriceIssue = "above_ceiling" | "negative"

export interface ReturnPriceRules {
  /** % được nâng so với giá tham chiếu — CÙNG con số với giá bán. */
  maxIncreasePct: number
  /** Chủ / kế toán: không trần. Xem `userPriceRulesFrom`. */
  free?: boolean
}

export function returnPriceViolation(
  line: Pick<ReturnCartLine, "price">,
  listPrice: number,
  rules: ReturnPriceRules = { maxIncreasePct: 0 }
): ReturnPriceIssue | null {
  const p = Number(line.price)
  if (!Number.isFinite(p) || p < 0) return "negative"
  if (rules.free) return null
  // ⚠ Chưa tra ra giá tham chiếu (bằng 0) thì KHÔNG lấy 0 làm trần — làm
  // vậy là chặn mọi dòng trả của mặt hàng chưa có giá, trong khi khách vẫn
  // đang đứng đó với hàng trên tay.
  if (listPrice <= 0) return null
  if (p > ceilingFor(listPrice, rules.maxIncreasePct)) return "above_ceiling"
  return null
}

/** Trần giá trả — hiện lên màn hình để người dùng biết mình đi tới đâu. */
export function returnCeilingFor(listPrice: number, rules: ReturnPriceRules): number {
  return rules.free ? Infinity : ceilingFor(listPrice, rules.maxIncreasePct)
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
  const out: T[] = []
  for (const p of products) {
    if (!viMatchAllWords(term, p.name, p.sku, p.barcode ?? "")) continue
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}
