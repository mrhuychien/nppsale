/**
 * DANH SÁCH KHÁCH — phần tính toán thuần, tách khỏi màn hình.
 *
 * Mẫu chủ nhà gửi (bản điện thoại) đổi danh sách khách từ "thẻ nhiều nút"
 * sang "dòng gọn xếp nhóm": mỗi khách một dòng cao ~56px gồm vạch màu,
 * chữ cái đầu, tên, dòng phụ, và bên phải là CÔNG NỢ + LẦN ĐẶT GẦN NHẤT.
 * Hành động (Gọi, Tạo đơn, Ghé thăm) chuyển hết vào màn chi tiết.
 *
 * ⚠ VÌ SAO TÁCH RA ĐÂY. Bốn cái nhãn dưới đây ("Nợ 12 tr", "Đặt hôm nay",
 * chữ cái đầu, nhóm) là thứ người dùng đọc để RA QUYẾT ĐỊNH ghé ai trước.
 * Nằm rải trong JSX thì không ai chốt được bằng test, và mỗi lần sửa giao
 * diện là một lần chúng lặng lẽ đổi nghĩa.
 */

import { VN_TZ } from "@/lib/utils"

/**
 * Tiền rút gọn: "12 tr", "450k", "0".
 *
 * ⚠ CHỈ DÙNG Ở DANH SÁCH. Dòng khách rộng chưa tới 120px cho cột phải;
 * in đủ "12.400.000đ" là tràn hoặc phải thu chữ xuống mức không đọc nổi
 * ngoài nắng. Mọi chỗ cần CON SỐ ĐÚNG ĐỂ ĐỐI CHIẾU (chi tiết khách, phiếu
 * thu, bản in) vẫn phải dùng `formatCurrency` — rút gọn là làm tròn, và
 * làm tròn tiền ở chỗ đối chiếu là sai.
 */
export function shortMoney(amount: number): string {
  const n = Math.round(Number(amount) || 0)
  if (n < 0) return "-" + shortMoney(-n)
  if (n >= 1_000_000) {
    // Từ 10 triệu trở lên bỏ hẳn phần lẻ: "24 tr" đọc nhanh hơn "24,3 tr",
    // và ở mức đó một phần mười triệu không đổi quyết định ghé ai trước.
    const t = (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)
    return t.replace(/\.0$/, "").replace(".", ",") + " tr"
  }
  if (n >= 1_000) return Math.round(n / 1_000) + "k"
  return String(n)
}

/**
 * Chữ cái đầu cho ô tròn — bỏ phần mô tả loại hình ở đầu tên.
 *
 * ⚠ "Tạp hoá Bà Năm" mà lấy chữ "T" thì cả tuyến toàn chữ T, ô tròn vô
 * dụng. Người bán gọi cửa hàng này là "Bà Năm", nên lấy "B".
 */
const NAME_PREFIX =
  /^(tạp hoá|tạp hóa|siêu thị|cửa hàng|của hàng|nhà thuốc|quán|chị|cô|anh|em|bà|ông|chú|bác)\s+/i

/**
 * Dấu THANH (huyền, sắc, hỏi, ngã, nặng) sau khi tách NFD.
 *
 * ⚠ CHỈ BỎ DẤU THANH, GIỮ DẤU CHỮ. Bảng chữ cái tiếng Việt có ă, â, đ,
 * ê, ô, ơ, ư là những CHỮ RIÊNG — "Ân Bảo" không đứng chung nhóm với
 * "An Bình". Nhưng huyền/sắc/hỏi/ngã/nặng chỉ là thanh điệu: "Án" và
 * "An" là cùng một chữ A, tách ra thành hai nhóm là danh bạ vỡ vụn.
 * `viNormalize` bỏ SẠCH mọi dấu nên không dùng được ở đây.
 */
const TONE_MARKS = /[̣̀́̃̉]/g

export function customerInitial(storeName: string | null | undefined): string {
  const name = (storeName || "").trim()
  if (!name) return "?"
  const core = name.replace(NAME_PREFIX, "").trim() || name
  return core
    .charAt(0)
    .normalize("NFD")
    .replace(TONE_MARKS, "")
    .normalize("NFC")
    .toLocaleUpperCase("vi-VN")
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function todayVN(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: VN_TZ })
}

