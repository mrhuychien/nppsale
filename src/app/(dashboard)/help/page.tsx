"use client"

import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { ROLE_LABELS } from "@/lib/constants"
import {
  BookOpen,
  Users,
  ShoppingCart,
  Package,
  Boxes,
  Truck,
  CreditCard,
  Tag,
  FileText,
  RotateCcw,
  Award,
  BarChart3,
  Settings,
  HelpCircle,
  Lightbulb,
  AlertCircle,
  ArrowRight,
} from "lucide-react"
import type { Role } from "@/types"

interface RoleGuide {
  title: string
  description: string
  workflow: string[]
  tips: string[]
}

const ROLE_GUIDES: Record<Role, RoleGuide> = {
  owner: {
    title: "Chủ sở hữu",
    description: "Bạn có toàn quyền hệ thống. Tập trung vào duyệt, cài đặt và xem báo cáo tổng quan.",
    workflow: [
      "Mở Dashboard mỗi sáng để xem KPI và cảnh báo quan trọng",
      "Duyệt các đơn hàng giá trị lớn vượt ngưỡng (>50tr)",
      "Xem Báo cáo doanh số cuối tuần / cuối tháng",
      "Cập nhật chính sách hoa hồng khi có thay đổi",
      "Thêm / sửa nhân viên trong Cài đặt → Người dùng",
    ],
    tips: [
      "Đặt ngưỡng phê duyệt phù hợp trong Cài đặt → Tổ chức",
      "Kiểm tra Top khách hàng để duy trì quan hệ với KH lớn",
      "Theo dõi Cảnh báo: HSD, công nợ quá hạn, tồn kho thấp",
    ],
  },
  manager: {
    title: "Quản lý",
    description: "Bạn duyệt đơn, quản lý khách hàng - sản phẩm và chạy chương trình khuyến mãi.",
    workflow: [
      "Mỗi sáng: vào Đơn hàng → lọc trạng thái 'Nháp' để duyệt",
      "Phân công sales mới cho khách hàng (chi tiết KH → Phân công)",
      "Cập nhật bảng giá khi có thay đổi (Sản phẩm → chi tiết → Bảng giá)",
      "Tạo chương trình khuyến mãi mới khi cần",
      "Duyệt yêu cầu trả hàng từ Sales",
    ],
    tips: [
      "Lọc đơn theo NV bán hàng để theo dõi hiệu suất",
      "Phân nhóm khách hàng (VIP / Thường) để áp giá phù hợp",
      "Khi tạo khuyến mãi, đặt 'Ưu tiên' để xếp thứ tự áp dụng",
    ],
  },
  accountant: {
    title: "Kế toán",
    description: "Bạn quản lý công nợ, hóa đơn và theo dõi - cập nhật ví hoa hồng cho nhân viên.",
    workflow: [
      "Đầu ngày: vào Công nợ → tab 'Quá hạn' để nhắc nợ",
      "Xác minh các phiếu thu tiền do Sales / Tài xế nộp",
      "Tạo hóa đơn cho các đơn đã giao xong",
      "Cuối tháng: chốt ví hoa hồng cho từng nhân viên",
      "Xuất báo cáo công nợ tuổi nợ định kỳ",
    ],
    tips: [
      "Dùng báo cáo Aging để biết khoản nào sắp quá hạn",
      "Hóa đơn có thể tạo từ đơn 'Đã giao' (status = delivered)",
      "Khi tạo phiếu thu, chọn đúng phương thức (Tiền mặt/CK/Ví)",
    ],
  },
  sales: {
    title: "Nhân viên bán hàng",
    description: "Bạn tạo đơn hàng cho khách hàng được phân công và theo dõi công nợ của họ.",
    workflow: [
      "Sáng: nhận lịch viếng thăm / danh sách khách hàng",
      "Tại cửa hàng: mở /orders/new → tạo đơn",
      "Chọn KH → thêm SP → kiểm tra giá → Lưu",
      "Theo dõi đơn của mình ở /orders (lọc trạng thái)",
      "Khi giao xong: hỗ trợ thu tiền nếu cần (/receivables/collect)",
    ],
    tips: [
      "Dùng điện thoại thay vì laptop khi đi field",
      "Kiểm tra hạn mức của khách trước khi tạo đơn lớn",
      "Đơn 'Nháp' có thể chỉnh sửa, đơn 'Đã duyệt' thì không",
    ],
  },
  warehouse: {
    title: "Nhân viên kho",
    description: "Bạn quản lý lô hàng, theo dõi tồn kho và xử lý nhập xuất.",
    workflow: [
      "Đầu ca: kiểm tra Tồn kho → cảnh báo HSD và lô sắp hết",
      "Khi nhập hàng: vào /inventory/stocktake → Loại 'Nhập kho'",
      "Khi soạn đơn: cập nhật trạng thái đơn 'Đang lấy'",
      "Cuối ca: kiểm kê thực tế nếu có chênh lệch",
      "Xử lý hàng trả về (status: returns)",
    ],
    tips: [
      "Nhập đầy đủ ngày sản xuất + HSD để hệ thống cảnh báo",
      "FIFO: lô nào nhập trước - xuất trước",
      "Mỗi SKU có thể có nhiều đơn vị (lon/lốc/thùng)",
    ],
  },
  driver: {
    title: "Tài xế",
    description: "Bạn nhận chuyến giao hàng, xác nhận POD và thu tiền tại điểm nếu là COD.",
    workflow: [
      "Sáng: nhận chuyến giao trong /deliveries",
      "Đến từng điểm theo route_name",
      "Giao hàng → cập nhật từng dòng (status: delivered)",
      "Chụp ảnh POD (proof of delivery)",
      "Nếu COD: vào /receivables/collect để ghi nhận thu tiền",
    ],
    tips: [
      "Mở chuyến giao trên điện thoại - không cần laptop",
      "Chụp ảnh POD ngay sau khi giao để tránh quên",
      "Chỉ nhận tiền mặt cho đơn COD đã được kế toán xác nhận",
    ],
  },
}

