/**
 * DANH SÁCH CHỨNG TỪ TRÊN ĐIỆN THOẠI — phần tính thuần.
 *
 * Mẫu chủ nhà gửi đổi mỗi dòng đơn / hóa đơn từ "mã + tiền" thành bốn
 * dòng: khách + tiền · giờ và mã · MẶT HÀNG CHÍNH + số lượng · trạng
 * thái. Cộng thêm một dải tóm tắt phía trên (bao nhiêu chứng từ, tổng
 * bao nhiêu tiền) và một nút đổi khoảng thời gian.
 *
 * ⚠ VÌ SAO TÁCH RA. Ba chỗ dưới đây quyết định NGHĨA của những gì hiện
 * trên màn — mốc thời gian của bộ lọc, mặt hàng nào được chọn làm đại
 * diện, và câu chữ đi kèm. Nằm rải trong JSX thì không chốt được, và mỗi
 * lần sửa giao diện là một lần chúng lặng lẽ đổi nghĩa.
 */

import { VN_TZ } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"

/* ------------------------------------------------------------------ */
/* Khoảng thời gian                                                     */
/* ------------------------------------------------------------------ */

export type ListPeriod = "today" | "week" | "month" | "all"

export const LIST_PERIODS: ListPeriod[] = ["today", "week", "month", "all"]

export const LIST_PERIOD_LABEL: Record<ListPeriod, string> = {
  today: "Hôm nay",
  week: "7 ngày qua",
  month: "Tháng này",
  all: "Tất cả",
}

/** Ngày theo giờ Việt Nam, dạng YYYY-MM-DD. */
function vnDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: VN_TZ })
}

/**
 * Mốc ĐẦU của khoảng, dạng YYYY-MM-DD; `null` nghĩa là không giới hạn.
 *
 * ⚠ TÍNH THEO NGÀY GIỜ VIỆT NAM. Cột `order_date` / `invoice_date` là
 * kiểu `date` và được ghi theo ngày Việt Nam; so với một mốc dựng từ giờ
 * máy chủ (UTC) là suốt bảy tiếng đầu mỗi ngày "Hôm nay" mất sạch đơn
 * của hôm nay.
 *
 * ⚠ "7 NGÀY QUA" GỒM CẢ HÔM NAY — tức là hôm nay và sáu ngày trước, chứ
 * không phải hôm nay trừ đi bảy. Người bán đọc "7 ngày qua" là nghĩ tới
 * một tuần tính cả hôm nay.
 */
