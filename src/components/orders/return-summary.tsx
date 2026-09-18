"use client"

/**
 * HÀNG ĐỔI / TRẢ — khối gọn dùng chung cho hai màn XEM NHANH.
 *
 * Chủ nhà yêu cầu: xem nhanh đơn hàng và xem nhanh hóa đơn bán cũng phải
 * thấy phần hàng đổi / trả, không phải mở hẳn trang chi tiết mới biết.
 *
 * ⚠ VÌ SAO DÙNG CHUNG. Cùng một phiếu trả hiện ở hai chỗ; dựng riêng mỗi
 * bên là ít lâu sau một bên nói "trừ 23.400" còn bên kia nói "trừ 0", và
 * người dùng tin bên nào cũng sai.
 *
 * ⚠ HAI LOẠI DÒNG KHÔNG ĐƯỢC TRỘN. Dòng ĐỔI lấy hàng mới ra khỏi kho và
 * KHÔNG trừ tiền; dòng TRẢ nhận hàng về và CÓ trừ tiền. Hiện chung một
 * danh sách không nhãn là người đọc cộng nhầm công nợ của khách.
 *
 * ⚠ CHỈ PHIẾU ĐÃ HOÀN THÀNH MỚI THẬT SỰ TRỪ. Phiếu nháp / đã gửi thì
 * hàng chưa về kho và công nợ chưa đổi (`_wf2b_recompute_receivable` chỉ
 * cộng phiếu `completed`). Nên số tiền của phiếu chưa hoàn thành phải ghi
 * rõ là "chưa trừ", nếu không kế toán trừ trước một khoản chưa có.
 */

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { returnReasonLabel } from "@/lib/sell/returns"

export interface ReturnSummaryLine {
  id: string
  unit_name: string
  quantity: number
  line_total: number
  is_exchange?: boolean | null
  product?: { name?: string | null; sku?: string | null } | null
}

export interface ReturnSummaryRow {
  id: string
  status: string
  reason: string | null
  credit_note_amount: number | null
  created_at?: string | null
  lines?: ReturnSummaryLine[] | null
}

/** Cột `select` dùng chung — hai màn hỏi y hệt nhau thì mới vẽ giống nhau. */
export const RETURN_SUMMARY_SELECT =
  "id, status, reason, credit_note_amount, created_at, " +
  "lines:return_lines(id, unit_name, quantity, line_total, is_exchange, product:products(name, sku))"

/**
 * Nhãn trạng thái theo BỐN trạng thái của workflow v2
 * (`chk_returns_status_v2`, mig 119). Bảng nhãn cũ bốn trạng thái khác
 * thì phiếu nào cũng rơi xuống chữ tiếng Anh trần giữa màn tiếng Việt.
 */
const STATUS: Record<string, { label: string; variant: "warning" | "success" | "danger" | "secondary" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  submitted: { label: "Chờ xử lý", variant: "warning" },
  completed: { label: "Đã hoàn thành", variant: "success" },
  cancelled: { label: "Đã huỷ", variant: "danger" },
}

export function ReturnSummary({ returns }: { returns: ReturnSummaryRow[] }) {
  if (returns.length === 0) return null
  return (
    <div className="grid gap-2">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
        Hàng đổi / trả ({returns.length})
      </p>
      {returns.map((r) => {
        const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const }
        const lines = r.lines ?? []
        const credit = Math.max(0, Number(r.credit_note_amount || 0))
        const counted = r.status === "completed"
        return (
          <div key={r.id} className="rounded-xl border border-outline-variant/60 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={st.variant}>{st.label}</Badge>
              <span className="text-[12px] font-bold text-on-surface">
                {returnReasonLabel(r.reason ?? "")}
              </span>
              {r.created_at && (
                <span className="text-[11px] text-on-surface-variant">
                  {formatDate(r.created_at)}
                </span>
              )}
              <span className="min-w-[8px] flex-1" />
              {credit > 0 && (
                <span className="text-right text-[13px] font-extrabold tabular-nums text-[#b54708]">
                  −{formatCurrency(credit)}
                  {/* ⚠ NÓI RÕ ĐÃ TRỪ HAY CHƯA. Con số đỏ đứng một mình đọc
                      như đã trừ vào công nợ rồi. */}
                  <span className="block text-[10px] font-semibold text-on-surface-variant">
                    {counted ? "đã trừ công nợ" : "chưa trừ"}
                  </span>
                </span>
              )}
            </div>

            {lines.length > 0 && (
              <div className="mt-2 grid gap-1">
                {lines.map((l) => (
                  <div key={l.id} className="flex items-baseline gap-2 text-[12px]">
                    <span
                      className={
                        l.is_exchange
                          ? "shrink-0 rounded px-1 py-px text-[10px] font-extrabold text-primary ring-1 ring-primary/30"
                          : "shrink-0 rounded px-1 py-px text-[10px] font-extrabold text-[#b54708] ring-1 ring-[#b54708]/30"
                      }
                    >
                      {l.is_exchange ? "ĐỔI" : "TRẢ"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-on-surface">
                      {l.product?.name || (
                        <span className="italic text-on-surface-variant">Sản phẩm đã xoá</span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-on-surface-variant">
                      {l.quantity} {l.unit_name}
                    </span>
                    <span className="w-[86px] shrink-0 text-right tabular-nums font-semibold text-on-surface">
                      {/* Dòng đổi không trừ tiền — ghi thẳng thay vì một số 0
                          mà người đọc tưởng là lỗi. */}
                      {l.is_exchange ? "không trừ" : formatCurrency(Number(l.line_total || 0))}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Link
              href={`/returns/${r.id}`}
              className="mt-1.5 inline-block text-[11px] font-bold text-primary hover:underline"
            >
              Mở phiếu trả →
            </Link>
          </div>
        )
      })}
    </div>
  )
}
