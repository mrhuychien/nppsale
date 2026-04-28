"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField, FilterCheckbox, FilterSelect } from "@/components/analytics/report-shell"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  ReportTable,
  TotalsRow,
} from "@/components/analytics/report-table"
import { fetchAllOrders, fetchOrderLines, type SalesOrderLineRow, type SalesOrderRow } from "@/lib/analytics/sales"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency, formatDate } from "@/lib/utils"
import { OrderStatus } from "@/types"

type Variant = "by_product" | "by_transaction"

const VARIANTS = [
  { key: "by_product" as const, label: "Hàng hóa" },
  { key: "by_transaction" as const, label: "Giao dịch" },
] as const

const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  confirmed: "Đã xác nhận",
  picking: "Đang soạn",
  delivering: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
}

const STATUS_OPTIONS: { key: OrderStatus; label: string }[] = [
  { key: "draft", label: STATUS_LABEL.draft },
  { key: "confirmed", label: STATUS_LABEL.confirmed },
  { key: "picking", label: STATUS_LABEL.picking },
  { key: "delivering", label: STATUS_LABEL.delivering },
  { key: "delivered", label: STATUS_LABEL.delivered },
  { key: "cancelled", label: STATUS_LABEL.cancelled },
]

interface ProductMeta {
  id: string
  sku: string
  name: string
}
interface CustomerMeta {
  id: string
  store_name: string
}
interface UserMeta {
  id: string
  full_name: string
}