const MODULE_GUIDES = [
  {
    icon: BarChart3,
    title: "Dashboard",
    desc: "Tổng quan KPI, top khách, hoạt động gần đây, cảnh báo quan trọng.",
    href: "/dashboard",
  },
  {
    icon: ShoppingCart,
    title: "Đơn hàng",
    desc: "Tạo - duyệt - theo dõi đơn. 6 trạng thái: Nháp → Đã duyệt → Đang lấy → Đang giao → Đã giao (hoặc Đã hủy).",
    href: "/orders",
  },
  {
    icon: Users,
    title: "Khách hàng",
    desc: "Cửa hàng / đại lý mua hàng. Phân nhóm (VIP/Thường), kênh (GT/MT/HORECA), hạn mức công nợ.",
    href: "/customers",
  },
  {
    icon: Package,
    title: "Sản phẩm",
    desc: "SKU, đơn vị (lon/lốc/thùng), bảng giá theo nhóm KH, VAT, hạn sử dụng.",
    href: "/products",
  },
  {
    icon: Boxes,
    title: "Kho hàng",
    desc: "Lô hàng, ngày SX, HSD, vị trí, số lượng tồn. Cảnh báo hết hạn 30 ngày.",
    href: "/inventory",
  },
  {
    icon: Truck,
    title: "Giao hàng",
    desc: "Tạo phiếu giao - gán tài xế - theo dõi POD - xác nhận từng đơn trong chuyến.",
    href: "/deliveries",
  },
  {
    icon: CreditCard,
    title: "Công nợ",
    desc: "Phải thu (receivables) tự sinh khi giao đơn. Báo cáo tuổi nợ + thu tiền + xác minh.",
    href: "/receivables",
  },
  {
    icon: Tag,
    title: "Khuyến mãi",
    desc: "Chiết khấu thương mại, mua X tặng Y, chiết khấu thanh toán, tích lũy, trưng bày.",
    href: "/promotions",
  },
  {
    icon: FileText,
    title: "Hóa đơn",
    desc: "Xuất hóa đơn VAT từ đơn đã giao. Số HĐ tự sinh INV-YYYYMMDD-XXXX.",
    href: "/invoices",
  },
  {
    icon: RotateCcw,
    title: "Trả hàng",
    desc: "Sales tạo yêu cầu trả → Quản lý duyệt → Kho nhập lại → Kế toán xử lý credit note.",
    href: "/returns",
  },
  {
    icon: Award,
    title: "Hoa hồng",
    desc: "Chính sách (% / Cố định / Bậc thang). Ví hoa hồng theo kỳ. Owner xem tất cả, Sales xem ví của mình.",
    href: "/commissions",
  },
  {
    icon: Settings,
    title: "Cài đặt",
    desc: "Quản lý người dùng (chỉ Owner) và thông tin tổ chức.",
    href: "/settings",
  },
]