export function periodFrom(period: ListPeriod, now: Date = new Date()): string | null {
  if (period === "all") return null
  const today = vnDay(now)
  const [y, m, d] = today.split("-").map(Number)
  if (period === "today") return today
  if (period === "month") return `${y}-${String(m).padStart(2, "0")}-01`
  // week
  const ms = Date.UTC(y, m - 1, d) - 6 * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Bấm vào viên thuốc là sang khoảng kế tiếp, quay vòng. */
export function nextPeriod(period: ListPeriod): ListPeriod {
  const i = LIST_PERIODS.indexOf(period)
  return LIST_PERIODS[(i + 1) % LIST_PERIODS.length]
}

/* ------------------------------------------------------------------ */
/* Mặt hàng đại diện của một chứng từ                                   */
/* ------------------------------------------------------------------ */

export interface DocLineBrief {
  /** Mã chứng từ cha — đơn hàng hoặc hóa đơn. */
  doc_id: string
  unit_name?: string | null
  quantity?: number | string | null
  line_total?: number | string | null
  product?: { name?: string | null } | null
}

export interface DocLineSummary {
  /** Tổng số DÒNG hàng của chứng từ. */
  count: number
  name: string | null
  unit: string | null
  qty: number
}

/**
 * Chọn MỘT mặt hàng đại diện cho mỗi chứng từ, và đếm số dòng.
 *
 * ⚠ KHÔNG LẤY "DÒNG ĐẦU TIÊN". `sales_order_lines` KHÔNG có cột thứ tự,
 * nên "dòng đầu" là dòng nào tuỳ Postgres trả về — mở lại danh sách là
 * một đơn có thể đổi sang mặt hàng khác, và người dùng tưởng dữ liệu vừa
 * thay đổi. Ở đây lấy dòng CÓ THÀNH TIỀN LỚN NHẤT: vừa ổn định, vừa là
 * mặt hàng đáng nhắc nhất của đơn.
 *
 * ⚠ HOÀ THÌ SO TIẾP THEO TÊN. Hai dòng cùng thành tiền vẫn phải ra cùng
 * một kết quả ở mọi lần vẽ.
 */
export function summariseDocLines(rows: DocLineBrief[]): Record<string, DocLineSummary> {
  const out: Record<string, DocLineSummary> = {}
  const best: Record<string, number> = {}
  for (const r of rows) {
    if (!r.doc_id) continue
    const cur = out[r.doc_id]
    if (!cur) {
      out[r.doc_id] = { count: 0, name: null, unit: null, qty: 0 }
      best[r.doc_id] = -Infinity
    }
    out[r.doc_id].count += 1
    const total = Number(r.line_total) || 0
    const name = r.product?.name ?? null
    const prev = best[r.doc_id]
    const wins =
      total > prev ||
      (total === prev && (name ?? "").localeCompare(out[r.doc_id].name ?? "", "vi") < 0)
    if (wins) {
      best[r.doc_id] = total
      out[r.doc_id].name = name
      out[r.doc_id].unit = r.unit_name ?? null
      out[r.doc_id].qty = Number(r.quantity) || 0
    }
  }
  return out
}

/**
 * Dòng thứ ba của thẻ: tên mặt hàng đại diện kèm đơn vị.
 *
 * ⚠ CHƯA ĐỌC ĐƯỢC DÒNG HÀNG THÌ TRẢ CHUỖI RỖNG, đừng trả "0 mặt hàng".
 * Số 0 ở đây nghĩa là "đơn không có hàng nào" — một câu khác hẳn, và là
 * câu sai trong lúc truy vấn còn đang chạy.
 */
export function docSummaryText(s: DocLineSummary | undefined): string {
  if (!s) return ""
  if (s.name) return s.unit ? `${s.name} (${s.unit})` : s.name
  return `${s.count} mặt hàng`
}

/**
 * Phần in đậm cuối dòng thứ ba: "x2 +3 SP".
 *
 * `+N SP` là số mặt hàng CÒN LẠI ngoài cái đang hiện tên, không phải
 * tổng số dòng — nên đơn một dòng thì không có phần đuôi.
 */
export function docQtyText(s: DocLineSummary | undefined): string {
  if (!s || !s.name) return ""
  const rest = s.count - 1
  return `x${s.qty}${rest > 0 ? ` +${rest} SP` : ""}`
}

/* ------------------------------------------------------------------ */
/* Điều khoản thanh toán                                                */
/* ------------------------------------------------------------------ */

/**
 * Nhãn NGẮN cho góc phải dòng hai. `PAYMENT_TERMS` viết đủ câu ("COD -
 * Thanh toán khi giao") — đủ cho một ô chọn, quá dài cho một dòng thẻ
 * rộng 120px.
 *
 * ⚠ MÃ LẠ THÌ IN NGUYÊN MÃ, đừng in "—". Mã không có trong bảng nghĩa là
 * dữ liệu có thứ bảng nhãn chưa biết; giấu đi là giấu luôn manh mối.
 */
export function shortTermLabel(terms: string | null | undefined): string {
  if (!terms) return ""
  if (terms === "COD") return "Tiền mặt"
  const m = /^NET(\d+)$/.exec(terms)
  if (m) return `Nợ ${m[1]} ngày`
  return PAYMENT_TERMS.find((t) => t.value === terms)?.label ?? terms
}

/**
 * Trả tiền ngay thì màu chữ trung tính; còn nợ thì màu hổ phách.
 *
 * ⚠ KHÔNG DÙNG ĐỎ. Bán chịu là chuyện bình thường của nhà phân phối, đỏ
 * là dành cho lỗi. Hổ phách nói "còn việc phải làm" — đúng nghĩa.
 */
export function isCreditTerm(terms: string | null | undefined): boolean {
  return !!terms && terms !== "COD"
}

/**
 * KHOẢNG THỜI GIAN THỰC SỰ ĐANG LỌC.
 *
 * ⚠ VIÊN THUỐC KHOẢNG THỜI GIAN CHỈ CÓ Ở ĐIỆN THOẠI. Máy tính có bộ lọc
 *   riêng (Hôm nay / 7 ngày / 30 ngày / Tất cả). Bản trước áp viên thuốc
 *   — mặc định "Tháng này" — cho cả máy tính: danh sách đơn / hóa đơn trên
 *   máy tính bị lọc NGẦM còn tháng này, chọn "Tất cả" vẫn chỉ ra tháng
 *   này, và không có nút nào nói ra. Tìm ra khi làm khối thống kê
 *   (23/09/2026).
 */
export function kyDangLoc(period: ListPeriod, laMayTinh: boolean): ListPeriod {
  return laMayTinh ? "all" : period
}

/**
 * Cộng tổng tiền một danh sách chứng từ ĐÃ TẢI ĐỦ — cho các màn tải hết rồi
 * lọc ở trình duyệt (phiếu nhập, trả NCC, phiếu thu).
 *
 * ⚠ PHIẾU ĐÃ HUỶ KHÔNG VÀO TỔNG — trừ khi người dùng đang xem ĐÚNG tab
 *   "Đã huỷ" (khi ấy "N phiếu · 0đ" là nói sai); nơi gọi quyết qua `daHuy`. Phiếu huỷ là chứng từ không còn hiệu lực;
 *   cộng nó vào "Tổng tiền" ở tab Tất cả là thổi phồng con số. Số phiếu
 *   thì vẫn đếm cả, đúng như danh sách đang hiện.
 * ⚠ Chỉ đúng khi danh sách ĐÃ ĐỦ — nơi gọi phải tải bằng
 *   `fetchAllForAggregate` và truyền `null` khi chạm trần.
 */
export function tongChungTu<T>(
  rows: readonly T[],
  tien: (r: T) => number | string | null | undefined,
  daHuy: (r: T) => boolean,
  /** `false` = danh sách CHƯA ĐỦ (chạm trần / lỗi): số phiếu vẫn đúng số
   *  đang hiện, nhưng tổng tiền là "—" — không phải "0 phiếu". */
  du = true
): { soPhieu: number; tong: number | null } {
  if (!du) return { soPhieu: rows.length, tong: null }
  let tong = 0
  for (const r of rows) if (!daHuy(r)) tong += Number(tien(r)) || 0
  return { soPhieu: rows.length, tong: Math.round(tong) }
}
