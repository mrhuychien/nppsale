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
  if (!vi && code && CODE_VI[code]) vi = CODE_VI[code]
  if (!vi && RLS_RE.test(haystack)) vi = CODE_VI["42501"]

  // ⚠ Nguyên văn luôn đi kèm. Dịch xong vứt bản gốc là đổi một câu khó
  // hiểu lấy một câu dễ hiểu nhưng SAI khi đoán trượt.
  const technical = [raw, details, hint].filter(Boolean).join(" · ")
  const tail = code ? `${technical || fallback} (mã ${code})` : technical

  if (vi) return tail ? `${vi} — ${tail}` : vi
  return tail || fallback
}
