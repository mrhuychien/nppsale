"use client"

import { useLuuTrangThai } from "@/hooks/use-luu-trang-thai"
import { useEffect, useState } from "react"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import { tongChungTu } from "@/lib/orders/list-summary"
import { useRouter } from "next/navigation"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Plus, RotateCcw } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { SupplierReturn, Supplier } from "@/types"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_TRA_HANG_NCC } from "@/lib/search/list-filter-fields"
import { bamTrangThai, dangChon, trangThaiCuaChon, tachTrangThai } from "@/lib/list/status-multi"
import {
  PURCHASE_RETURN_COLUMNS,
  DEFAULT_PURCHASE_RETURN_COLUMNS,
  type PurchaseReturnColumnKey,
} from "./list-config"

/** "all" hoặc các trạng thái nối dấu phẩy — chọn nhiều (chủ nhà 25/09/2026). */
type StatusFilter = string
const TRANG_THAI_NCC = ["all", "draft", "completed", "cancelled"] as const

const STATUS_LABEL: Record<string, { label: string; variant: "secondary" | "success" | "warning" }> = {
  draft: { label: "Nháp", variant: "warning" },
  completed: { label: "Đã gửi", variant: "success" },
  cancelled: { label: "Đã huỷ", variant: "secondary" },
}

const ZONE_LABEL: Record<string, string> = {
  sale: "Kho hàng bán",
  date: "Kho hàng date",
}

type Row = Omit<SupplierReturn, "supplier"> & {
  supplier?: Pick<Supplier, "id" | "name" | "code"> | undefined
}

