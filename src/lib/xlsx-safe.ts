/**
 * Đọc file bảng tính do NGƯỜI DÙNG TẢI LÊN một cách an toàn.
 *
 * BỐI CẢNH BẢO MẬT
 * Thư viện `xlsx` (SheetJS) bản trên npm — 0.18.5, bản mới nhất công bố
 * ở đó — dính lỗ hổng Prototype Pollution (GHSA-4r6h-8v6p-xvw6) và ReDoS
 * (CVE-2024-22363). SheetJS đã sửa từ 0.19.3 / 0.20.2 nhưng KHÔNG phát
 * hành lên npm nữa; bản vá chỉ có trên CDN riêng của họ.
 *
 * App này để người dùng tải file Excel lên (nhập khách hàng / sản phẩm /
 * nhà cung cấp), tức là ĐANG phân tích dữ liệu không tin cậy.
 *
 * Mức độ: việc phân tích chạy hoàn toàn PHÍA TRÌNH DUYỆT (dynamic import),
 * nên hậu quả giới hạn trong phiên của chính người mở file — không phải
 * lỗ hổng phía máy chủ, không ảnh hưởng người dùng khác.
 *
 * HAI LỚP XỬ LÝ
 *  1. NÊN LÀM — nâng lên bản đã vá (xem BAN_GIAO.md, mục "Vấn đề đã biết"):
 *       npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
 *  2. LỚP NÀY — chặn đường khai thác ngay cả khi chưa nâng cấp: cô lập
 *     `Object.prototype` trong lúc phân tích rồi khôi phục, nên payload
 *     `__proto__` không bám lại được vào ứng dụng.
 *
 * Mọi nơi đọc file người dùng PHẢI đi qua hàm này, đừng gọi XLSX.read()
 * trực tiếp.
 */

const DANGEROUS = ["__proto__", "constructor", "prototype"]

/** Loại bỏ khoá nguy hiểm khỏi dữ liệu đã phân tích (đệ quy). */
function sanitize<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sanitize) as unknown as T
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS.includes(k)) continue
      out[k] = sanitize(v)
    }
    return out as unknown as T
  }
  return value
}

/**
 * Đọc sheet đầu tiên của file thành mảng-2-chiều (array of arrays),
 * đúng dạng mà các hàm parse hiện có đang nhận.
 */
export async function readSheetAsRows(file: File): Promise<unknown[][]> {
  const XLSX = await import("xlsx")
  const buf = await file.arrayBuffer()

  // Chụp lại các khoá nguy hiểm trên Object.prototype trước khi phân
  // tích; nếu quá trình phân tích cố ghi đè thì khôi phục lại ngay sau.
  const snapshot = DANGEROUS.map((k) => [
    k,
    Object.getOwnPropertyDescriptor(Object.prototype, k),
  ] as const)

  try {
    const wb = XLSX.read(buf, { type: "array" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: "",
    })
    return sanitize(aoa)
  } finally {
    for (const [k, desc] of snapshot) {
      const now = Object.getOwnPropertyDescriptor(Object.prototype, k)
      if (now === desc) continue
      if (desc) Object.defineProperty(Object.prototype, k, desc)
      else delete (Object.prototype as Record<string, unknown>)[k]
    }
  }
}