/**
 * Số ngày từ `date` đến hôm nay (giờ Việt Nam). Ngày tương lai trả 0.
 *
 * ⚠ CÙNG PHÉP TRỪ VỚI `daysOverdueOf`. Đây là bản thứ hai của phép so
 * ngày, nhưng khác NGHĨA (khoảng cách từ lần đặt gần nhất, không phải
 * tuổi nợ), nên để riêng và cùng ghim giờ Việt Nam — lệch múi giờ ở đây
 * là "Đặt hôm nay" hiện thành "1 ngày trước" suốt bảy tiếng đầu ngày.
 */
export function daysSinceVN(date: string | null | undefined): number {
  if (!date) return 0
  const [ty, tm, td] = todayVN().split("-").map(Number)
  const [y, m, d] = date.slice(0, 10).split("-").map(Number)
  if (!y || !ty) return 0
  const diff =
    (Date.UTC(ty, tm - 1, td) - Date.UTC(y, (m || 1) - 1, d || 1)) / 86_400_000
  return Math.max(0, Math.round(diff))
}

/** Cột phải, dòng trên: công nợ. */
export function debtText(debt: number): string {
  return debt > 0 ? `Nợ ${shortMoney(debt)}` : "Không nợ"
}

/**
 * Cột phải, dòng dưới: lần đặt gần nhất.
 *
 * ⚠ `null` LÀ "CHƯA TỪNG ĐẶT", KHÔNG PHẢI "0 ngày". Gộp hai cái vào một
 * chữ là khách mới toanh trông y hệt khách vừa đặt sáng nay.
 */
export function lastOrderText(lastOrderDate: string | null | undefined): string {
  if (!lastOrderDate) return "Chưa đặt đơn"
  const days = daysSinceVN(lastOrderDate)
  if (days === 0) return "Đặt hôm nay"
  if (days === 1) return "Hôm qua"
  return `${days} ngày trước`
}

/** Bộ lọc nhanh trên đầu danh sách. */
export type QuickFilter = "today" | "overdue" | "cold" | "all"

/** Số ngày không đặt hàng thì coi là "ngủ đông". */
export const COLD_DAYS = 30

export const QUICK_FILTER_LABEL: Record<QuickFilter, string> = {
  today: "Cần ghé hôm nay",
  overdue: "Nợ quá hạn",
  cold: `Chưa đặt ${COLD_DAYS} ngày`,
  all: "Tất cả",
}

/** Nhãn nhóm khi danh sách không gộp theo chữ cái. */
export const QUICK_FILTER_GROUP: Record<QuickFilter, string> = {
  today: "Tuyến hôm nay",
  overdue: "Nợ quá hạn",
  cold: `Chưa đặt ${COLD_DAYS} ngày`,
  all: "Kết quả",
}

export interface GroupedRow {
  id: string
  store_name: string
}

export interface CustomerGroup<T extends GroupedRow> {
  label: string
  items: T[]
}

/**
 * Gộp theo chữ cái đầu — chỉ dùng cho "Tất cả" khi KHÔNG tìm kiếm.
 *
 * ⚠ SẮP THEO `localeCompare(..., "vi")`. Bảng mã thô xếp "Đ" sau "Z";
 * người Việt tìm "Đồng Nhất" ở ngay sau "D".
 */
export function groupByInitial<T extends GroupedRow>(rows: T[]): CustomerGroup<T>[] {
  const by = new Map<string, T[]>()
  for (const r of rows) {
    const k = customerInitial(r.store_name)
    const arr = by.get(k)
    if (arr) arr.push(r)
    else by.set(k, [r])
  }
  return Array.from(by.keys())
    .sort((a, b) => a.localeCompare(b, "vi"))
    .map((label) => ({ label, items: by.get(label) as T[] }))
}

/**
 * Vạch màu bên trái mỗi dòng — thứ tự ưu tiên là CÓ CHỦ Ý.
 *
 * ⚠ NỢ QUÁ HẠN THẮNG TUYẾN HÔM NAY. Một điểm vừa nằm trong tuyến vừa nợ
 * quá hạn thì việc cần nhớ là đòi tiền, không phải là ghé. Đảo thứ tự
 * hai nhánh này là vạch đỏ biến mất đúng ở những dòng cần nó nhất.
 */
export type RowAccent = "visited" | "overdue" | "today" | "cold" | "none"

export function rowAccent(opts: {
  visitedToday: boolean
  routeMode: boolean
  overdue: boolean
  onTodayRoute: boolean
  coldDays: number | null
}): RowAccent {
  if (opts.routeMode && opts.visitedToday) return "visited"
  if (opts.overdue) return "overdue"
  if (opts.onTodayRoute) return "today"
  if (opts.coldDays !== null && opts.coldDays >= COLD_DAYS) return "cold"
  return "none"
}
