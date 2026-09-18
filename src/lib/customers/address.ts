/**
 * GHÉP ĐỊA CHỈ KHÁCH HÀNG ĐỂ IN.
 *
 * Chủ nhà yêu cầu: mẫu in phải có cả PHƯỜNG. Bảng `customers` tách địa
 * chỉ làm bốn cột — `address` (số nhà, đường), `ward`, `district`,
 * `province` — nên tờ in nào chỉ lấy `address` sẽ ra "47 Cẩm" và tài xế
 * không biết đi đâu.
 *
 * ⚠ MỘT CHỖ GHÉP DUY NHẤT. Phiếu giao hàng đã tự ghép bốn cột này từ
 * trước; hóa đơn bán thì chỉ lấy `address`. Hai cách ghép là hai địa chỉ
 * khác nhau cho cùng một khách trên hai tờ giấy đi cùng một chuyến.
 */

export interface CustomerAddressParts {
  address?: string | null
  ward?: string | null
  district?: string | null
  province?: string | null
  billing_address?: string | null
}

/**
 * Địa chỉ đầy đủ: số nhà · phường · quận · tỉnh.
 *
 * ⚠ BỎ PHẦN ĐÃ NẰM SẴN TRONG `address`. Rất nhiều khách nhập tay cả câu
 * "47 Cẩm, Phường Trần Nguyên Hãn" vào ô địa chỉ rồi mới chọn phường ở ô
 * riêng; nối thẳng là in ra một địa chỉ lặp hai lần cùng một cái tên.
 *
 * ⚠ SO KHÔNG DẤU VÀ KHÔNG PHÂN BIỆT HOA THƯỜNG. "Trần Nguyên Hãn" và
 * "tran nguyen han" là một chỗ; bắt trùng đúng từng ký tự là phép chống
 * lặp không bao giờ bắt được gì.
 */
export function fullCustomerAddress(c: CustomerAddressParts): string {
  const base = (c.address ?? "").trim()
  const seen = normalize(base)
  const parts = [base]
  for (const p of [c.ward, c.district, c.province]) {
    const v = (p ?? "").trim()
    if (!v) continue
    if (seen && seen.includes(normalize(v))) continue
    parts.push(v)
  }
  return parts.filter(Boolean).join(", ")
}

/**
 * Địa chỉ in trên HÓA ĐƠN.
 *
 * ⚠ CÓ `billing_address` THÌ DÙNG NGUYÊN VĂN, KHÔNG THÊM GÌ. Đó là địa
 * chỉ xuất hóa đơn do kế toán gõ tay để khớp với đăng ký thuế của khách;
 * tự nối thêm phường vào là sửa một địa chỉ pháp lý, và tờ in lệch với
 * tờ hóa đơn điện tử đã gửi cơ quan thuế.
 */
export function invoiceAddressOf(c: CustomerAddressParts): string {
  const billing = (c.billing_address ?? "").trim()
  if (billing) return billing
  return fullCustomerAddress(c)
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
}
