/**
 * Đổi một lỗi bất kỳ thành câu người dùng đọc được.
 *
 * ⚠ VÌ SAO PHẢI CÓ HÀM NÀY — "CÓ LỖI XẢY RA" LÀ LỖI CỦA CHÍNH CHÚNG TA
 *   Khắp app viết `err instanceof Error ? err.message : "Có lỗi xảy ra"`.
 *   Nhưng lỗi từ Supabase KHÔNG phải `Error`: PostgREST trả về một object
 *   thuần `{ code, message, details, hint }` đọc thẳng từ JSON, và lớp
 *   `PostgrestError` chỉ được dựng khi gọi `.throwOnError()`. Nên mọi chỗ
 *   `throw error` rồi bắt lại đều rơi vào vế `else` — người dùng nhận đúng
 *   bốn chữ "Có lỗi xảy ra", còn nguyên nhân thật thì nằm im trong object
 *   không ai mở ra.
 *
 *   Hậu quả không phải là xấu mặt: nhân viên đứng ở cửa hàng không biết
 *   mình phải sửa gì, và người hỗ trợ cũng không có gì để lần.
 *
 * ⚠ NÓI RA VẤN ĐỀ, KHÔNG NUỐT THÔNG TIN. Hàm này dịch mã lỗi sang câu
 * tiếng Việt NHƯNG vẫn kèm nguyên văn phía sau. Dịch xong vứt bản gốc là
 * đổi một câu khó hiểu lấy một câu dễ hiểu nhưng SAI khi đoán trượt.
 */

interface DbLike {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

/** Mã lỗi Postgres / PostgREST hay gặp. */
const CODE_VI: Record<string, string> = {
  "23505": "Dữ liệu này đã tồn tại",
  "23503": "Dữ liệu liên kết không còn tồn tại",
  "23502": "Thiếu một thông tin bắt buộc",
  "23514": "Dữ liệu không hợp lệ theo ràng buộc của hệ thống",
  "22P02": "Sai định dạng dữ liệu",
  "22003": "Con số vượt quá giới hạn cho phép",
  // RLS từ chối. Đây là mã hay gặp nhất sau khi siết phân quyền.
  "42501": "Bạn không có quyền thực hiện thao tác này",
  "42703": "Cơ sở dữ liệu thiếu cột — nhiều khả năng chưa chạy migration mới",
  "42P01": "Cơ sở dữ liệu thiếu bảng — nhiều khả năng chưa chạy migration mới",
  PGRST204: "Cơ sở dữ liệu thiếu cột — nhiều khả năng chưa chạy migration mới",
  PGRST116: "Không tìm thấy bản ghi",
  PGRST301: "Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.",
}

/**
 * Ràng buộc cụ thể → câu giải thích đúng hoàn cảnh.
 *
 * ⚠ Ca đáng nói nhất: TRÙNG SỐ ĐIỆN THOẠI MÀ KHÔNG NHÌN THẤY. Màn thêm
 * khách có kiểm trùng trước khi ghi, nhưng phép kiểm đó chạy qua RLS —
 * NVBH chỉ thấy khách ĐƯỢC PHÂN CÔNG, nên khách trùng của người khác trả
 * về 0 dòng và phép kiểm nói "không trùng". Đến lúc ghi thì ràng buộc
 * `UNIQUE(org_id, phone)` dưới database mới chặn. Không giải thích thì
 * nhân viên nhìn màn hình thấy danh sách không có ai dùng số đó, mà vẫn
 * không lưu được.
 */
const CONSTRAINT_VI: Array<[RegExp, string]> = [
  [
    /customers?.*phone|phone.*customers?/i,
    "Số điện thoại này đã có khách hàng khác dùng. Nếu tìm trong danh sách không thấy thì khách đó đang do nhân viên khác phụ trách — nhờ quản lý kiểm tra.",
  ],
  [/products?.*sku|sku.*products?/i, "Mã SKU này đã có sản phẩm khác dùng."],
  [/users?.*email|email.*users?/i, "Email này đã có người dùng khác dùng."],
  [/order_code/i, "Mã đơn này đã tồn tại."],
]

/** Câu RLS của Postgres không có mã riêng — nhận bằng nội dung. */
const RLS_RE = /row-level security|violates row-level security policy/i

/**
 * RLS từ chối TRÊN MỘT BẢNG CỤ THỂ — nói được nhiều hơn "bạn không có
 * quyền".
 *
 * ⚠ CHỦ NHÀ ĐỌC ĐÚNG CÂU NÀY 22/09/2026: "Bạn không có quyền thực hiện
 *   thao tác này — new row violates row-level security policy for table
 *   sales_orders (mã 42501)". Câu ấy không sai, nhưng nó không nói được
 *   điều duy nhất người ta cần biết: phải làm gì bây giờ.
 *
 * ⚠ KỂ RA CÁC LÝ DO, ĐỪNG CHỌN HỘ MỘT LÝ DO. Một câu lỗi RLS không cho
 *   biết vế nào của chính sách đã trượt; đoán đại một nguyên nhân rồi
 *   nói chắc nịch là đổi một câu khó hiểu lấy một câu dễ hiểu nhưng
 *   SAI — và người dùng đi sửa nhầm chỗ. Nguyên văn vẫn đi kèm phía
 *   sau như mọi câu khác.
 */
const RLS_BANG_VI: Array<[RegExp, string]> = [
  [
    /table "?sales_orders"?/i,
    "Máy chủ từ chối ghi đơn này. Hai lý do thường gặp: đơn đang đứng tên " +
      "một nhân viên khác (chỉ chủ nhà phân phối hoặc quản lý mới gán được), " +
      "hoặc đơn đã qua bước không cho sửa nữa.",
  ],
  [
    /table "?returns"?/i,
    "Máy chủ từ chối ghi phiếu trả này. Thường là do phiếu đang đứng tên " +
      "một nhân viên khác — chỉ chủ nhà phân phối hoặc quản lý mới gán được.",
  ],
]

/**
 * Tên bảng → tên người dùng gọi. Chỉ để câu lỗi khoá ngoại nói được
 * "đang được PHIẾU TRẢ HÀNG tham chiếu" thay vì "table returns".
 */
const TABLE_VI: Record<string, string> = {
  returns: "phiếu trả hàng",
  receivables: "công nợ",
  invoices: "hoá đơn",
  delivery_lines: "phiếu giao hàng",
  cash_receipt_lines: "phiếu thu",
  visit_logs: "nhật ký viếng thăm",
  driver_handover_items: "bàn giao tài xế",
  driver_handover_failed_orders: "bàn giao tài xế",
  sales_orders: "đơn hàng",
  sales_order_lines: "dòng hàng",
  customers: "khách hàng",
  products: "sản phẩm",
}

/**
 * ⚠ 23503 CÓ HAI CHIỀU, và bản đầu chỉ dịch một chiều.
 *
 *   · GHI/SỬA trỏ vào bản ghi không có: "is not present in table" →
 *     "dữ liệu liên kết không còn tồn tại". Đúng.
 *   · XOÁ bản ghi đang bị bảng khác trỏ vào: "is still referenced from
 *     table" → cũng in ra "dữ liệu liên kết không còn tồn tại". SAI NGƯỢC:
 *     dữ liệu liên kết CÒN ĐÓ mới là vấn đề. Chủ NPP xoá đơn huỷ, đọc câu
 *     đó rồi không hiểu phải làm gì — vì câu đó nói ngược lại sự thật.
 */
function foreignKeyMessage(haystack: string): string | null {
  const still = haystack.match(/still referenced from table "([^"]+)"/i)
  if (still) {
    const t = TABLE_VI[still[1]] ?? still[1]
    return `Bản ghi này đang được ${t} tham chiếu nên chưa xoá được — gỡ hoặc xoá ${t} đó trước, rồi xoá lại.`
  }
  const missing = haystack.match(/is not present in table "([^"]+)"/i)
  if (missing) {
    const t = TABLE_VI[missing[1]] ?? missing[1]
    return `Dữ liệu liên kết không còn tồn tại (${t}).`
  }
  return null
}

