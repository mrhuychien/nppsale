"use client"

/**
 * ĐỀ XUẤT ĐẶT HÀNG — cần đặt những mặt hàng gì, của NCC nào.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "So sánh giữa số lượng trên đơn hàng và
 * Tồn kho xem cần đặt những mặt hàng gì. Theo tổng, theo NCC."
 *
 * ⚠ MÀN NÀY CHỈ ĐỌC. Nó không lập phiếu, không đụng kho, không đụng
 * công nợ — nó trả lời một câu hỏi rồi đưa người dùng sang màn lập
 * phiếu nhập hàng. Cho nó quyền ghi là thêm một đường thứ hai vào kho
 * mà không ai canh.
 *
 * ⚠ PHÉP TÍNH NẰM Ở `@/lib/purchasing/reorder`, không nằm ở đây. Nó là
 * thứ duy nhất trên màn này có thể SAI trong im lặng, nên nó phải chốt
 * được mà không cần dựng giao diện.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusChips, type StatusChip } from "@/components/ui/status-chips"
import { formatInt } from "@/lib/utils"
import { viIncludes, viNormalize } from "@/lib/search"
import { AlertCircle, PackageSearch, Search, ShoppingCart } from "lucide-react"
import {
  buildReorder, groupBySupplier, REORDER_ORDER_STATUSES, NO_SUPPLIER_LABEL,
  type DemandLine, type ReorderRow, type StockByProduct,
} from "@/lib/purchasing/reorder"

interface ProdRow {
  id: string
  name: string
  sku: string | null
  base_unit: string
  primary_supplier_id: string | null
}

export default function ReorderPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const supabase = createClient()

  const [rows, setRows] = useState<ReorderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)
  const [search, setSearch] = useState("")
  /** "" = xem tổng; ngược lại là mã NCC (hoặc "none" cho nhóm chưa gán). */
  const [supplierKey, setSupplierKey] = useState("")

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)

    /**
     * ⚠ BỐN CÂU ĐỌC, CẢ BỐN QUA `fetchAllForAggregate`. PostgREST cắt ở
     *   1.000 dòng — cắt ở đây là đề xuất đặt hàng THIẾU, và một bảng
     *   thiếu trông y hệt một bảng đủ.
     *
     * ⚠ KỂ CẢ CÂU ĐỌC DANH MỤC, và đây là lỗi CÓ THẬT đã lọt ra màn
     *   hình (chủ nhà báo 21/09/2026: "Sao đề xuất đặt hàng lại ra toàn
     *   Sản phẩm đã xóa là sao?"). Bản đầu đọc `products` bằng một
     *   `.select()` trơn, nên với danh mục 1.700 mã thì 700 mã cuối
     *   KHÔNG có trong bộ nhớ — và mọi dòng đơn trỏ tới chúng bị gán
     *   nhãn "Sản phẩm đã xoá". Bảng đề xuất vẫn đủ số lượng, chỉ là
     *   không còn tên hàng, mã SKU, đơn vị hay NCC nào để mà đặt.
     *
     * ⚠ PHÂN TRANG THEO `id`, KHÔNG THEO `name`. Mốc chia trang phải
     *   DUY NHẤT; hai mặt hàng trùng tên là các trang lặp/sót nhau.
     */
    const [lineRes, batchRes, prodRes, supRes] = await Promise.all([
      fetchAllForAggregate<DemandLine & { order?: { status: string } | null }>((from, to) =>
        supabase
          .from("sales_order_lines")
          .select(
            "product_id, quantity, invoiced_qty, conversion_factor, order:sales_orders!inner(status)",
            { count: "exact" }
          )
          .in("order.status", REORDER_ORDER_STATUSES as unknown as string[])
          .order("id")
          .range(from, to)
      ),
      fetchAllForAggregate<{ product_id: string; qty_on_hand: number | null }>((from, to) =>
        supabase
          .from("batches")
          .select("product_id, qty_on_hand", { count: "exact" })
          .eq("status", "available")
          .order("id")
          .range(from, to)
      ),
      fetchAllForAggregate<ProdRow>((from, to) =>
        supabase
          .from("products")
          .select("id, name, sku, base_unit, primary_supplier_id", { count: "exact" })
          .eq("org_id", user.org_id)
          .order("id")
          .range(from, to)
      ),
      fetchAllForAggregate<{ id: string; name: string }>((from, to) =>
        supabase
          .from("suppliers")
          .select("id, name", { count: "exact" })
          .eq("org_id", user.org_id)
          .order("id")
          .range(from, to)
      ),
    ])

    const stock: StockByProduct = {}
    for (const b of batchRes.rows) {
      stock[b.product_id] = (stock[b.product_id] ?? 0) + Number(b.qty_on_hand ?? 0)
    }
    const supplierNames: Record<string, string> = {}
    for (const s of supRes.rows) {
      supplierNames[s.id] = s.name
    }

    setRows(
      buildReorder(lineRes.rows, stock, prodRes.rows, supplierNames)
    )
    /**
     * ⚠ ĐỌC BỊ CẮT THÌ NÓI RA. Một bảng đề xuất thiếu trông y hệt một
     *   bảng đề xuất đủ — người mua hàng đặt theo nó rồi hết hàng, và
     *   không ai biết vì sao.
     */
    setTruncated(
      lineRes.truncated || batchRes.truncated || prodRes.truncated || supRes.truncated
    )
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupBySupplier(rows), [rows])

  const chips: StatusChip[] = useMemo(
    () => [
      { key: "", label: "Tất cả NCC", count: rows.length, accent: "#98a2b3" },
      ...groups.map((g) => ({
        key: g.supplier_id ?? "none",
        label: g.supplier_name,
        count: g.rows.length,
        accent: g.supplier_id ? "#2563eb" : "#f79009",
      })),
    ],
    [rows, groups]
  )

  const shown = useMemo(() => {
    let list = rows
    if (supplierKey !== "") {
      list = list.filter((r) => (r.supplier_id ?? "none") === supplierKey)
    }
    if (search.trim()) {
      const q = viNormalize(search)
      list = list.filter((r) => viIncludes(r.product_name, q) || viIncludes(r.sku, q))
    }
    return list
  }, [rows, supplierKey, search])

  const totalNeed = useMemo(() => shown.reduce((s, r) => s + r.need, 0), [shown])

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Đề xuất đặt hàng"
        description="So đơn hàng đang treo với tồn kho — cần đặt gì, của NCC nào"
        backHref="/purchasing"
      >
        <Button asChild>
          <Link href="/purchasing/receipts/new">
            <ShoppingCart className="mr-2 h-4 w-4" /> Lập phiếu nhập hàng
          </Link>
        </Button>
      </PageHeader>

      {/*
        ⚠ NÓI RÕ PHÉP TÍNH NGAY TRÊN MÀN. Người mua hàng đặt tiền thật
          theo mấy con số này; không nói ra công thức thì mỗi người hiểu
          một kiểu, và không ai đối chiếu được khi thấy lạ.
      */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>Cần đặt = Còn phải giao − Tồn khả dụng.</b> Chỉ tính đơn đã gửi và đơn
          đang giao dở; đơn nháp và đơn đã huỷ không tính. Số lượng quy về đơn vị cơ
          sở. Mặt hàng đủ tồn không hiện ở đây.
        </span>
      </div>

      {truncated && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-[#7a4b00]">
          <b>Chưa đọc hết dữ liệu</b> — bảng dưới đang THIẾU. Đừng đặt hàng theo nó;
          tải lại trang, nếu vẫn vậy thì báo lại.
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-8 w-8 text-muted-foreground" />}
          title="Không có mặt hàng nào cần đặt"
          description="Mọi đơn đang treo đều đủ tồn để giao."
        />
      ) : (
        <>
          <StatusChips chips={chips} active={supplierKey} onPick={setSupplierKey} />

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm theo tên hàng hoặc mã SKU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="ml-auto text-sm text-muted-foreground">
              {shown.length} mặt hàng · cần đặt{" "}
              <b className="tabular-nums text-foreground">{formatInt(totalNeed)}</b> đơn vị
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {supplierKey === ""
                  ? "Tất cả nhà cung cấp"
                  : chips.find((c) => c.key === supplierKey)?.label ?? NO_SUPPLIER_LABEL}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:px-6 sm:pb-6">
              {shown.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Không có mặt hàng nào khớp bộ lọc.
                </p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="w-10 px-2 py-2 text-left">STT</th>
                          <th className="w-28 px-2 py-2 text-left">Mã hàng</th>
                          <th className="px-2 py-2 text-left">Tên hàng</th>
                          <th className="px-2 py-2 text-left">Nhà cung cấp</th>
                          <th className="w-20 px-2 py-2 text-left">ĐVT</th>
                          <th className="w-32 px-2 py-2 text-right">Còn phải giao</th>
                          <th className="w-28 px-2 py-2 text-right">Tồn</th>
                          <th className="w-28 px-2 py-2 text-right">Cần đặt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r, i) => (
                          <tr key={r.product_id} className="border-t">
                            <td className="px-2 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                            <td className="px-2 py-2 font-mono text-xs">{r.sku || "—"}</td>
                            <td className="px-2 py-2">
                              <Link
                                href={`/inventory/stock-card/${r.product_id}`}
                                className="font-medium hover:text-primary hover:underline"
                              >
                                {r.product_name}
                              </Link>
                            </td>
                            {/* ⚠ CHƯA GÁN NCC THÌ NÓI LÀ CHƯA GÁN, đừng để trống. */}
                            <td className="px-2 py-2 text-muted-foreground">
                              {r.supplier_name ?? NO_SUPPLIER_LABEL}
                            </td>
                            <td className="px-2 py-2 text-muted-foreground">{r.base_unit}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatInt(r.demand)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatInt(r.onHand)}</td>
                            <td className="px-2 py-2 text-right font-bold tabular-nums text-[#b54708]">
                              {formatInt(r.need)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Bản điện thoại — cùng đủ số liệu, xếp dọc. */}
                  <div className="space-y-2 px-3 pb-3 lg:hidden">
                    {shown.map((r) => (
                      <div key={r.product_id} className="rounded-xl border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">{r.sku || "—"}</p>
                            <Link
                              href={`/inventory/stock-card/${r.product_id}`}
                              className="block text-sm font-semibold hover:text-primary"
                            >
                              {r.product_name}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {r.supplier_name ?? NO_SUPPLIER_LABEL}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[11px] text-muted-foreground">Cần đặt</p>
                            <p className="text-lg font-black tabular-nums text-[#b54708]">
                              {formatInt(r.need)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{r.base_unit}</p>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          Còn phải giao {formatInt(r.demand)} · Tồn {formatInt(r.onHand)}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
