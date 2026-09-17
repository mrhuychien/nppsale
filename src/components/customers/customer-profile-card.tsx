"use client"

/**
 * Hồ sơ điểm bán — bản ĐỌC, đặt trên đầu tab "Tổng quan".
 *
 * Trước đây mở một điểm bán ra là gặp ngay biểu mẫu SỬA: muốn xem địa
 * chỉ hay hạn mức công nợ thì phải đọc trong ô nhập, và hai thứ KHÔNG hề
 * có mặt ở đâu cả là NGƯỜI TẠO và NGÀY TẠO. Khi cần hỏi "ai nhập điểm
 * bán này", không có chỗ nào trả lời.
 *
 * ⚠ Rồi thẻ này lại nằm trong tab "Sửa thông tin", nên mở điểm bán ra vẫn
 * KHÔNG thấy số điện thoại, địa chỉ hay ai phụ trách — phải bấm sang một
 * tab tên là "Sửa" để ĐỌC. Nay nó đứng đầu tab Tổng quan, đúng chỗ người
 * ta nhìn đầu tiên.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { Customer } from "@/types"

export interface CustomerProfileCardProps {
  customer: Customer
  /** Tên người tạo. `null` = có id nhưng không tra ra (đã nghỉ, bị xoá). */
  creatorName: string | null
  /** Người đang phụ trách, đã xếp người chính lên trước. */
  managerNames: string[]
  /**
   * Nút hành động ở góc thẻ (Sửa thông tin / Sửa phân công).
   *
   * ⚠ Nhận từ ngoài chứ không tự dựng: quyền sửa và cách chuyển tab là
   * việc của trang, còn thẻ này chỉ biết trình bày.
   */
  actions?: React.ReactNode
}

/** Một ô nhãn + giá trị. Giá trị rỗng hiện "—", không hiện ô trống. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty =
    value === null || value === undefined || value === "" || value === "—"
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={empty ? "text-sm text-muted-foreground" : "text-sm font-medium"}>
        {empty ? "—" : value}
      </div>
    </div>
  )
}

const CHANNEL_LABEL: Record<string, string> = {
  GT: "Truyền thống (GT)",
  MT: "Siêu thị (MT)",
  HORECA: "Nhà hàng / Khách sạn",
}

const STATUS_LABEL: Record<string, { text: string; variant: "success" | "warning" | "danger" }> = {
  active: { text: "Đang hoạt động", variant: "success" },
  suspended: { text: "Tạm ngưng", variant: "warning" },
  locked: { text: "Đã khoá", variant: "danger" },
}

export function CustomerProfileCard({
  customer: c,
  creatorName,
  managerNames,
  actions,
}: CustomerProfileCardProps) {
  const diaChi = [c.address, c.ward, c.district, c.province].filter(Boolean).join(", ")
  const st = STATUS_LABEL[c.status] ?? { text: c.status, variant: "warning" as const }

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base font-bold">Hồ sơ điểm bán</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={st.variant}>{st.text}</Badge>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Tên cửa hàng" value={c.store_name} />
        <Field label="Chủ cửa hàng" value={c.owner_name} />
        <Field
          label="Điện thoại"
          value={c.phone ? <a href={`tel:${c.phone}`} className="text-primary">{c.phone}</a> : "—"}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Địa chỉ" value={diaChi} />
        </div>
        <Field label="Kênh bán" value={c.channel ? CHANNEL_LABEL[c.channel] ?? c.channel : "—"} />
        <Field label="Nhóm khách" value={c.group?.name ?? "—"} />
        <Field
          label="Hạn mức công nợ"
          value={c.credit_limit ? formatCurrency(c.credit_limit) : "Không đặt hạn mức"}
        />
        <Field label="Điều khoản thanh toán" value={c.payment_terms} />
        <Field
          label="Toạ độ"
          value={
            c.gps_lat && c.gps_lng ? (
              <a
                href={`https://www.google.com/maps?q=${c.gps_lat},${c.gps_lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary"
              >
                {Number(c.gps_lat).toFixed(5)}, {Number(c.gps_lng).toFixed(5)}
              </a>
            ) : (
              "—"
            )
          }
        />
        <Field label="Mã số thuế" value={c.tax_code ?? "—"} />

        {/* Xuất xứ của bản ghi — phần trước đây không hiện ở đâu cả. */}
        <div className="sm:col-span-2 lg:col-span-3 border-t pt-3 grid gap-4 sm:grid-cols-3">
          <Field
            label="Người tạo"
            value={
              c.created_by
                ? // ⚠ Có id mà không tra ra tên nghĩa là người đó đã nghỉ
                  // hoặc bị xoá. Nói đúng như vậy, đừng hiện "—" như thể
                  // điểm bán này không có ai tạo.
                  creatorName ?? "Nhân viên đã nghỉ"
                : "Không rõ (tạo trước khi hệ thống ghi lại)"
            }
          />
          <Field label="Ngày tạo" value={c.created_at ? formatDate(c.created_at) : "—"} />
          <Field
            label="Đang phụ trách"
            value={
              managerNames.length > 0 ? (
                managerNames.join(", ")
              ) : (
                <span className="font-semibold text-amber-600">Chưa phân công</span>
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}
