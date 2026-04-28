"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame, downloadCsv } from "@/components/analytics/report-frame"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"

interface SupplierRow {
  id: string
  name: string
  code: string | null
  category: string | null
}

interface PurchaseInvoiceRow {
  id: string
  supplier_id: string
  invoice_date: string
  total: number
  status: string
}

interface PayableRow {
  supplier_id: string
  amount: number
  paid: number
  status: string
}

export default function SuppliersReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([])
  const [payables, setPayables] = useState<PayableRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [suppliersRes, invoicesRes, payablesRes] = await Promise.all([
      supabase
        .from("suppliers")
        .select("id, name, code, category")
        .eq("org_id", user.org_id)
        .eq("is_active", true),
      supabase
        .from("purchase_invoices")
        .select("id, supplier_id, invoice_date, total, status")
        .eq("org_id", user.org_id)
        .gte("invoice_date", range.from)
        .lte("invoice_date", range.to)
        .neq("status", "cancelled"),
      supabase
        .from("payables")
        .select("supplier_id, amount, paid, status")
        .eq("org_id", user.org_id),
    ])
    setSuppliers((suppliersRes.data as SupplierRow[]) || [])
    setInvoices((invoicesRes.data as PurchaseInvoiceRow[]) || [])
    setPayables((payablesRes.data as PayableRow[]) || [])
    setLoading(false)
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const supplierMap = useMemo(() => {
    const m = new Map<string, SupplierRow>()
    for (const s of suppliers) m.set(s.id, s)
    return m
  }, [suppliers])

  const rows = useMemo(() => {
    const m = new Map<string, { purchaseValue: number; invoiceCount: number; outstanding: number }>()
    for (const inv of invoices) {
      const e = m.get(inv.supplier_id) || { purchaseValue: 0, invoiceCount: 0, outstanding: 0 }
      e.purchaseValue += Number(inv.total || 0)
      e.invoiceCount += 1
      m.set(inv.supplier_id, e)
    }
    for (const p of payables) {
      const e = m.get(p.supplier_id) || { purchaseValue: 0, invoiceCount: 0, outstanding: 0 }
      e.outstanding += Number(p.amount || 0) - Number(p.paid || 0)
      m.set(p.supplier_id, e)
    }
    // Include suppliers with debt or activity
    return Array.from(m.entries())
      .map(([sid, e]) => {
        const s = supplierMap.get(sid)
        return {
          id: sid,
          code: s?.code || "—",
          name: s?.name || "—",
          category: s?.category || "—",
          purchaseValue: e.purchaseValue,
          invoiceCount: e.invoiceCount,
          outstanding: e.outstanding,
        }
      })
      .filter((r) => r.purchaseValue > 0 || r.outstanding > 0)
      .sort((a, b) => b.purchaseValue - a.purchaseValue)
  }, [invoices, payables, supplierMap])

  const totals = rows.reduce(
    (acc, r) => ({
      invoiceCount: acc.invoiceCount + r.invoiceCount,
      purchaseValue: acc.purchaseValue + r.purchaseValue,
      outstanding: acc.outstanding + r.outstanding,
    }),
    { invoiceCount: 0, purchaseValue: 0, outstanding: 0 }
  )

  const handleExport = () => {
    const out: (string | number)[][] = [
      ["Mã NCC", "Tên nhà cung cấp", "Nhóm", "Số HĐ mua", "Giá trị mua", "Còn nợ"],
    ]
    for (const r of rows) {
      out.push([r.code, r.name, r.category, r.invoiceCount, r.purchaseValue, r.outstanding])
    }
    downloadCsv(`bao-cao-ncc-${range.from}-${range.to}.csv`, out)
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo nhà cung cấp"
      subtitle={loading ? "Đang tải..." : formatRangeLabel(range)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
    >
      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <table className="w-full border border-border/40 text-sm">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Mã NCC</th>
              <th className="px-3 py-2 text-left font-semibold">Tên nhà cung cấp</th>
              <th className="px-3 py-2 text-left font-semibold">Nhóm</th>
              <th className="px-3 py-2 text-right font-semibold">Số HĐ mua</th>
              <th className="px-3 py-2 text-right font-semibold">Giá trị mua</th>
              <th className="px-3 py-2 text-right font-semibold">Còn nợ</th>
            </tr>
            <tr className="border-t border-border/30 bg-muted/10 font-semibold">
              <td className="px-3 py-2" colSpan={3}>SL nhà cung cấp: {rows.length}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.invoiceCount}</td>
              <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.purchaseValue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.outstanding)}</td>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Không có dữ liệu trong kỳ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border/30">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.invoiceCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.purchaseValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={r.outstanding > 0 ? "text-red-600 font-semibold" : ""}>
                      {formatCurrency(r.outstanding)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </ReportFrame>
  )
}
