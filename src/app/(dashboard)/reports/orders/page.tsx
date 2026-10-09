"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useLuotNap } from "@/hooks/use-luot-nap"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField, FilterCheckbox, FilterSelect, FilterSearchSelect, FilterMultiSelect } from "@/components/analytics/report-shell"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  ReportTable,
  TotalsRow,
} from "@/components/analytics/report-table"
import { fetchAllOrdersDu, fetchOrgRows, type SalesOrderLineRow, type SalesOrderRow } from "@/lib/analytics/sales"
import { docTheoLoId } from "@/lib/supabase/aggregate"
import { slCoSoDong } from "@/lib/analytics/quy-doi-dong"
import { congSL, hienSLTheoDonVi, tongSLTheoDonVi, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"
import { errorMessage } from "@/lib/errors"
import { phanTienQuaLoc, coDongQuaLoc } from "@/lib/analytics/hang-ban-nhan-vien"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { OrderStatus } from "@/types"

type Variant = "by_product" | "by_transaction"

const VARIANTS = [
  { key: "by_product" as const, label: "Hàng hóa" },
  { key: "by_transaction" as const, label: "Giao dịch" },
] as const

const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  submitted: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
}

const STATUS_OPTIONS: { key: OrderStatus; label: string }[] = [
  { key: "draft", label: STATUS_LABEL.draft },
  { key: "submitted", label: STATUS_LABEL.submitted },
  { key: "completed", label: STATUS_LABEL.completed },
  { key: "cancelled", label: STATUS_LABEL.cancelled },
]

interface ProductMeta {
  id: string
  sku: string
  name: string
  brand?: string | null
  base_unit: string
  units?: { unit_name: string; conversion: number }[] | null
}

/** Dòng đơn kèm hệ số chụp — số lượng đặt phải quy về đơn vị cơ sở. */
type DongDon = SalesOrderLineRow & { conversion_factor?: number | null }
interface CustomerMeta {
  id: string
  store_name: string
  group_id?: string | null
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
  const [productSearch] = useState("")
  const [customerFilter, setCustomerFilter] = useState<string[]>([])
  const [productFilter, setProductFilter] = useState<string[]>([])
  /* Không còn lọc "Loại hàng" (`products.category`) — chủ nhà 03/10/2026 "Bỏ luôn trường nhóm hàng". */
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [groupFilter, setGroupFilter] = useState("")
  const [salesUserFilter, setSalesUserFilter] = useState<string[]>([])
  const catalogs = useFilterCatalogs(user?.org_id)
  const [loading, setLoading] = useState(true)

  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [lines, setLines] = useState<DongDon[]>([])
  const [products, setProducts] = useState<ProductMeta[]>([])
  const [customers, setCustomers] = useState<CustomerMeta[]>([])
  const [users, setUsers] = useState<UserMeta[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const batLuot = useLuotNap()
  const load = useCallback(async () => {
    if (!user?.org_id) return
    const conMoi = batLuot()
    /* ⚠ BẢNG TRA CỨU ĐỌC ĐỦ, HỎNG THÌ NÓI. Đọc trần thì khách / mặt hàng
       thứ 1.001 trở đi mất tên trên báo cáo; lỗi chỉ `console.error` thì
       cả trang trống mà không ai biết vì sao. */
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      const [orderRes, productsRes, customersRes, usersRes] = await Promise.all([
        fetchAllOrdersDu(supabase, orgId, range),
        fetchOrgRows<ProductMeta>(supabase, "products", orgId, "id, sku, name, brand, base_unit, units:product_units(unit_name, conversion)", "đọc mặt hàng"),
        fetchOrgRows<CustomerMeta>(supabase, "customers", orgId, "id, store_name, group_id", "đọc khách hàng"),
        fetchOrgRows<UserMeta>(supabase, "users", orgId, "id, full_name", "đọc nhân viên"),
      ])
      const orderIds = orderRes.rows
        .filter((o) => (status ? o.status === status : true))
        .map((o) => o.id)
      /* ⚠ ĐỌC KÈM `conversion_factor` (mig 039). Dòng đặt 3 thùng + 5 hộp
         cộng thẳng `quantity` là "8" — sai. Quy về đơn vị cơ sở (24/09/2026). */
      const linesList = await docTheoLoId<DongDon>(
        orderIds,
        (lo, from, to) =>
          supabase
            .from("sales_order_lines")
            .select("id, order_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_total", {
              count: "exact",
            })
            .in("order_id", lo)
            .order("id")
            .range(from, to),
        "đọc dòng đơn hàng"
      )
      if (conMoi()) setTruncated(orderRes.truncated || productsRes.truncated || customersRes.truncated || usersRes.truncated)
      if (conMoi()) setOrders(orderRes.rows)
      if (conMoi()) setLines(linesList)
      if (conMoi()) setProducts(productsRes.rows)
      if (conMoi()) setCustomers(customersRes.rows)
      if (conMoi()) setUsers(usersRes.rows)
    } catch (err) {
      if (conMoi()) setLoadError(errorMessage(err))
    } finally {
      if (conMoi()) setLoading(false)
    }
  }, [user?.org_id, range, status, supabase, batLuot])

