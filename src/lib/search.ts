/**
 * Tìm kiếm tiếng Việt — bỏ dấu, không phân biệt hoa thường.
 *
 * VÌ SAO CẦN
 * Nhân viên bán hàng đứng trong cửa hàng, gõ một tay trên bàn phím điện
 * thoại, gõ KHÔNG DẤU. Trước đây mọi ô tìm kiếm trong app đều so bằng
 * `a.toLowerCase().includes(q.toLowerCase())`, nên gõ "bach hoa xanh"
 * không ra "Bách Hoá Xanh" — thao tác đầu tiên của mỗi đơn hàng đã tắc.
 *
 * Hai chi tiết dễ bỏ sót:
 *
 *  1. `normalize("NFD")` tách được dấu thanh khỏi nguyên âm (á → a + ́ )
 *     nhưng KHÔNG tách được đ/Đ — chữ đ là một ký tự riêng, không phải
 *     d + dấu. Phải thay tay, nếu không "hang dong" vẫn không ra "hàng đông".
 *
 *  2. Trường số điện thoại từng so bằng `phone.includes(q)` với `q` đã
 *     lowercase còn `phone` thì chưa. Mã như "09DEMO000008" vì thế không
 *     bao giờ khớp. Chuẩn hoá CẢ HAI VẾ mới đúng.
 */

/** Bỏ dấu, hạ chữ thường, gộp khoảng trắng. Dùng cho cả chuỗi tìm lẫn dữ liệu. */
export function viNormalize(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .normalize("NFD")
    // Dải U+0300–U+036F là các dấu thanh đã tách ra sau NFD.
    .replace(/[̀-ͯ]/g, "")
    // đ/Đ không phải d + dấu nên NFD không đụng tới.
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Chuỗi tìm đã chuẩn hoá có xuất hiện trong giá trị không.
 *
 * `needle` PHẢI được chuẩn hoá sẵn bằng `viNormalize` — ký vào chữ ký hàm
 * như vậy để nơi gọi chuẩn hoá một lần rồi lọc cả nghìn dòng, thay vì
 * chuẩn hoá lại chuỗi tìm ở từng dòng.
 */
export function viIncludes(value: unknown, normalizedNeedle: string): boolean {
  if (!normalizedNeedle) return true
  return viNormalize(value).includes(normalizedNeedle)
}

/**
 * Khớp khi BẤT KỲ trường nào chứa chuỗi tìm. Chuỗi tìm rỗng thì khớp tất
 * cả — để `filter` giữ nguyên danh sách khi người dùng chưa gõ gì.
 *
 * Dùng:
 *   const q = viNormalize(search)
 *   customers.filter((c) => viMatch(q, c.store_name, c.phone, c.owner_name))
 */
export function viMatch(normalizedQuery: string, ...values: unknown[]): boolean {
  if (!normalizedQuery) return true
  return values.some((v) => viIncludes(v, normalizedQuery))
}

/**
 * Tách chuỗi tìm thành nhiều từ, mỗi từ phải khớp ở ĐÂU ĐÓ trong bộ
 * trường. Cho phép gõ "xanh q8" ra "Bách Hoá Xanh Q.8" — thứ tự từ không
 * quan trọng, và từ có thể nằm ở các trường khác nhau.
 *
 * Dùng cho ô tìm khách hàng / sản phẩm, nơi người dùng gõ rời rạc.
 */
export function viMatchAllWords(rawQuery: string, ...values: unknown[]): boolean {
  const words = viQueryWords(rawQuery)
  if (!words.length) return true
  return viMatchKey(viSearchKey(...values), words)
}

/**
 * CHỈ MỤC TÌM KIẾM — chuẩn hoá MỘT LẦN, so NHIỀU LẦN.
 *
 * ⚠ VÌ SAO PHẢI TÁCH RA. `viMatchAllWords` chuẩn hoá lại từng trường của
 * từng dòng ở MỖI lần gọi. Màn bán hàng gọi nó cho 1.700 sản phẩm × 3
 * trường ở MỖI PHÍM GÕ: 5.100 lần `normalize("NFD")` + 4 regex + lowercase
 * cho một ký tự người dùng vừa bấm. Trên điện thoại Android tầm trung đó
 * là 15–40 ms mỗi phím — ô tìm kiếm "nuốt" chữ và danh sách nhảy giật.
 *
 * Cách đúng: chuẩn hoá mỗi dòng ĐÚNG MỘT LẦN khi danh mục về
 * (`viSearchKey`), giữ chuỗi đó cạnh dòng, rồi mỗi phím gõ chỉ còn
 * `includes` trên chuỗi có sẵn (`viMatchKey`). Kết quả PHẢI y hệt
 * `viMatchAllWords` — có chốt kiểm thử so hai đường với nhau.
 */

/** Chuỗi tìm đã tách từ, đã chuẩn hoá. Rỗng nghĩa là "khớp tất cả". */
export function viQueryWords(rawQuery: string): string[] {
  return viNormalize(rawQuery).split(" ").filter(Boolean)
}

/** Một chuỗi chuẩn hoá cho cả bộ trường của một dòng — tính một lần. */
export function viSearchKey(...values: unknown[]): string {
  return values.map((v) => viNormalize(v)).join(" ")
}

/** Mọi từ đều xuất hiện trong khoá. `words` rỗng thì khớp. */
export function viMatchKey(key: string, words: string[]): boolean {
  for (let i = 0; i < words.length; i++) {
    if (!key.includes(words[i])) return false
  }
  return true
}