const FAQS = [
  {
    q: "Tôi quên mật khẩu phải làm sao?",
    a: "Liên hệ Chủ sở hữu để được cấp lại. Tính năng tự khôi phục đang phát triển.",
  },
  {
    q: "Tại sao tôi không thấy menu nào đó?",
    a: "Bạn không có quyền với module đó. Mỗi vai trò chỉ thấy menu phù hợp với công việc.",
  },
  {
    q: "Đơn đã duyệt có sửa được không?",
    a: "Không. Để thay đổi, hãy tạo phiếu Trả hàng và tạo đơn mới.",
  },
  {
    q: "Sales chỉ thấy 1 số khách hàng - tại sao?",
    a: "Sales chỉ thấy khách hàng được Quản lý phân công. Xem chi tiết KH → tab Phân công.",
  },
  {
    q: "Hệ thống có cảnh báo hết hạn không?",
    a: "Có. Dashboard và Kho đều hiển thị lô hàng còn dưới 30 ngày.",
  },
  {
    q: "Có chạy được trên điện thoại không?",
    a: "Có. Toàn bộ giao diện responsive. Sales và Tài xế thường dùng điện thoại tại field.",
  },
]

export default function HelpPage() {
  const { user, loading } = useAuth()

  if (loading) return null

  const role = user?.role
  const guide = role ? ROLE_GUIDES[role] : null

  return (
    <div className="space-y-8">
      <PageHeader
        title="Trợ giúp & Hướng dẫn"
        description="Cẩm nang sử dụng npp.sale theo vai trò của bạn"
      />

      {/* Role-specific guide */}
      {guide && (
        <div className="bg-card rounded-2xl shadow-ambient p-6 lg:p-8 border-l-4 border-primary">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center text-white shrink-0">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
                Vai trò của bạn
              </p>
              <h2 className="text-2xl font-black text-foreground">
                {guide.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {guide.description}
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <ArrowRight className="h-4 w-4" />
                Luồng công việc hàng ngày
              </h3>
              <ol className="space-y-2 text-sm">
                {guide.workflow.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-black">
                      {i + 1}
                    </span>
                    <span className="text-foreground leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Lightbulb className="h-4 w-4" />
                Mẹo & Best practices
              </h3>
              <ul className="space-y-2 text-sm">
                {guide.tips.map((tip, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary shrink-0">•</span>
                    <span className="text-muted-foreground leading-relaxed">{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Module guide */}
      <div>
        <h2 className="text-xl font-bold text-foreground mb-4">
          12 module trong hệ thống
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULE_GUIDES.map((m) => {
            const Icon = m.icon
            return (
              <Link
                key={m.href}
                href={m.href}
                className="bg-card rounded-2xl shadow-ambient p-5 hover:shadow-ambient-md transition-all group"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-primary/10 text-primary rounded-lg flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-foreground">{m.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {m.desc}
                </p>
              </Link>
            )
          })}
        </div>
      </div>

      {/* FAQ */}
      <div>
        <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-primary" />
          Câu hỏi thường gặp
        </h2>
        <div className="bg-card rounded-2xl shadow-ambient divide-y divide-border/40">
          {FAQS.map((faq, i) => (
            <details key={i} className="p-5 group">
              <summary className="font-semibold text-sm text-foreground cursor-pointer list-none flex items-center justify-between">
                <span>{faq.q}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-open:rotate-90 transition-transform" />
              </summary>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>

      {/* Footer info */}
      <div className="bg-surface-low rounded-2xl p-6 text-sm">
        <h3 className="font-bold mb-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" />
          Cần hỗ trợ thêm?
        </h3>
        <ul className="space-y-2 text-muted-foreground">
          <li>
            • Tài liệu đầy đủ trên GitHub:{" "}
            <code className="text-xs bg-card px-2 py-0.5 rounded">HUONG_DAN.md</code>
          </li>
          <li>
            • Trang debug kết nối:{" "}
            <Link href="/debug" className="text-primary font-semibold underline">
              /debug
            </Link>
          </li>
          <li>
            • Liên hệ Chủ sở hữu khi gặp lỗi liên quan đến tài khoản hoặc quyền
          </li>
        </ul>
        {user && (
          <div className="mt-4 pt-4 border-t border-border/40 text-xs text-muted-foreground">
            Đăng nhập với:{" "}
            <span className="font-semibold text-foreground">{user.full_name}</span>{" "}
            ({role && ROLE_LABELS[role]})
          </div>
        )}
      </div>
    </div>
  )
}