function textOf(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Câu tiếng Việt giải thích lỗi, kèm nguyên văn để người hỗ trợ lần được.
 *
 * ⚠ KHÔNG BAO GIỜ trả chuỗi rỗng. Rỗng thì toast hiện một ô trống, tệ hơn
 * cả "Có lỗi xảy ra" vì trông như màn hình vỡ.
 */
export function errorMessage(err: unknown, fallback = "Lỗi không xác định"): string {
  if (err == null) return fallback

  if (typeof err === "string") return err.trim() || fallback

  const e = err as DbLike
  const raw = textOf(e.message) || (err instanceof Error ? err.message : "")
  const code = textOf(e.code)
  const details = textOf(e.details)
  const hint = textOf(e.hint)
  const haystack = `${raw} ${details} ${hint}`

  // Câu giải thích: ràng buộc cụ thể trước, rồi tới mã, rồi tới RLS.
  let vi = ""
  for (const [re, msg] of CONSTRAINT_VI) {
    if (re.test(haystack)) {
      vi = msg
      break
    }
  }
  if (!vi && code === "23503") vi = foreignKeyMessage(haystack) ?? ""
  /**
   * ⚠ CÂU RLS THEO BẢNG ĐỨNG TRƯỚC CÂU THEO MÃ. Mã `42501` đã có câu
   *   dịch chung ("bạn không có quyền"), nên để nó chạy trước là câu
   *   riêng của bảng không bao giờ tới lượt.
   */
  if (!vi && RLS_RE.test(haystack)) {
    for (const [re, msg] of RLS_BANG_VI) {
      if (re.test(haystack)) {
        vi = msg
        break
      }
    }
  }
  if (!vi && code && CODE_VI[code]) vi = CODE_VI[code]
  if (!vi && RLS_RE.test(haystack)) vi = CODE_VI["42501"]

  // ⚠ Nguyên văn luôn đi kèm. Dịch xong vứt bản gốc là đổi một câu khó
  // hiểu lấy một câu dễ hiểu nhưng SAI khi đoán trượt.
  const technical = [raw, details, hint].filter(Boolean).join(" · ")
  const tail = code ? `${technical || fallback} (mã ${code})` : technical

  if (vi) return tail ? `${vi} — ${tail}` : vi
  return tail || fallback
}
