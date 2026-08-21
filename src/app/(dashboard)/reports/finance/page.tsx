"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField } from "@/components/analytics/report-shell"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import {
  fetchDeliveredOrders,
  fetchReturnsValue,
  fetchCogsForRange,
} from "@/lib/analytics/sales"
import { formatCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"

type Variant = "income_statement" | "balance" | "cash_flow"

const VARIANTS = [
  { key: "income_statement" as const, label: "Kết quả HĐKD" },
  { key: "balance" as const, label: "Cân đối tài sản" },
  { key: "cash_flow" as const, label: "Lưu chuyển tiền tệ" },
] as const

interface ExpenseRow {
  amount: number
  expense_date: string
  is_paid: boolean
  category: { id: string; code: string; name: string; bucket: string } | null
}

interface ReceivableRow {
  amount: number
  paid: number
  status: string
}

interface PayableRow {
  amount: number
  paid: number
  status: string
}

interface CashReceiptRow {
  submitted_amount: number
  receipt_date: string
  status: string
}

interface BatchRow {
  qty_on_hand: number
  unit_cost: number
}

const BUCKET_LABEL: Record<string, string> = {
  cogs: "Điều chỉnh giá vốn",
  operating: "Chi phí vận hành",
  hr: "Chi phí nhân sự",
  financial: "Chi phí tài chính",
  tax: "Thuế",
  other: "Chi phí khác",
}

export default function FinanceReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("income_statement")
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [yearMode, setYearMode] = useState(false)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [loading, setLoading] = useState(true)

  const [revenue, setRevenue] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [returnsValue, setReturnsValue] = useState(0)
  const [cogs, setCogs] = useState(0)
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])

  // Balance sheet snapshots
  const [recvOpen, setRecvOpen] = useState(0)
  const [payOpen, setPayOpen] = useState(0)
  const [inventoryValue, setInventoryValue] = useState(0)

  // Cash flow
  const [cashIn, setCashIn] = useState(0)
  const [cashOutPaid, setCashOutPaid] = useState(0)

  const effectiveRange: DateRange = useMemo(() => {
    if (yearMode) {
      return { from: `${year}-01-01`, to: `${year}-12-31` }
    }
    return range
  }, [yearMode, year, range])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const r = effectiveRange
    const [orderList, retVal, cogsRes, expensesRes, recvRes, payRes, batchesRes, cashRes] =
      await Promise.all([
        fetchDeliveredOrders(supabase, user.org_id, r),
        fetchReturnsValue(supabase, user.org_id, r),
        fetchCogsForRange(supabase, user.org_id, r),
        supabase
          .from("expenses")
          .select("amount, expense_date, is_paid, category:expense_categories(id, code, name, bucket)")
          .eq("org_id", user.org_id)
          .gte("expense_date", r.from)
          .lte("expense_date", r.to),
        supabase
          .from("receivables")
          .select("amount, paid, status")
          .eq("org_id", user.org_id)
          .in("status", ["open", "partial", "overdue"]),
        supabase
          .from("payables")
          .select("amount, paid, status")
          .eq("org_id", user.org_id)
          .in("status", ["open", "partial", "overdue"]),
        supabase
          .from("batches")
          .select("qty_on_hand, unit_cost")
          .eq("org_id", user.org_id)
          .gt("qty_on_hand", 0),
        supabase
          .from("cash_receipts")
          .select("submitted_amount, receipt_date, status")
          .eq("org_id", user.org_id)
          .gte("receipt_date", r.from)
          .lte("receipt_date", r.to)
          .eq("status", "received"),
      ])
    const qErr = ([cogsRes, expensesRes, recvRes, payRes, batchesRes, cashRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[reports/finance] truy vấn lỗi:", qErr.message)

    let totalRevenue = 0
    let totalDiscount = 0
    for (const o of orderList) {
      totalRevenue += Number(o.total || 0)
      totalDiscount += Number(o.discount || 0)
    }
    setRevenue(totalRevenue)
    setDiscount(totalDiscount)
    setReturnsValue(retVal)
    setCogs(cogsRes.cogs)

    type ExpRowRaw = {
      amount: number
      expense_date: string
      is_paid: boolean
      category?: { id: string; code: string; name: string; bucket: string } | null
    }
    const exps = ((expensesRes.data as unknown) as ExpRowRaw[] || []).map((e) => ({
      amount: Number(e.amount || 0),
      expense_date: e.expense_date,
      is_paid: !!e.is_paid,
      category: e.category || null,
    }))
    setExpenses(exps)

    let recvSum = 0
    for (const x of (recvRes.data as ReceivableRow[]) || []) {
      recvSum += Math.max(0, Number(x.amount || 0) - Number(x.paid || 0))
    }
    setRecvOpen(recvSum)

    let paySum = 0
    for (const x of (payRes.data as PayableRow[]) || []) {
      paySum += Math.max(0, Number(x.amount || 0) - Number(x.paid || 0))
    }
    setPayOpen(paySum)

    let inv = 0
    for (const b of (batchesRes.data as BatchRow[]) || []) {
      inv += Number(b.qty_on_hand || 0) * Number(b.unit_cost || 0)
    }
    setInventoryValue(inv)

    let ci = 0
    for (const x of (cashRes.data as CashReceiptRow[]) || []) {
      ci += Number(x.submitted_amount || 0)
    }
    setCashIn(ci)

    let co = 0
    for (const e of exps) if (e.is_paid) co += e.amount
    setCashOutPaid(co)

    setLoading(false)
  }, [user?.org_id, effectiveRange, supabase])

  useEffect(() => {
    load()
  }, [load])

  const expensesByCategory = useMemo(() => {
    const m = new Map<
      string,
      { id: string; code: string; name: string; bucket: string; amount: number }
    >()
    for (const e of expenses) {
      if (!e.category) continue
      const k = e.category.id
      const existing = m.get(k) || {
        id: k,
        code: e.category.code,
        name: e.category.name,
        bucket: e.category.bucket,
        amount: 0,
      }
      existing.amount += e.amount
      m.set(k, existing)
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount)
  }, [expenses])

  // Income statement values
  const grossRevenue = revenue
  const totalDeduction = discount + returnsValue
  const netRevenue = grossRevenue - totalDeduction
  const grossProfit = netRevenue - cogs
  // Exclude bucket "cogs" because it's already in COGS line; combine others under "Chi phí (6)"
  const operatingExpenses = expenses
    .filter((e) => e.category?.bucket !== "cogs")
    .reduce((s, e) => s + e.amount, 0)
  const netProfit = grossProfit - operatingExpenses

  const handleExport = () => {
    if (variant === "income_statement") {
      const out: (string | number)[][] = [["Mục", "Giá trị"]]
      out.push(["Doanh thu bán hàng (1)", grossRevenue])
      out.push(["  Chiết khấu hóa đơn (2.1)", discount])
      out.push(["  Giá trị hàng bán bị trả lại (2.2)", returnsValue])
      out.push(["Giảm trừ Doanh thu (2)", totalDeduction])
      out.push(["Doanh thu thuần (3=1-2)", netRevenue])
      out.push(["Giá vốn hàng bán (4)", cogs])
      out.push(["Lợi nhuận gộp (5=3-4)", grossProfit])
      for (const c of expensesByCategory) {
        out.push([`  ${c.name} [${BUCKET_LABEL[c.bucket] || c.bucket}]`, c.amount])
      }
      out.push(["Tổng chi phí (6)", operatingExpenses])
      out.push(["Lợi nhuận thuần (7=5-6)", netProfit])
      downloadXlsx(`bao-cao-tai-chinh-kqhdkd-${effectiveRange.from}-${effectiveRange.to}`, out)
    } else if (variant === "balance") {
      const out: (string | number)[][] = [
        ["Mục", "Giá trị"],
        ["TÀI SẢN", ""],
        ["  Tiền mặt thu trong kỳ", cashIn],
        ["  Công nợ phải thu", recvOpen],
        ["  Hàng tồn kho", inventoryValue],
        ["NGUỒN VỐN", ""],
        ["  Công nợ phải trả NCC", payOpen],
      ]
      downloadXlsx(`bao-cao-tai-chinh-cdts-${effectiveRange.from}-${effectiveRange.to}`, out)
    } else {
      const out: (string | number)[][] = [
        ["Mục", "Giá trị"],
        ["DÒNG TIỀN VÀO", ""],
        ["  Thu từ phiếu thu (đã nhận)", cashIn],
        ["DÒNG TIỀN RA", ""],
        ["  Chi phí đã thanh toán", cashOutPaid],
        ["Chênh lệch dòng tiền", cashIn - cashOutPaid],
      ]
      downloadXlsx(`bao-cao-tai-chinh-dongtien-${effectiveRange.from}-${effectiveRange.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportShell
      title="Báo cáo tài chính"
      variants={VARIANTS}
      variant={variant}
      onVariantChange={(v) => setVariant(v)}
      range={effectiveRange}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
        setYearMode(false)
      }}
      onExportCsv={handleExport}
      extraOptions={
        <FilterField label="Tùy chọn">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={yearMode}
              onChange={() => setYearMode(true)}
              className="h-4 w-4"
            />
            <span>Theo năm</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
              className="ml-2 h-7 w-20 rounded-md border border-border/60 bg-card px-2 text-sm"
              min={2000}
              max={2100}
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!yearMode}
              onChange={() => setYearMode(false)}
              className="h-4 w-4"
            />
            <span>Theo khoảng ngày</span>
          </label>
        </FilterField>
      }
    >
      <div className="hidden print:block mb-3 text-center">
        <p className="text-xs text-muted-foreground">Ngày lập: {new Date().toLocaleString("vi-VN")}</p>
        <h2 className="mt-1 text-lg font-bold uppercase">
          {variant === "income_statement"
            ? "Báo cáo kết quả hoạt động kinh doanh"
            : variant === "balance"
              ? "Bảng cân đối tài sản"
              : "Báo cáo lưu chuyển tiền tệ"}
        </h2>
        <p className="text-sm">
          Từ ngày {formatRangeLabel(effectiveRange).split(" - ")[0]} đến ngày{" "}
          {formatRangeLabel(effectiveRange).split(" - ")[1]}
        </p>
      </div>
      {loading ? (
        <Skeleton className="h-72" />
      ) : variant === "income_statement" ? (
        <IncomeStatement
          revenue={grossRevenue}
          discount={discount}
          returnsValue={returnsValue}
          totalDeduction={totalDeduction}
          netRevenue={netRevenue}
          cogs={cogs}
          grossProfit={grossProfit}
          expensesByCategory={expensesByCategory}
          operatingExpenses={operatingExpenses}
          netProfit={netProfit}
        />
      ) : variant === "balance" ? (
        <BalanceSheet recv={recvOpen} payable={payOpen} inventory={inventoryValue} cash={cashIn} />
      ) : (
        <CashFlow cashIn={cashIn} cashOut={cashOutPaid} />
      )}
    </ReportShell>
  )
}

interface FlatRowProps {
  label: string
  value: number
  level?: number
  bold?: boolean
  /** Highlight as section header (sky-blue) */
  header?: boolean
  /** Sub-row indent and color */
  sub?: boolean
  /** Render value with red color when negative */
  negative?: boolean
  /** Use colored value */
  accent?: "primary" | "negative" | "default"
}

function Row({ label, value, level = 0, bold, sub, accent }: FlatRowProps) {
  const valueColor =
    accent === "primary"
      ? "text-primary"
      : accent === "negative"
        ? "text-error"
        : ""
  return (
    <tr className={cn("border-b border-border/40", bold ? "font-semibold" : "")}>
      <td
        className={cn("px-4 py-2.5", level === 1 ? "pl-8" : level === 2 ? "pl-12" : "")}
        style={{ paddingLeft: level > 0 ? `${1 + level * 1}rem` : undefined }}
      >
        <span className={sub ? "text-muted-foreground" : ""}>{label}</span>
      </td>
      <td
        className={cn(
          "px-4 py-2.5 text-right tabular-nums",
          valueColor,
          sub ? "text-muted-foreground" : ""
        )}
      >
        {value === 0 ? "0" : formatCurrency(Math.abs(value))}
      </td>
    </tr>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <tr className="bg-[#eff8ff] print:bg-[#eff8ff]">
      <td colSpan={2} className="px-4 py-2.5 text-center font-semibold text-foreground">
        {children}
      </td>
    </tr>
  )
}

interface IncomeProps {
  revenue: number
  discount: number
  returnsValue: number
  totalDeduction: number
  netRevenue: number
  cogs: number
  grossProfit: number
  expensesByCategory: { id: string; name: string; bucket: string; amount: number }[]
  operatingExpenses: number
  netProfit: number
}

function IncomeStatement(p: IncomeProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <SectionHeader>Tổng</SectionHeader>
      </thead>
      <tbody>
        <Row label="Doanh thu bán hàng (1)" value={p.revenue} bold accent="primary" />
        <Row label="Giảm trừ Doanh thu (2 = 2.1+2.2)" value={p.totalDeduction} bold />
        <Row label="Chiết khấu hóa đơn (2.1)" value={p.discount} level={1} sub accent="primary" />
        <Row label="Giá trị hàng bán bị trả lại (2.2)" value={p.returnsValue} level={1} sub accent="primary" />
        <Row label="Doanh thu thuần (3 = 1-2)" value={p.netRevenue} bold accent="primary" />
        <Row label="Giá vốn hàng bán (4)" value={p.cogs} bold />
        <Row
          label="Lợi nhuận gộp về bán hàng (5 = 3-4)"
          value={p.grossProfit}
          bold
          accent={p.grossProfit >= 0 ? "primary" : "negative"}
        />
        <Row label="Chi phí (6)" value={p.operatingExpenses} bold />
        {p.expensesByCategory.length === 0 ? (
          <tr className="border-b border-border/40">
            <td colSpan={2} className="px-4 py-2 text-sm text-muted-foreground" style={{ paddingLeft: "2rem" }}>
              Chưa có chi phí nào trong kỳ
            </td>
          </tr>
        ) : (
          p.expensesByCategory.map((c) => (
            <Row key={c.id} label={c.name} value={c.amount} level={1} sub />
          ))
        )}
        <tr className="border-t-2 border-foreground/40 bg-[#fff4ed] font-bold">
          <td className="px-4 py-3">Lợi nhuận thuần (7 = 5-6)</td>
          <td
            className={cn(
              "px-4 py-3 text-right tabular-nums text-base",
              p.netProfit >= 0 ? "text-tertiary" : "text-error"
            )}
          >
            {p.netProfit < 0 ? `(${formatCurrency(Math.abs(p.netProfit))})` : formatCurrency(p.netProfit)}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function BalanceSheet({
  recv,
  payable,
  inventory,
  cash,
}: {
  recv: number
  payable: number
  inventory: number
  cash: number
}) {
  const totalAssets = cash + recv + inventory
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <SectionHeader>Tổng</SectionHeader>
      </thead>
      <tbody>
        <tr className="bg-muted/30 font-semibold">
          <td className="px-4 py-2">TÀI SẢN</td>
          <td className="px-4 py-2 text-right">{formatCurrency(totalAssets)}</td>
        </tr>
        <Row label="Tiền mặt thu trong kỳ" value={cash} level={1} sub />
        <Row label="Công nợ phải thu" value={recv} level={1} sub />
        <Row label="Hàng tồn kho" value={inventory} level={1} sub />
        <tr className="bg-muted/30 font-semibold">
          <td className="px-4 py-2">NGUỒN VỐN</td>
          <td className="px-4 py-2 text-right">{formatCurrency(payable)}</td>
        </tr>
        <Row label="Công nợ phải trả NCC" value={payable} level={1} sub />
        <tr className="border-t-2 border-foreground/40 bg-[#fff4ed] font-bold">
          <td className="px-4 py-3">Vốn chủ sở hữu (ước tính)</td>
          <td className="px-4 py-3 text-right tabular-nums text-primary">
            {formatCurrency(totalAssets - payable)}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function CashFlow({ cashIn, cashOut }: { cashIn: number; cashOut: number }) {
  const diff = cashIn - cashOut
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <SectionHeader>Tổng</SectionHeader>
      </thead>
      <tbody>
        <tr className="bg-muted/30 font-semibold">
          <td className="px-4 py-2">DÒNG TIỀN VÀO</td>
          <td className="px-4 py-2 text-right text-tertiary">{formatCurrency(cashIn)}</td>
        </tr>
        <Row label="Thu từ phiếu thu (đã nhận)" value={cashIn} level={1} sub />
        <tr className="bg-muted/30 font-semibold">
          <td className="px-4 py-2">DÒNG TIỀN RA</td>
          <td className="px-4 py-2 text-right text-error">{formatCurrency(cashOut)}</td>
        </tr>
        <Row label="Chi phí đã thanh toán" value={cashOut} level={1} sub />
        <tr className="border-t-2 border-foreground/40 bg-[#fff4ed] font-bold">
          <td className="px-4 py-3">Chênh lệch dòng tiền</td>
          <td
            className={cn(
              "px-4 py-3 text-right tabular-nums text-base",
              diff >= 0 ? "text-tertiary" : "text-error"
            )}
          >
            {diff < 0 ? `(${formatCurrency(Math.abs(diff))})` : formatCurrency(diff)}
          </td>
        </tr>
      </tbody>
    </table>
  )
}
