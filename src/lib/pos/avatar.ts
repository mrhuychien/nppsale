/**
 * CHỮ CÁI ĐẦU CHO VÒNG TRÒN ĐẠI DIỆN — bản vẽ 22/09/2026 vẽ nó ở modal
 * chọn khách và ở ô gán nhân viên.
 *
 * ⚠ VÒNG TRÒN NÀY ĐỂ PHÂN BIỆT, KHÔNG ĐỂ TRANG TRÍ. Lấy bừa chữ đầu
 *   tiên của tên cửa hàng là ở một nhà phân phối thật, quá nửa danh sách
 *   hiện chữ "T" (Tạp hoá…) hoặc "C" (Cửa hàng…) — nghĩa là vòng tròn
 *   không phân biệt được gì, và nó chỉ còn là chỗ chiếm diện tích.
 *   Nên phải BỎ TIỀN TỐ LOẠI HÌNH đi rồi mới lấy chữ.
 *
 * ⚠ HAI QUY TẮC KHÁC NHAU CHO HAI LOẠI TÊN, và đó là cố ý:
 *     · cửa hàng — MỘT chữ, sau khi bỏ tiền tố ("Tạp hoá Bà Năm" → B).
 *     · người    — HAI chữ, đầu họ + đầu tên ("Nguyễn Thị Thương" → NT),
 *       đúng lối viết tắt tên người Việt. Lấy hai từ ĐẦU sẽ ra "NT" cho
 *       cả "Nguyễn Thị Thương" lẫn "Nguyễn Thị Thu" — hai người khác
 *       nhau một vòng tròn.
 */

import { viNormalize } from "@/lib/search"

/**
 * Tiền tố loại hình cửa hàng, viết không dấu vì so sau khi chuẩn hoá.
 *
 * ⚠ SẮP TỪ DÀI TỚI NGẮN. "cua hang" phải được thử trước "ch", nếu không
 *   "Cửa hàng Tuấn" cắt nhầm ở "ch" và còn lại "ua hang tuan".
 *
 * ⚠ CHỈ TIỀN TỐ LOẠI HÌNH, KHÔNG TÊN THƯƠNG HIỆU. Từng có "bach hoa
 *   xanh" và "sieu thi mini" trong danh sách này; chúng cắt luôn phần
 *   TÊN: "Bách Hoá Xanh Q.8" còn "Q.8" (→ chữ Q), "Siêu thị Mini Hạnh"
 *   còn "Hạnh". Cắt quá tay còn tệ hơn không cắt, vì chữ còn lại chẳng
 *   liên quan gì tới cái tên người ta đọc.
 */
const TIEN_TO = [
  "cong ty tnhh",
  "cua hang tap hoa",
  "cua hang",
  "dai ly",
  "sieu thi",
  "bach hoa",
  "tap hoa",
  "nha thuoc",
  "cong ty",
  "cty",
  "quan",
  "shop",
  "ch",
]

/**
 * Bỏ tiền tố loại hình, trả về phần tên thật.
 *
 * ⚠ BỎ HẾT THÌ TRẢ LẠI NGUYÊN TÊN. Một khách tên đúng bằng "Tạp hoá"
 *   mà cắt sạch là còn chuỗi rỗng, và vòng tròn thành một ô trống —
 *   tệ hơn một chữ "T".
 */
export function boTienToCuaHang(ten: string): string {
  const raw = (ten || "").trim()
  const chuan = viNormalize(raw)
  for (const t of TIEN_TO) {
    /* ⚠ ĐÒI CÓ KHOẢNG TRẮNG SAU TIỀN TỐ, và đó cũng là cách một khách
       tên đúng bằng "Tạp hoá" thoát được: không khớp vế nào, rơi xuống
       cuối và trả lại nguyên tên. Bỏ khoảng trắng đi là tên ấy bị cắt
       sạch thành chuỗi rỗng. */
    if (chuan.startsWith(t + " ")) {
      /* Cắt theo SỐ TỪ, không cắt theo số ký tự: chuỗi chuẩn hoá và
         chuỗi gốc lệch độ dài vì dấu tiếng Việt. */
      const soTu = t.split(" ").length
      const con = raw.trim().split(/\s+/).slice(soTu).join(" ")
      return con || raw
    }
  }
  return raw
}

/**
 * Chữ cái cho vòng tròn đại diện.
 *
 * `kieu === "nguoi"` cho hai chữ (đầu họ + đầu tên), còn lại một chữ.
 * Tên rỗng trả về `"?"` chứ không trả chuỗi rỗng — một vòng tròn trống
 * đọc ra là "đang tải", không phải "không có tên".
 */
export function chuCaiDau(ten: string, kieu: "nguoi" | "cuaHang" = "cuaHang"): string {
  const nguon = kieu === "nguoi" ? (ten || "").trim() : boTienToCuaHang(ten)
  const tu = nguon.split(/\s+/).filter(Boolean)
  if (tu.length === 0) return "?"
  if (kieu === "nguoi" && tu.length > 1) {
    return (tu[0][0] + tu[tu.length - 1][0]).toUpperCase()
  }
  return tu[0][0].toUpperCase()
}