  useEffect(() => {
    load()
  }, [load])

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

  /* ⚠ Lọc cấp ĐƠN (cả hai tab): trạng thái, khách, nhân viên, ô tìm và BẢNG GIÁ / NHÓM KHÁCH. Bản cũ chỉ áp bảng giá
     ở tab Hàng hoá — tab Giao dịch vẫn liệt kê đơn của mọi nhóm khách (rà báo cáo 09/10/2026). */
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (status && o.status !== status) return false
      if (customerFilter.length && !customerFilter.includes(o.customer_id)) return false
      if (salesUserFilter.length && !salesUserFilter.includes(o.sales_user_id || "")) return false
      if (groupFilter && customerMap.get(o.customer_id)?.group_id !== groupFilter) return false
      if (customerSearch && !viMatchAllWords(customerSearch, o.order_code, customerMap.get(o.customer_id)?.store_name)) return false
      return true
    })
  }, [orders, customerMap, status, customerFilter, salesUserFilter, groupFilter, customerSearch])

  // Lọc cấp DÒNG (hàng hoá / thương hiệu) — một luật cho hai tab.
  const coLocHang = productFilter.length > 0 || brandFilter.length > 0
  const quaHang = useCallback(
    (pid: string) => {
      const p = productMap.get(pid)
      if (!p) return false
      if (productFilter.length && !productFilter.includes(p.id)) return false
      if (brandFilter.length && !brandFilter.includes(p.brand || "")) return false
      return true
    },
    [productMap, productFilter, brandFilter]
  )
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
    /** Đơn vị cơ sở của mặt hàng; gộp cùng loại mà khác đơn vị thì rỗng. */
    unit: string
    /** ⚠ Gộp khác đơn vị thì lẫn — chỉ để xuất khi `unit` có. Hiện `qtyTheoDv`. */
    qty: number
    qtyTheoDv: SLTheoDonVi
    value: number
  }
  type ProductRowOrder = ProductRow & {
    orderRefs: { id: string; order_code: string; order_date: string; customer: string; qty: number; unit: string; value: number }[]
  }

  const byProductRows: ProductRowOrder[] = useMemo(() => {
    const m = new Map<string, ProductRowOrder>()
    for (const l of lines) {
      if (!filteredOrderIdSet.has(l.order_id)) continue
      const p = productMap.get(l.product_id)
      if (!p) continue
      if (!quaHang(p.id)) continue
      if (productSearch) {
        if (!viMatchAllWords(productSearch, p.sku, p.name)) continue
      }
      const k = groupSameType ? p.name.split(" ")[0] : p.id
      const sku = groupSameType ? "" : p.sku
      const e = m.get(k) || { id: k, sku, name: p.name, unit: p.base_unit || "", qty: 0, qtyTheoDv: {}, value: 0, orderRefs: [] }
      if (e.unit !== (p.base_unit || "")) e.unit = ""
      const slCoSo = slCoSoDong(l, p)
      e.qty += slCoSo
      // Gộp cùng loại = nhiều mặt hàng → giữ theo từng đơn vị cơ sở.
      congSL(e.qtyTheoDv, p.base_unit, slCoSo)
      e.value += Number(l.line_total || 0)
      const o = orders.find((x) => x.id === l.order_id)
      if (o) {
        e.orderRefs.push({
          id: o.id,
          order_code: o.order_code,
          order_date: o.order_date,
          customer: customerMap.get(o.customer_id)?.store_name || "—",
          qty: slCoSo,
          unit: p.base_unit || "",
          value: Number(l.line_total || 0),
        })
      }
      m.set(k, e)
    }
    return Array.from(m.values()).sort((a, b) => b.value - a.value)
  }, [lines, filteredOrderIdSet, productMap, orders, customerMap, groupSameType, productSearch, quaHang])

  // -------------------- By transaction --------------------
  type TxRow = {
    id: string
    order_code: string
    order_date: string
    customer: string
    sales_user: string
    status: string
    /** Một đơn nhiều mặt hàng → theo từng đơn vị cơ sở. */
    qtyTheoDv: SLTheoDonVi
    total: number
  }
  const txRows: TxRow[] = useMemo(() => {
    const dongTheoDon = new Map<string, DongDon[]>()
    for (const l of lines) {
      const a = dongTheoDon.get(l.order_id)
      if (a) a.push(l)
      else dongTheoDon.set(l.order_id, [l])
    }
    /* ⚠ Đang lọc Hàng hoá / Thương hiệu: chỉ đơn có dòng qua lọc; SL là của các dòng ấy, tiền là PHẦN của chúng trong
       tổng đơn (chia theo tỉ lệ `line_total`, như báo cáo Bán hàng / Nhân viên). Bản cũ bỏ qua hai ô lọc này ở tab
       Giao dịch (rà báo cáo 09/10/2026). */
    const out: TxRow[] = []
    for (const o of filteredOrders) {
      const ls = dongTheoDon.get(o.id) || []
      if (coLocHang && !coDongQuaLoc(ls, quaHang)) continue
      const q: SLTheoDonVi = {}
      for (const l of ls) {
        if (coLocHang && !quaHang(l.product_id)) continue
        const p = productMap.get(l.product_id)
        congSL(q, p?.base_unit, slCoSoDong(l, p))
      }
      out.push({
        id: o.id,
        order_code: o.order_code,
        order_date: o.order_date,
        customer: customerMap.get(o.customer_id)?.store_name || "—",
        sales_user: userMap.get(o.sales_user_id)?.full_name || "—",
        status: STATUS_LABEL[o.status] || o.status,
        qtyTheoDv: q,
        total: coLocHang ? phanTienQuaLoc(Number(o.total || 0), ls, quaHang) : Number(o.total || 0),
      })
    }
    return out
  }, [filteredOrders, lines, customerMap, userMap, productMap, coLocHang, quaHang])

  const handleExport = () => {
    if (variant === "by_product") {
      const out: (string | number)[][] = [["Mã hàng", "Tên hàng", "ĐV cơ sở", "SL đặt (ĐV cơ sở)", "Giá trị hàng đặt"]]
      // Gộp khác đơn vị (`unit` rỗng): xuất "640 hộp · 12 chai", không cộng lẫn.
      for (const r of byProductRows) out.push([r.sku, r.name, r.unit, r.unit ? r.qty : hienSLTheoDonVi(r.qtyTheoDv), r.value])
      downloadXlsx(`bao-cao-dathang-hanghoa-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [
        ["Mã đơn", "Ngày đặt", "Khách hàng", "Nhân viên", "Trạng thái", "Tổng SL (ĐV cơ sở)", "Tổng tiền"],
      ]
      for (const r of txRows)
        out.push([r.order_code, r.order_date, r.customer, r.sales_user, r.status, hienSLTheoDonVi(r.qtyTheoDv), r.total])
      downloadXlsx(`bao-cao-dathang-giaodich-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  // SL dòng tổng: gộp theo đơn vị cơ sở, không cộng hộp + chai.
  const totalsByProduct = {
    qtyTheoDv: tongSLTheoDonVi(byProductRows),
    value: byProductRows.reduce((s, r) => s + r.value, 0),
  }
  const totalsTx = {
    qtyTheoDv: tongSLTheoDonVi(txRows),
    total: txRows.reduce((s, r) => s + r.total, 0),
  }

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
          <FilterField label="Khách hàng (chọn nhiều)">
            <FilterMultiSelect
              value={customerFilter}
              onChange={setCustomerFilter}
              options={catalogs.customers}
              placeholder="Tất cả khách hàng"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Tìm theo mã đơn / tên KH">
            <input
              type="search"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Mã đơn / tên khách (tự do)"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
            />
          </FilterField>
          <FilterField label="Hàng hóa (chọn nhiều)">
            <FilterMultiSelect
              value={productFilter}
              onChange={setProductFilter}
              options={catalogs.products}
              placeholder="Tất cả hàng hóa"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Thương hiệu (chọn nhiều)">
            <FilterMultiSelect
              value={brandFilter}
              onChange={setBrandFilter}
              options={catalogs.brands}
              placeholder="Tất cả thương hiệu"
              loading={catalogs.loading}
            />
          </FilterField>
          {/* Lọc theo NHÓM KHÁCH (bảng giá) — không phải nhóm hàng (đã bỏ, chủ nhà 03/10/2026). */}
          <FilterField label="Bảng giá / Nhóm khách">
            <FilterSearchSelect
              value={groupFilter}
              onChange={setGroupFilter}
              options={catalogs.customerGroups}
              placeholder="Chọn bảng giá"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Nhân viên (chọn nhiều)">
            <FilterMultiSelect
              value={salesUserFilter}
              onChange={setSalesUserFilter}
              options={catalogs.salesUsers}
              placeholder="Tất cả nhân viên"
              loading={catalogs.loading}
            />
          </FilterField>
        </>
      }
    >
      <div className="hidden print:block mb-3 text-center text-xs text-muted-foreground">
        {VARIANTS.find((v) => v.key === variant)?.label} · {formatRangeLabel(range)}
      </div>
      {!loadError && <ReportLoadNotice truncated={truncated} />}
      {loadError ? (
        <ReportLoadNotice error={loadError} />
      ) : loading ? (
        <Skeleton className="h-72" />
      ) : variant === "by_product" ? (
        <ReportTable
          rows={byProductRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku || "—"}</span> },
            { key: "name", label: "Tên hàng", render: (r) => r.name },
            {
              key: "qty",
              label: "SL đặt (ĐV cơ sở)",
              align: "right",
              render: (r) => hienSLTheoDonVi(r.qtyTheoDv),
            },
            { key: "val", label: "Giá trị hàng đặt", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.value)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL mặt hàng: ${byProductRows.length}`, colSpan: 2 },
                { content: hienSLTheoDonVi(totalsByProduct.qtyTheoDv), align: "right" },
                { content: formatCurrency(totalsByProduct.value), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="rounded-md border border-border/40 bg-background/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#ecfdf3]/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã phiếu</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Thời gian</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Khách hàng</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL đặt (ĐV cơ sở)</th>
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
                          {d.unit ? ` ${d.unit}` : ""}
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
            { key: "qty", label: "Tổng SL (ĐV cơ sở)", align: "right", render: (r) => hienSLTheoDonVi(r.qtyTheoDv) },
            { key: "total", label: "Tổng tiền", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.total)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL phiếu: ${txRows.length}`, colSpan: 5 },
                { content: hienSLTheoDonVi(totalsTx.qtyTheoDv), align: "right" },
                { content: formatCurrency(totalsTx.total), align: "right", className: "text-primary" },
              ]}
            />
          }
        />
      )}
    </ReportShell>
  )
}
