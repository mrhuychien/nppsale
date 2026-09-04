import type { MisaRelation, MisaStatus } from "@/types"
import { sameInvNo } from "./normalize"

/**
 * Đọc trạng thái hoá đơn từ dữ liệu MISA trả về.
 *
 * HAI TRỤC, HAI FIELD — không phải hai cách đọc một field
 *
 *   PublishStatus  → đã phát hành chưa   (0 nháp … 3 đã cấp mã)
 *   EInvoiceStatus → QUAN HỆ với tờ khác (1 mới, 3 thay thế, 4 điều
 *                    chỉnh, 7 BỊ thay thế, 8 BỊ điều chỉnh)
 *
 * Đo trên 5 hoá đơn thật ở hệ thống dùng cùng cơ chế: PublishStatus giữ
 * nguyên 3 ở cả 5 trong khi EInvoiceStatus chạy 1/3/4/7/8 đúng theo quan
 * hệ. Chỉ đọc PublishStatus là mù hẳn trục quan hệ.
 *
 * File này THUẦN: không gọi mạng, không chạm DB. Cả refresh-status (một
 * hoá đơn) lẫn vòng quét (hàng loạt) đều đi qua đây, nên hai đường không
 * thể lệch kết luận nhau.
 */

/** PublishStatus = 3 là mốc DUY NHẤT chắc chắn "đã cấp mã". */
export const PUBLISH_STATUS_ISSUED = 3
/** PublishStatus = 0 là nháp. */
export const PUBLISH_STATUS_DRAFT = 0

/**
 * `>= 1` KHÔNG phải "đã ký".
 *
 * Các giá trị giữa 0 và 3 là *đang phát hành · phát hành lỗi · chờ cấp mã
 * · từ chối cấp mã*. Mã cũ gán "signed" cho tất cả, nghĩa là hoá đơn BỊ TỪ
 * CHỐI CẤP MÃ cũng được dán nhãn đã ký. Và order-pipeline.tsx đọc đúng cờ
 * đó (`misa_status !== "signed"`) để quyết còn phải xuất hoá đơn nữa
 * không — nên một hoá đơn hỏng sẽ BIẾN KHỎI việc cần làm.
 */
export function isPublished(publishStatus: number | null): boolean {
  return publishStatus === PUBLISH_STATUS_ISSUED
}

const RELATION_BY_CODE: Record<number, MisaRelation> = {
  1: "new",
  3: "replacement",
  4: "adjustment",
  7: "replaced",
  8: "adjusted",
}

/** Đọc trục quan hệ. Giá trị lạ → 'unknown', KHÔNG đoán. */
export function readRelation(eInvoiceStatus: number | null): MisaRelation | null {
  if (eInvoiceStatus == null) return null
  return RELATION_BY_CODE[eInvoiceStatus] ?? "unknown"
}

/**
 * Quan hệ nào làm hoá đơn HẾT HIỆU LỰC.
 *
 * 'replaced' (BỊ thay thế) thì hết. 'adjusted' (BỊ điều chỉnh) thì KHÔNG:
 * hoá đơn điều chỉnh chỉ cộng phần chênh, bản gốc vẫn còn hiệu lực và vẫn
 * phải kê khai. Gộp hai loại là KHAI THIẾU doanh thu bản gốc.
 */
export function relationVoidsInvoice(relation: MisaRelation | null): boolean {
  return relation === "replaced"
}

/**
 * Hoá đơn ĐIỀU CHỈNH mang số CHÊNH, không phải tổng tiền của lần bán.
 * Đem nó so với invoices.total là chắc chắn lệch, mọi tờ, mãi mãi.
 */
export function carriesDifferenceOnly(relation: MisaRelation | null): boolean {
  return relation === "adjustment"
}

/** Chỗ giữ chỗ của MISA khi chưa cấp số. */
export function isPlaceholderInvNo(invNo: string | null | undefined): boolean {
  if (!invNo) return true
  const t = invNo.trim()
  return t === "" || t.startsWith("<")
}

