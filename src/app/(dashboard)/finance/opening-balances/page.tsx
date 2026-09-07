"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { SegmentedScroller } from "@/components/ui/segmented-scroller"
import { StickyActionBar } from "@/components/ui/sticky-action-bar"
import { useToast } from "@/hooks/use-toast"
import { downloadXlsx } from "@/components/analytics/report-frame"
import { formatCurrency } from "@/lib/utils"
import { Download, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react"
import { columnsFor, type Kind } from "@/lib/opening-balance/schema"
import { buildPlan, type Plan, type PlanAction, type PlanRow } from "@/lib/opening-balance/parse"
import { buildExportRows, formatVnDate } from "@/lib/opening-balance/sheet"
import { readWorkbook } from "@/lib/opening-balance/file"
import { commitPlan, loadForKind, type LoadResult } from "@/lib/opening-balance/io"

const KIND_LABEL: Record<Kind, string> = {
  customer: "Khách hàng",
  supplier: "Nhà cung cấp",
}

const ACTION_LABEL: Record<PlanAction, string> = {
  create: "Tạo mới",
  update: "Cập nhật",
  unchanged: "Không đổi",
  delete: "Xoá",
  skip: "Bỏ qua",
  error: "Lỗi",
}

const ACTION_VARIANT: Record<PlanAction, "default" | "secondary" | "success" | "warning" | "danger"> = {
  create: "success",
  update: "default",
  unchanged: "secondary",
  delete: "danger",
  skip: "secondary",
  error: "danger",
}

/** Chỉ ba nhóm này thực sự ghi xuống DB. */
const WRITING: PlanAction[] = ["create", "update", "delete"]

export default function OpeningBalancesPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const { toast } = useToast()

  const [kind, setKind] = useState<Kind>("customer")
  const [data, setData] = useState<LoadResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [fileName, setFileName] = useState("")
  const [missing, setMissing] = useState<string[]>([])
  const [committing, setCommitting] = useState(false)
  /**
   * Vân tay của kế hoạch NGƯỜI DÙNG ĐÃ XEM. Nút ghi so lại với vân tay
   * hiện tại — nếu file được chọn lại hoặc dữ liệu nền đổi giữa lúc xem
   * và lúc bấm, số liệu sẽ khác và phải xem lại.
   */
  const [reviewed, setReviewed] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const orgId = user?.org_id || ""
  // Công nợ đầu kỳ là việc chốt sổ. RLS ở migration 102 đã chặn NVBH tạo
  // dòng đầu kỳ; kiểm ở đây chỉ để không hiện màn sẽ chắc chắn bị từ chối.
  const canWrite = !!user && ["owner", "accountant"].includes(user.role)

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setData(await loadForKind(kind, orgId))
    } catch (e) {
      toast({ title: "Không nạp được dữ liệu", description: (e as Error).message, variant: "destructive" })
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [kind, orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload() }, [reload])

  /** Đổi tab là bỏ kế hoạch cũ — kế hoạch của khách không áp cho NCC. */
  useEffect(() => {
    setPlan(null)
    setFileName("")
    setMissing([])
    setReviewed(null)
    if (fileRef.current) fileRef.current.value = ""
  }, [kind])

  const handleExport = async () => {
    if (!data) return
    const rows = buildExportRows(kind, data.entities, data.existing)
    const stamp = new Date().toISOString().slice(0, 10)
    await downloadXlsx(`cong-no-dau-ky-${kind === "customer" ? "khach-hang" : "ncc"}-${stamp}`, rows, KIND_LABEL[kind])
  }

  const handleFile = async (file: File) => {
    if (!data) return
    try {
      const read = await readWorkbook(file, kind)
      setFileName(file.name)
      setMissing(read.missing)
      const p = buildPlan(read.rows, data.entities, data.existing)
      setPlan(p)
      setReviewed(null)
    } catch (e) {
      toast({ title: "Không đọc được file", description: (e as Error).message, variant: "destructive" })
    }
  }

  const writingRows = useMemo(
    () => (plan ? plan.rows.filter((r) => WRITING.includes(r.action)) : []),
    [plan]
  )

  const blockReason = !plan
    ? "Chọn file đã điền"
    : writingRows.length === 0
      ? "Không có dòng nào để ghi"
      : !canWrite
        ? "Chỉ chủ DN / kế toán được ghi"
        : reviewed !== plan.fingerprint
          ? "Bấm “Tôi đã xem” trước"
          : null

  const handleCommit = async () => {
    if (!plan || blockReason) return
    setCommitting(true)
    try {
      const r = await commitPlan(kind, orgId, writingRows, data?.primaryRep || {})
      const done = `Tạo ${r.created} • Cập nhật ${r.updated} • Xoá ${r.deleted}`
      if (r.failures.length) {
        toast({
          title: `${done} — ${r.failures.length} dòng lỗi`,
          description: r.failures.slice(0, 3).map((f) => `Dòng ${f.rowNo}: ${f.message}`).join(" | "),
          variant: "destructive",
        })
      } else {
        toast({ title: `Đã ghi. ${done}` })
      }
      setPlan(null)
      setFileName("")
      setReviewed(null)
      if (fileRef.current) fileRef.current.value = ""
      await reload()
    } catch (e) {
      toast({ title: "Lỗi khi ghi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setCommitting(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const totalOpening = data ? data.existing.reduce((s, e) => s + e.amount, 0) : 0

  return (
    <div className="space-y-4 pb-nav-action lg:pb-0">
      <PageHeader
        title="Công nợ đầu kỳ"
        description="Số dư mang sang từ sổ cũ. Tải danh sách ra Excel, điền cột công nợ, rồi nhập lại."
        backHref="/receivables"
      />

      <SegmentedScroller
        segments={(["customer", "supplier"] as Kind[]).map((k) => ({ key: k, label: KIND_LABEL[k] }))}
        value={kind}
        onChange={(k) => k && setKind(k as Kind)}
        ariaLabel="Chọn loại công nợ đầu kỳ"
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : !data ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Bước 1 — Tải danh sách {KIND_LABEL[kind].toLowerCase()} ra Excel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  <strong>{data.entities.length}</strong> {KIND_LABEL[kind].toLowerCase()}
                </span>
                <span aria-hidden className="text-on-surface-variant">•</span>
                <span>
                  Đã có đầu kỳ: <strong>{data.existing.length}</strong> ({formatCurrency(totalOpening)})
                </span>
              </div>
              {data.truncated && (
                <p className="flex items-start gap-1.5 text-xs font-semibold text-error">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Danh sách chạm trần nạp — file xuất ra KHÔNG đủ. Báo lại để nâng trần trước khi nhập.
                </p>
              )}
              <Button onClick={handleExport} className="tap h-11">
                <Download className="mr-2 h-4 w-4" /> Tải file Excel
              </Button>
              <div className="rounded-lg bg-surface-container p-3 text-xs">
                <p className="mb-1.5 font-semibold">Các cột trong file</p>
                <ul className="space-y-1">
                  {columnsFor(kind).map((c) => (
                    <li key={c.key}>
                      <span className="font-mono font-semibold">{c.header}</span>
                      <span className="text-on-surface-variant"> — {c.hint}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bước 2 — Nhập file đã điền</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="tap flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant text-sm font-semibold">
                <Upload className="h-4 w-4" />
                {fileName || "Chọn file .xlsx hoặc .csv"}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </label>

              {missing.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs font-semibold text-error">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Không thấy cột: {missing.join(", ")}. Dòng nào cần cột đó sẽ báo lỗi.
                </p>
              )}

              {plan && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(ACTION_LABEL) as PlanAction[]).map((a) =>
                      plan.counts[a] > 0 ? (
                        <Badge key={a} variant={ACTION_VARIANT[a]}>
                          {ACTION_LABEL[a]}: {plan.counts[a]}
                        </Badge>
                      ) : null
                    )}
                  </div>

                  {/* Vân tay kế hoạch: người ta xem con số nào thì ghi đúng
                      con số đó. Đổi file giữa chừng là vân tay đổi và nút
                      ghi khoá lại. */}
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-container p-3">
                    <span className="text-xs text-on-surface-variant">
                      Vân tay kế hoạch: <span className="font-mono font-bold">{plan.fingerprint}</span>
                    </span>
                    <Button
                      type="button"
                      variant={reviewed === plan.fingerprint ? "default" : "outline"}
                      className="tap ml-auto h-11"
                      onClick={() => setReviewed(plan.fingerprint)}
                      disabled={writingRows.length === 0}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {reviewed === plan.fingerprint ? "Đã xem" : "Tôi đã xem"}
                    </Button>
                  </div>

                  <PlanTable rows={plan.rows} />
                </>
              )}

              {!plan && (
                <p className="flex items-center gap-2 py-6 text-center text-sm text-on-surface-variant">
                  <FileSpreadsheet className="h-4 w-4" />
                  Chưa có file. Không có gì được ghi cho tới khi bạn xem bảng và bấm ghi.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="hidden lg:flex justify-end">
            <Button
              onClick={handleCommit}
              disabled={committing || !!blockReason}
              title={blockReason || undefined}
            >
              {committing ? "Đang ghi..." : blockReason || `Ghi ${writingRows.length} dòng`}
            </Button>
          </div>
          <StickyActionBar>
            <Button
              className="h-12 flex-1"
              onClick={handleCommit}
              disabled={committing || !!blockReason}
              title={blockReason || undefined}
            >
              {committing ? "Đang ghi..." : blockReason || `Ghi ${writingRows.length} dòng`}
            </Button>
          </StickyActionBar>
        </>
      )}
    </div>
  )
}

/** Bảng xem trước. Lỗi lên đầu — đó là thứ cần sửa trước khi ghi. */
function PlanTable({ rows }: { rows: PlanRow[] }) {
  const ordered = useMemo(() => {
    const rank: Record<PlanAction, number> = {
      error: 0, delete: 1, create: 2, update: 3, unchanged: 4, skip: 5,
    }
    return [...rows].sort((a, b) => rank[a.action] - rank[b.action] || a.rowNo - b.rowNo)
  }, [rows])
  const [showAll, setShowAll] = useState(false)
  // Trần 200 dòng: bảng 4.000 dòng làm treo trình duyệt trên điện thoại.
  const shown = showAll ? ordered : ordered.slice(0, 200)

  if (!rows.length) return <p className="py-4 text-sm text-on-surface-variant">File không có dòng dữ liệu nào.</p>

  return (
    <div className="space-y-2">
      <div className="max-h-[420px] overflow-auto rounded-lg border border-outline-variant">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-container text-xs uppercase tracking-wider text-on-surface-variant">
            <tr>
              <th className="px-2 py-2 text-left">Dòng</th>
              <th className="px-2 py-2 text-left">Việc</th>
              <th className="px-2 py-2 text-left">Tên</th>
              <th className="px-2 py-2 text-right">Số tiền</th>
              <th className="px-2 py-2 text-left">Ghi chú / lý do</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.rowNo}-${r.action}`} className="border-t border-outline-variant/60">
                <td className="px-2 py-1.5 tabular-nums text-on-surface-variant">{r.rowNo}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={ACTION_VARIANT[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                </td>
                <td className="max-w-[220px] truncate px-2 py-1.5">{r.label}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {/* Update thì hiện CŨ → MỚI. Chỉ hiện số mới thì người
                      xem không biết mình đang đổi cái gì thành cái gì. */}
                  {r.before && r.action !== "delete" && r.before.amount !== r.amount ? (
                    <span className="text-on-surface-variant">
                      {formatCurrency(r.before.amount)} →{" "}
                      <span className="font-bold text-on-surface">{formatCurrency(r.amount || 0)}</span>
                    </span>
                  ) : r.action === "delete" ? (
                    <span className="text-error line-through">{formatCurrency(r.before?.amount || 0)}</span>
                  ) : r.amount !== undefined ? (
                    <span className="font-semibold">{formatCurrency(r.amount)}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-on-surface-variant">
                  {r.message ||
                    [r.dueDate ? `hạn ${formatVnDate(r.dueDate)}` : "", r.note || ""]
                      .filter(Boolean)
                      .join(" • ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ordered.length > shown.length && (
        <Button variant="outline" className="tap h-11 w-full" onClick={() => setShowAll(true)}>
          Xem hết {ordered.length} dòng (đang hiện {shown.length})
        </Button>
      )}
    </div>
  )
}