export default function OrdersReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("by_product")
  const [preset, setPreset] = useState<PeriodPreset>("this_week")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_week"))
  const [status, setStatus] = useState<OrderStatus | "">("")
  const [groupSameType, setGroupSameType] = useState(false)
  const [customerSearch, setCustomerSearch] = useState("")
  const [productSearch, setProductSearch] = useState("")
  const [loading, setLoading] = useState(true)

  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [products, setProducts] = useState<ProductMeta[]>([])
  const [customers, setCustomers] = useState<CustomerMeta[]>([])
  const [users, setUsers] = useState<UserMeta[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [orderList, productsRes, customersRes, usersRes] = await Promise.all([
      fetchAllOrders(supabase, user.org_id, range),
      supabase.from("products").select("id, sku, name").eq("org_id", user.org_id),
      supabase.from("customers").select("id, store_name").eq("org_id", user.org_id),
      supabase.from("users").select("id, full_name").eq("org_id", user.org_id),
    ])
    const orderIds = orderList
      .filter((o) => (status ? o.status === status : true))
      .map((o) => o.id)
    const linesList = await fetchOrderLines(supabase, orderIds)
    setOrders(orderList)
    setLines(linesList)
    setProducts((productsRes.data as ProductMeta[]) || [])
    setCustomers((customersRes.data as CustomerMeta[]) || [])
    setUsers((usersRes.data as UserMeta[]) || [])
    setLoading(false)
  }, [user?.org_id, range, status, supabase])

  useEffect(() => {
    load()
  }, [load])

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (status && o.status !== status) return false
      if (customerSearch) {
        const c = customers.find((x) => x.id === o.customer_id)
        if (
          !(c?.store_name || "").toLowerCase().includes(customerSearch.toLowerCase()) &&
          !o.order_code.toLowerCase().includes(customerSearch.toLowerCase())
        )
          return false
      }
      return true
    })
  }, [orders, customers, status, customerSearch])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductMeta>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])
  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerMeta>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])
  const userMap = useMemo(() => {
    const m = new Map<string, UserMeta>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  const filteredOrderIdSet = useMemo(
    () => new Set(filteredOrders.map((o) => o.id)),
    [filteredOrders]
  )

  // -------------------- By product (drill-down) --------------------
  type ProductRow = {
    id: string
    sku: string
    name: string
    qty: number
    value: number
  }
  type ProductRowOrder = ProductRow & {
    orderRefs: { id: string; order_code: string; order_date: string; customer: string; qty: number; value: number }[]
  }

  const byProductRows: ProductRowOrder[] = useMemo(() => {
    const m = new Map<string, ProductRowOrder>()
    for (const l of lines) {
      if (!filteredOrderIdSet.has(l.order_id)) continue
      const p = productMap.get(l.product_id)
      if (!p) continue
      if (productSearch) {
        const q = productSearch.toLowerCase()
        if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) continue
      }
      const k = groupSameType ? p.name.split(" ")[0] : p.id
      const sku = groupSameType ? "" : p.sku
      const e = m.get(k) || { id: k, sku, name: p.name, qty: 0, value: 0, orderRefs: [] }
      e.qty += Number(l.quantity || 0)
      e.value += Number(l.line_total || 0)
      const o = orders.find((x) => x.id === l.order_id)
      if (o) {
        e.orderRefs.push({
          id: o.id,
          order_code: o.order_code,
          order_date: o.order_date,
          customer: customerMap.get(o.customer_id)?.store_name || "—",
          qty: Number(l.quantity || 0),
          value: Number(l.line_total || 0),
        })
      }
      m.set(k, e)
    }
    return Array.from(m.values()).sort((a, b) => b.value - a.value)
  }, [lines, filteredOrderIdSet, productMap, orders, customerMap, groupSameType, productSearch])

  // -------------------- By transaction --------------------
  type TxRow = {
    id: string
    order_code: string
    order_date: string
    customer: string
    sales_user: string
    status: string
    qty: number
    total: number
  }
  const txRows: TxRow[] = useMemo(() => {
    const lineQty = new Map<string, number>()
    for (const l of lines) {
      lineQty.set(l.order_id, (lineQty.get(l.order_id) || 0) + Number(l.quantity || 0))
    }
    return filteredOrders.map((o) => ({
      id: o.id,
      order_code: o.order_code,
      order_date: o.order_date,
      customer: customerMap.get(o.customer_id)?.store_name || "—",
      sales_user: userMap.get(o.sales_user_id)?.full_name || "—",
      status: STATUS_LABEL[o.status] || o.status,
      qty: lineQty.get(o.id) || 0,
      total: Number(o.total || 0),
    }))
  }, [filteredOrders, lines, customerMap, userMap])

  const handleExport = () => {
    if (variant === "by_product") {
      const out: (string | number)[][] = [["Mã hàng", "Tên hàng", "SL đặt", "Giá trị hàng đặt"]]
      for (const r of byProductRows) out.push([r.sku, r.name, r.qty, r.value])
      downloadXlsx(`bao-cao-dathang-hanghoa-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [
        ["Mã đơn", "Ngày đặt", "Khách hàng", "Nhân viên", "Trạng thái", "Tổng SL", "Tổng tiền"],
      ]
      for (const r of txRows)
        out.push([r.order_code, r.order_date, r.customer, r.sales_user, r.status, r.qty, r.total])
      downloadXlsx(`bao-cao-dathang-giaodich-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  const totalsByProduct = byProductRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, value: acc.value + r.value }),
    { qty: 0, value: 0 }
  )
  const totalsTx = txRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, total: acc.total + r.total }),
    { qty: 0, total: 0 }
  )

  return (
    <ReportShell
      title="Báo cáo đặt hàng"
      variants={VARIANTS}
      variant={variant}
      onVariantChange={(v) => setVariant(v)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
      extraOptions={
        <FilterField label="Tùy chọn">
          <FilterCheckbox
            label="Gộp theo nhóm hàng cùng loại"
            checked={groupSameType}
            onChange={setGroupSameType}
          />
        </FilterField>
      }
      filters={
        <>
          <FilterField label="Trạng thái">
            <FilterSelect
              value={status}
              onChange={(v) => setStatus(v as OrderStatus | "")}
              options={STATUS_OPTIONS}
            />
          </FilterField>
          <FilterField label="Khách hàng / Mã đơn">
            <input
              type="search"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Theo mã, tên, số điện thoại"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
            />
          </FilterField>
          {variant === "by_product" ? (
            <FilterField label="Hàng hóa">
              <input
                type="search"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Theo mã, tên hàng"
                className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
              />
            </FilterField>
          ) : null}
        </>
      }
    >
      <div className="hidden print:block mb-3 text-center text-xs text-muted-foreground">
        {VARIANTS.find((v) => v.key === variant)?.label} · {formatRangeLabel(range)}
      </div>
      {loading ? (
        <Skeleton className="h-72" />
      ) : variant === "by_product" ? (
        <ReportTable
          rows={byProductRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku || "—"}</span> },
            { key: "name", label: "Tên hàng", render: (r) => r.name },
            { key: "qty", label: "SL đặt", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
            { key: "val", label: "Giá trị hàng đặt", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.value)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL mặt hàng: ${byProductRows.length}`, colSpan: 2 },
                { content: totalsByProduct.qty.toLocaleString("vi-VN"), align: "right" },
                { content: formatCurrency(totalsByProduct.value), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="rounded-md border border-border/40 bg-background/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-emerald-100/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã phiếu</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Thời gian</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Khách hàng</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL đặt</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị hàng đặt</th>
                  </tr>
                </thead>
                <tbody>
                  {r.orderRefs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-center text-xs text-muted-foreground">
                        Không có phiếu
                      </td>
                    </tr>
                  ) : (
                    r.orderRefs.map((d) => (
                      <tr key={d.id} className="border-t border-border/30">
                        <td className="px-3 py-1.5 font-mono text-xs text-primary">{d.order_code}</td>
                        <td className="px-3 py-1.5">{formatDate(d.order_date)}</td>
                        <td className="px-3 py-1.5">{d.customer}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {d.qty.toLocaleString("vi-VN")}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatCurrency(d.value)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        />
      ) : (
        <ReportTable
          rows={txRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "code", label: "Mã đơn", render: (r) => <span className="font-mono text-xs text-primary">{r.order_code}</span> },
            { key: "date", label: "Ngày đặt", render: (r) => formatDate(r.order_date) },
            { key: "cust", label: "Khách hàng", render: (r) => r.customer },
            { key: "user", label: "Nhân viên", render: (r) => r.sales_user },
            { key: "status", label: "Trạng thái", render: (r) => r.status },
            { key: "qty", label: "Tổng SL", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
            { key: "total", label: "Tổng tiền", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.total)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL phiếu: ${txRows.length}`, colSpan: 5 },
                { content: totalsTx.qty.toLocaleString("vi-VN"), align: "right" },
                { content: formatCurrency(totalsTx.total), align: "right", className: "text-primary" },
              ]}
            />
          }
        />
      )}
    </ReportShell>
  )
}
