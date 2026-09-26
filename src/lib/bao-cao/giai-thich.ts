/**
 * Định nghĩa ngắn hiện khi di chuột / chạm vào (i) cạnh tên chỉ số (spec mục 1 — nhãn và chú
 * thích phải nói đúng như luật số liệu).
 */
export const GIAI_THICH = {
  net: "Doanh thu − Hàng trả. Là số chính của mọi màn, khớp với công nợ.",
  rev: "Tổng tiền các hoá đơn đã ghi sổ, theo ngày hoá đơn (giờ VN). Không tính đơn đặt chưa xuất hoá đơn.",
  ret: "Tiền hàng trả (ghi có cho khách), theo ngày trừ doanh số của phiếu trả. Hàng đổi không tính.",
  gp: "Doanh thu thuần − Giá vốn (giá vốn hàng xuất − giá vốn hàng trả đã nhập lại kho). Biên lãi = Lãi gộp / Doanh thu thuần.",
  nInv: "Số hoá đơn đã ghi sổ trong kỳ.",
  cust: "Số khách có ít nhất một hoá đơn trong kỳ.",
  avg: "Doanh thu thuần / Số hoá đơn.",
  order: "Đơn hàng không huỷ, theo ngày đặt. Chỉ là số liệu hoạt động, không phải doanh thu.",
  debt: "Σ (tiền phải thu − đã thu) các khoản chưa tất toán. Có thể âm khi khách dư có.",
  over: "Phần công nợ đã qua ngày hạn.",
  credit: "Tổng tiền khách trả dư, chưa trừ vào hoá đơn nào.",
  limit: "Số khách có công nợ lớn hơn hạn mức đã đặt.",
  stockVal: "Tồn hiện tại × giá vốn. Chỉ người có quyền giá vốn mới thấy.",
  exp: "Số lô còn hàng, hạn sử dụng còn ≤ 30 ngày.",
  low: "Mặt hàng chỉ đủ bán dưới 7 ngày theo tốc độ bán 30 ngày gần nhất.",
  slow: "Mặt hàng 30 ngày không bán, hoặc cần hơn 90 ngày mới bán hết.",
  cashEnd: "Tiền mặt và tiền gửi còn lại cuối ngày, sau mọi khoản thu và phiếu chi.",
} as const