export default function PurchaseReturnsPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  /** Chạm trần / lỗi đọc — tổng không đủ thì nói ra, không in số hụt. */
  const [canhBao, setCanhBao] = useState<string | null>(null)
  /* ⚠ Nhớ qua lần tải lại (chủ nhà 25/09/2026) — `useLuuTrangThai`. */
  const [filterLuu, setFilterLuu] = useLuuTrangThai("purchase-returns", "all")
  const filter = filterLuu as StatusFilter
  const setFilter = (v: StatusFilter) => setFilterLuu(v)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("purchase-returns", LOC_TRA_HANG_NCC)
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs(
    "purchase-returns",
    DEFAULT_PURCHASE_RETURN_COLUMNS,
    [],
    PURCHASE_RETURN_COLUMNS,
    []
  )
  const show = (k: PurchaseReturnColumnKey) => visibleColumns.includes(k)

  useEffect(() => {
    async function fetch() {
      if (!user?.org_id) return
      setLoading(true)
      /* ⚠ ĐỌC ĐỦ. Bản cũ một lệnh đọc không phân trang — PostgREST cắt ngầm
         ở 1.000 dòng, phiếu thứ 1.001 không hiện và tổng hụt theo. */
      const res = await fetchAllForAggregate<Row>((from, to) => {
        // audit-ok: lỗi đi vào `res.error` ngay dưới.
        let q = supabase
          .from("supplier_returns")
          .select("id, return_code, return_date, warehouse_zone, total, status, supplier:suppliers(id, name, code)", { count: "exact" })
          .eq("org_id", user.org_id)
          .order("created_at", { ascending: false })
          .order("id")
        const chon = trangThaiCuaChon(filter)
        if (chon) q = chon.length === 1 ? q.eq("status", chon[0]) : q.in("status", chon)
        for (const f of locNC.menhDe) q = q.or(f)
        return q.range(from, to)
      })
      if (res.error) console.error("[purchase-returns] truy vấn lỗi:", res.error)
      setCanhBao(res.error ? `Không đọc được danh sách phiếu trả NCC — ${res.error}` : res.truncated ? truncationWarning() : null)
      setRows(res.rows)
      setLoading(false)
    }
    fetch()
  }, [user?.org_id, filter, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const tongPhieu = tongChungTu(rows, (r) => r.total, (r) => !tachTrangThai(filter).includes("cancelled") && r.status === "cancelled", !canhBao)

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Trả hàng NCC" description="Hoàn trả hàng cho nhà cung cấp — xuất kho + giảm công nợ" backHref="/purchasing">
        <Button asChild>
          <Link href="/purchase-returns/new">
            <Plus className="h-4 w-4 mr-1.5" /> Tạo phiếu trả
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          {TRANG_THAI_NCC.map((f) => (
            <Button
              key={f}
              variant={dangChon(filter, f) ? "default" : "outline"}
              size="sm"
              aria-pressed={dangChon(filter, f)}
              data-status-chip={f}
              onClick={() => setFilter(bamTrangThai(filter, f, TRANG_THAI_NCC))}
            >
              {f === "all" ? "Tất cả" : STATUS_LABEL[f]?.label || f}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <AdvancedFilter truong={LOC_TRA_HANG_NCC} value={locNC.dieuKien} onApply={locNC.apDung} />
            <ColumnPicker
              available={PURCHASE_RETURN_COLUMNS}
              value={visibleColumns}
              onChange={setColumns}
              onReset={resetColumns}
            />
          </div>
        </CardContent>
      </Card>

      {canhBao && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{canhBao}</p>
      )}
      {!loading && (
        <DocListTotals
          className="rounded-xl border"
          label="Tổng tiền trả NCC"
          countText={`${tongPhieu.soPhieu} phiếu trả${!tachTrangThai(filter).includes("cancelled") && filter !== "draft" && filter !== "completed" ? " · không tính phiếu huỷ" : ""}`}
          total={tongPhieu.tong === null ? null : formatCurrency(tongPhieu.tong)}
        />
      )}
      {loading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<RotateCcw className="h-8 w-8 text-muted-foreground" />}
          title={locNC.soDangAp ? "Không có phiếu nào khớp bộ lọc" : "Chưa có phiếu trả NCC nào"}
          description='Bấm "Tạo phiếu trả" để hoàn trả hàng cho NCC. Khi gửi phiếu hệ thống tự xuất kho và giảm công nợ.'
        />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Mã phiếu</th>
                  {show("date") && <th className="px-3 py-2 text-left">Ngày</th>}
                  {show("supplier") && <th className="px-3 py-2 text-left">NCC</th>}
                  {show("warehouse") && <th className="px-3 py-2 text-left">Kho xuất</th>}
                  {show("total") && <th className="px-3 py-2 text-right">Tổng tiền</th>}
                  {show("status") && <th className="px-3 py-2 text-left">Trạng thái</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = STATUS_LABEL[r.status] || STATUS_LABEL.draft
                  return (
                    <tr
                      key={r.id}
                      className="border-t cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(`/purchase-returns/${r.id}`)}
                    >
                      {/*
                        Mã phiếu chỉ được sinh khi GỬI cho NCC, nên phiếu
                        nháp chưa có mã — đó là thiết kế, không phải lỗi.
                        Nhưng để "—" thì trông y như dữ liệu bị mất; trang
                        chi tiết đã ghi rõ "(chưa sinh — sẽ tạo khi gửi)"
                        còn danh sách thì không.
                      */}
                      <td className="px-3 py-2 font-mono">
                        {r.return_code || (
                          <span className="font-sans text-xs text-muted-foreground">
                            chưa sinh mã
                          </span>
                        )}
                      </td>
                      {show("date") && <td className="px-3 py-2">{formatDate(r.return_date)}</td>}
                      {show("supplier") && <td className="px-3 py-2">{r.supplier?.name || "—"}</td>}
                      {show("warehouse") && <td className="px-3 py-2">{ZONE_LABEL[r.warehouse_zone] || r.warehouse_zone}</td>}
                      {show("total") && (
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {formatCurrency(r.total)}
                        </td>
                      )}
                      {show("status") && (
                        <td className="px-3 py-2">
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
