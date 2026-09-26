/**
 * BÁO CÁO TỔNG HỢP — 6 màn thay cho 26 màn báo cáo / phân tích (chủ nhà 26/09/2026: "Đồng ý 6
 * màn … Tạm thời dựng Menu mới bên cạnh các báo cáo cũ. Menu Báo cáo tổng hợp").
 * Spec: thietke/bao-cao-tong-hop-spec.md. Trong lúc chờ thiết kế, mỗi màn là một cổng dẫn tới
 * các báo cáo cũ đang trả lời cùng câu hỏi.
 */
export interface ManBaoCao {
  href: string
  label: string
  cauHoi: string
  /** Báo cáo cũ trả lời cùng câu hỏi (dùng tạm). */
  cu: ReadonlyArray<{ href: string; label: string }>
}

export const BAO_CAO_TONG_HOP: readonly ManBaoCao[] = [
  {
    href: "/bao-cao",
    label: "Tổng quan",
    cauHoi: "Hôm nay / tháng này kinh doanh thế nào?",
    cu: [
      { href: "/dashboard", label: "Tổng quan" },
      { href: "/reports", label: "Báo cáo tổng" },
      { href: "/analytics/business/overview", label: "Phân tích kinh doanh" },
    ],
  },
  {
    href: "/bao-cao/ban-hang",
    label: "Bán hàng",
    cauHoi: "Bán được gì, cho ai, ai bán, đơn đặt ra sao?",
    cu: [
      { href: "/reports/sales", label: "Báo cáo bán hàng" },
      { href: "/reports/products", label: "Hàng hóa" },
      { href: "/reports/customers", label: "Khách hàng" },
      { href: "/reports/employees", label: "Nhân viên" },
      { href: "/reports/channels", label: "Kênh bán hàng" },
      { href: "/reports/orders", label: "Đặt hàng" },
      { href: "/analytics/products/overview", label: "Phân tích hàng hóa" },
      { href: "/analytics/customers/overview", label: "Phân tích khách hàng" },
    ],
  },
  {
    href: "/bao-cao/cuoi-ngay",
    label: "Cuối ngày",
    cauHoi: "Hôm nay tiền, hàng, chứng từ có khớp không?",
    cu: [{ href: "/reports/end-of-day", label: "Báo cáo cuối ngày" }],
  },
  {
    href: "/bao-cao/kho",
    label: "Kho",
    cauHoi: "Kho còn gì, trị giá bao nhiêu, hàng nào sắp hết hạn / nằm lâu?",
    cu: [
      { href: "/reports/inventory", label: "Báo cáo tồn kho" },
      { href: "/reports/products", label: "Hàng hóa (giá trị kho, xuất nhập tồn)" },
    ],
  },
  {
    href: "/bao-cao/cong-no",
    label: "Công nợ",
    cauHoi: "Ai đang nợ, nợ bao lâu, nhân viên nào đang giữ nợ?",
    cu: [
      { href: "/receivables/by-customer", label: "Công nợ theo khách" },
      { href: "/receivables/by-rep", label: "Công nợ theo nhân viên" },
      { href: "/analytics/performance/receivables", label: "Phân tích công nợ" },
      { href: "/receivables", label: "Danh sách công nợ" },
    ],
  },
  {
    href: "/bao-cao/tai-chinh",
    label: "Tài chính",
    cauHoi: "Lãi lỗ, dòng tiền, tài sản — nợ phải trả?",
    cu: [{ href: "/reports/finance", label: "Báo cáo tài chính" }],
  },
]