/** Các field thô lấy từ bản ghi MISA. */
export interface MisaSnapshot {
  invNo: string | null
  invSeries: string | null
  invDate: string | null
  invoiceCode: string | null
  transactionId: string | null
  publishStatus: number | null
  eInvoiceStatus: number | null
  orgRefId: string | null
  cancelled: boolean
  /** Tên field đã dùng để kết luận `cancelled` — để ghi lại, xem readCancelled. */
  cancelledSource: string | null
  /** DeletedReason của MISA (§M.3) — lý do huỷ, có thì ghi vào ghi chú. */
  deletedReason: string | null
  totalAmount: number | null
  totalWithoutVat: number | null
  totalVat: number | null
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

/**
 * Cờ "đã huỷ" = `IsInvoiceDeleted`.
 *
 * ĐÃ XÁC MINH bằng `afterpublishing/{RefID}` chạy trên tài khoản thật
 * (hợp đồng API MISA §M.3): object 194 field, `IsInvoiceDeleted` là cờ
 * huỷ, đi kèm `DeletedDate` / `DeletedReason`. Trước đây chỗ này đoán ba
 * cái tên khác và cả ba đều SAI — giữ lại làm dự phòng, nhưng tên đã xác
 * minh phải đứng đầu.
 *
 * §M.3 cũng chốt: nhận biết vòng đời phải đọc CỜ THẬT, không suy từ
 * `EInvoiceStatus`. Trục quan hệ chỉ trả lời "bị thay thế / bị điều
 * chỉnh", nó không nói gì về việc huỷ.
 *
 * CHỈ nhận `=== true` của đúng kiểu boolean. Nhận cả số hay chuỗi
 * "truthy" là mở đường cho một field kiểu `CancelStatus: 0` bị đọc thành
 * "đã huỷ" — dán nhãn huỷ lên hoá đơn còn hiệu lực là hỏng sổ.
 */
const CANCEL_FIELDS = [
  "IsInvoiceDeleted", // ← đã xác minh
  "IsInvoiceCanceled",
  "IsCanceled",
  "IsCancelled",
] as const

export function readCancelled(raw: Record<string, unknown>): {
  cancelled: boolean
  source: string | null
} {
  for (const f of CANCEL_FIELDS) {
    if (raw[f] === true) return { cancelled: true, source: f }
  }
  return { cancelled: false, source: null }
}

/** Bóc bản ghi MISA thô thành các field mình dùng. */
export function readSnapshot(raw: Record<string, unknown>): MisaSnapshot {
  const { cancelled, source } = readCancelled(raw)
  return {
    deletedReason: str(raw["DeletedReason"]),
    invNo: str(raw["InvNo"]),
    invSeries: str(raw["InvSeries"]),
    invDate: str(raw["InvDate"]),
    invoiceCode: str(raw["InvoiceCode"]),
    transactionId: str(raw["TransactionID"]),
    publishStatus: num(raw["PublishStatus"]),
    eInvoiceStatus: num(raw["EInvoiceStatus"]),
    orgRefId: str(raw["OrgRefID"]),
    cancelled,
    cancelledSource: source,
    totalAmount: num(raw["TotalAmount"]),
    totalWithoutVat: num(raw["TotalAmountWithoutVAT"]),
    totalVat: num(raw["TotalVATAmount"]),
  }
}

export interface DeriveInput {
  snap: MisaSnapshot
  /** company_einvoice_config.misa_is_invoice_with_code */
  orgUsesInvoiceCode: boolean
  /** Trạng thái đang lưu — dùng khi KHÔNG kết luận được, để không hạ oan. */
  currentStatus: MisaStatus | null
}

export interface DerivedState {
  /** null = KHÔNG kết luận được, giữ nguyên trạng thái đang có. */
  status: MisaStatus | null
  relation: MisaRelation | null
  /** Ghi chú cho người đọc; null nếu không có gì đáng nói. */
  note: string | null
}

/**
 * Suy ra trạng thái + quan hệ. Không bao giờ đoán: chỗ nào không chắc thì
 * trả `status: null` (giữ nguyên cái đang có) kèm ghi chú nói rõ vì sao.
 */
export function deriveState({ snap, orgUsesInvoiceCode, currentStatus }: DeriveInput): DerivedState {
  const relation = readRelation(snap.eInvoiceStatus)
  const notes: string[] = []

  if (relation === "unknown") {
    notes.push(`MISA trả EInvoiceStatus=${snap.eInvoiceStatus} (không rõ nghĩa) — chưa xác định quan hệ.`)
  }

  // --- Trạng thái CUỐI: huỷ và bị thay thế thắng mọi thứ khác ---------
  if (snap.cancelled) {
    notes.push(
      `MISA báo hoá đơn ĐÃ HUỶ (${snap.cancelledSource})` +
        (snap.deletedReason ? ` — lý do: ${snap.deletedReason}.` : ".")
    )
    return { status: "cancelled", relation, note: notes.join(" ") || null }
  }
  if (relationVoidsInvoice(relation)) {
    // Hết hiệu lực BẤT KỂ đã cấp mã hay chưa.
    notes.push("Hoá đơn này đã BỊ THAY THẾ trên MISA — hết hiệu lực, không kê khai.")
    return { status: "replaced", relation, note: notes.join(" ") }
  }
  if (relation === "adjusted") {
    // BỊ điều chỉnh: VẪN CÒN hiệu lực. Chỉ ghi nhận, không đổi trạng thái
    // phát hành — gộp nó vào 'replaced' là khai thiếu doanh thu bản gốc.
    notes.push("Hoá đơn này BỊ ĐIỀU CHỈNH bởi một tờ khác — VẪN còn hiệu lực và vẫn phải kê khai.")
  }

  // --- Trục phát hành -------------------------------------------------
  if (isPlaceholderInvNo(snap.invNo)) {
    // Chưa cấp số: vẫn là bản nháp đã đẩy lên. Không hạ trạng thái đang
    // đúng xuống thấp hơn 'sent'.
    return {
      status: currentStatus === "sent" ? null : "sent",
      relation,
      note: notes.join(" ") || null,
    }
  }

  if (isPublished(snap.publishStatus)) {
    return { status: "signed", relation, note: notes.join(" ") || null }
  }

  if (snap.publishStatus === PUBLISH_STATUS_DRAFT) {
    return { status: "sent", relation, note: notes.join(" ") || null }
  }

  // --- PublishStatus lạ: KHÔNG ĐOÁN, lùi về mốc chắc chắn -------------
  if (orgUsesInvoiceCode) {
    // Đơn vị dùng hoá đơn CÓ MÃ: mã cơ quan thuế là bằng chứng chắc chắn.
    if (snap.invoiceCode) {
      return { status: "signed", relation, note: notes.join(" ") || null }
    }
    notes.push(
      `MISA trả PublishStatus=${snap.publishStatus} (không rõ nghĩa) và chưa có mã CQT — đang chờ cấp mã.`
    )
    return { status: "waiting_code", relation, note: notes.join(" ") }
  }

  // Đơn vị dùng hoá đơn KHÔNG MÃ: sẽ KHÔNG BAO GIỜ có InvoiceCode. Trả
  // 'waiting_code' cho họ là để mọi hoá đơn đứng vĩnh viễn ở "chờ cấp mã".
  // Mà cũng không có bằng chứng nào khác để nói "đã phát hành" — nên
  // KHÔNG đổi trạng thái, chỉ ghi lại giá trị thô để người xử lý.
  notes.push(
    `MISA trả PublishStatus=${snap.publishStatus} (không rõ nghĩa). Đơn vị dùng hoá đơn ` +
      `KHÔNG MÃ nên không có mã CQT để đối chiếu — giữ nguyên trạng thái, cần kiểm tra tay.`
  )
  return { status: null, relation, note: notes.join(" ") }
}

// =====================================================================
// So tiền
// =====================================================================

/** Dung sai 1đ — chênh lệch làm tròn giữa hai hệ. */
export const AMOUNT_TOLERANCE = 1

export interface AmountCheckInput {
  snap: MisaSnapshot
  relation: MisaRelation | null
  book: { subtotal: number | null; vat: number | null; total: number | null }
}

export interface AmountCheckResult {
  /** true = có VẤN ĐỀ thật sự, đáng nâng trạng thái lên lệch. */
  mismatch: boolean
  /** Ghi chú; có cả khi không lệch (vd giải thích vì sao bỏ qua). */
  note: string | null
  /** Những vế đã thật sự so — để biết chốt này có chạy hay không. */
  compared: string[]
}

/**
 * So tiền ba vế, nhưng CHỈ vế nào MISA thật sự trả số.
 *
 * MISA có endpoint trả `TotalAmountWithoutVAT` / `TotalVATAmount` bằng
 * 0.0 cho MỌI bản ghi (đo 30/30 ở hệ thống dùng cùng cơ chế — với endpoint
 * danh sách; repo này gọi endpoint một-hoá-đơn nên CHƯA đo được là có
 * giống vậy không). So số 0 đó với subtotal thì mọi hoá đơn khớp đều bị
 * gắn lệch, rổ cảnh báo đầy báo động giả, rồi không ai nhìn cả cảnh báo
 * thật.
 *
 * Tổng tiền thì luôn có, nên luôn so — và một mình nó đã đủ bắt lệch.
 */
export function checkAmounts({ snap, relation, book }: AmountCheckInput): AmountCheckResult {
  // TÁCH VẤN ĐỀ KHỎI THÔNG TIN: hoá đơn điều chỉnh mang số CHÊNH, không
  // phải tổng. Nó hoàn toàn bình thường — đếm nó vào ô "lệch" là sinh
  // cảnh báo giả cho một nghiệp vụ đúng.
  if (carriesDifferenceOnly(relation)) {
    return {
      mismatch: false,
      note: "Hoá đơn ĐIỀU CHỈNH mang số chênh, không phải tổng tiền — không so với sổ.",
      compared: [],
    }
  }

  const diffs: string[] = []
  const compared: string[] = []

  const cmp = (label: string, misa: number | null, mine: number | null) => {
    // Chỉ so khi MISA THẬT SỰ trả số, và sổ cũng có số để so.
    if (misa == null || mine == null) return
    compared.push(label)
    if (Math.abs(misa - mine) > AMOUNT_TOLERANCE) {
      diffs.push(`${label}: sổ ${mine}, MISA ${misa}`)
    }
  }

  cmp("Tổng tiền", snap.totalAmount, book.total)
  // Hai vế dưới CHỈ so khi MISA trả khác 0. `0` ở đây nghĩa là "endpoint
  // không tách thuế", không phải "tiền bằng không".
  if (snap.totalWithoutVat != null && snap.totalWithoutVat !== 0) {
    cmp("Tiền hàng", snap.totalWithoutVat, book.subtotal)
  }
  if (snap.totalVat != null && snap.totalVat !== 0) {
    cmp("Thuế GTGT", snap.totalVat, book.vat)
  }

  if (!diffs.length) return { mismatch: false, note: null, compared }
  return { mismatch: true, note: `Lệch tiền với MISA — ${diffs.join(" · ")}.`, compared }
}

/**
 * Số hoá đơn MISA cấp có khác số đang ghi trong sổ không.
 * So qua bản chuẩn hoá: '00012345' và '12345' là cùng một số.
 */
export function invNoConflict(bookInvNo: string | null, misaInvNo: string | null): boolean {
  if (!bookInvNo || !misaInvNo) return false
  return !sameInvNo(bookInvNo, misaInvNo)
}
