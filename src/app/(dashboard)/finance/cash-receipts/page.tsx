"use client"

import { useEffect, useState } from "react"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import { tongChungTu } from "@/lib/orders/list-summary"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Receipt, ArrowRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import type { CashReceipt } from "@/types"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_PHIEU_THU } from "@/lib/search/list-filter-fields"

const STATUS_VARIANT: Record<string, "warning" | "success" | "secondary"> = {
  pending: "warning",
  received: "success",
  voided: "secondary",
}
const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  received: "Đã nhận",
  voided: "Đã hủy",
}

export default function CashReceiptsListPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const router = useRouter()
  const { user } = useAuth()
  /**
   * ⚠ ĐÚNG TÊN QUYỀN RPC KIỂM. `create_cash_receipt` hỏi
   * `receivables.create` (migration 120) — gài nút bằng một quyền khác là
   * nút hiện ra rồi RPC ném FORBIDDEN sau khi người dùng nhập xong cả
   * phiếu.
   */
  const canCreate = !!user && hasPermission(user.role, "receivables", "create")
  const supabase = createClient()
  const [receipts, setReceipts] = useState<CashReceipt[]>([])
  const [loading, setLoading] = useState(true)
  /** Chạm trần / lỗi đọc — tổng không đủ thì nói ra, không in số hụt. */
  const [canhBao, setCanhBao] = useState<string | null>(null)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("cash-receipts", LOC_PHIEU_THU)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      /* ⚠ ĐỌC ĐỦ. Bản cũ một lệnh đọc không phân trang — PostgREST cắt ngầm
         ở 1.000 phiếu; phiếu thứ 1.001 không hiện và tổng hụt theo. */
      const res = await fetchAllForAggregate<CashReceipt>((from, to) => {
        // audit-ok: lỗi đi vào `res.error` ngay dưới.
        let q = supabase
          .from("cash_receipts")
          .select(
            "id, receipt_code, receipt_date, status, expected_amount, submitted_amount, received_at, collector:users!cash_receipts_collected_by_fkey(full_name), creator:users!cash_receipts_created_by_fkey(full_name), receiver:users!cash_receipts_received_by_fkey(full_name)",
            { count: "exact" }
          )
          .order("created_at", { ascending: false })
          .order("id")
        for (const f of locNC.menhDe) q = q.or(f)
        return q.range(from, to)
      })
      if (res.error) console.error("[finance/cash-receipts] truy vấn lỗi:", res.error)
      if (!cancelled) {
        setCanhBao(res.error ? `Không đọc được danh sách phiếu thu — ${res.error}` : res.truncated ? truncationWarning() : null)
        setReceipts(res.rows)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Phiếu đã huỷ (`voided`) không vào tổng. */
  const tongPhieu = tongChungTu(receipts, (r) => r.expected_amount, (r) => r.status === "voided", !canhBao)

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      {/* ⚠ CÂU MÔ TẢ CŨ NÓI VỀ LUỒNG CŨ ("tài xế nộp tiền sau quyết toán
          chuyến giao"). Workflow v2 không có bước quyết toán chuyến nào —
          phiếu thu là chứng từ độc lập, kế toán lập thẳng. */}
      <PageHeader
        title="Phiếu thu"
        description="Chứng từ độc lập: thu tiền vào công nợ, cấn trừ được phiếu trả không gắn đơn."
      >
        {canCreate && (
          <Button onClick={() => router.push("/finance/cash-receipts/new")}>
            <Plus className="mr-2 h-4 w-4" /> Lập phiếu thu
          </Button>
        )}
      </PageHeader>

      <div className="flex justify-end">
        <AdvancedFilter truong={LOC_PHIEU_THU} value={locNC.dieuKien} onApply={locNC.apDung} />
      </div>

      {canhBao && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{canhBao}</p>
      )}
      {receipts.length > 0 && (
        <DocListTotals
          className="rounded-xl border"
          label="Tổng tiền phiếu thu"
          countText={`${tongPhieu.soPhieu} phiếu thu · không tính phiếu huỷ`}
          total={tongPhieu.tong === null ? null : formatCurrency(tongPhieu.tong)}
        />
      )}
      {receipts.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-8 w-8 text-muted-foreground" />}
          title={locNC.soDangAp ? "Không có phiếu thu nào khớp bộ lọc" : "Chưa có phiếu thu"}
          description={locNC.soDangAp ? "Sửa hoặc bỏ bớt điều kiện ở Bộ lọc nâng cao." : "Phiếu thu được tự động tạo khi quyết toán chuyến giao."}
        />
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => {
            const diff = Number(r.submitted_amount || 0) - Number(r.expected_amount || 0)
            return (
              <Link
                key={r.id}
                href={`/finance/cash-receipts/${r.id}`}
                className="block"
              >
                <Card className="hover:bg-muted/30 transition-colors">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-mono text-sm font-bold text-primary">
                            {r.receipt_code}
                          </span>
                          <Badge variant={STATUS_VARIANT[r.status] || "secondary"}>
                            {STATUS_LABEL[r.status] || r.status}
                          </Badge>
                          {Math.abs(diff) > 0.5 && r.status === "pending" && (
                            <Badge variant={diff < 0 ? "danger" : "warning"} className="text-[10px]">
                              {diff < 0 ? "Thiếu " : "Dư "}
                              {formatCurrency(Math.abs(diff))}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm">
                          Lái xe:{" "}
                          <span className="font-semibold">
                            {r.collector?.full_name || "-"}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(r.receipt_date)}
                          {r.received_at && r.receiver?.full_name && (
                            <> • Nhận bởi {r.receiver.full_name}</>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Đã nộp
                        </p>
                        <p className="text-lg font-black">
                          {formatCurrency(Number(r.submitted_amount || 0))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          / {formatCurrency(Number(r.expected_amount || 0))}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
