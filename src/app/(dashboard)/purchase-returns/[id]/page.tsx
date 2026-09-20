"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { Send, Trash2, ExternalLink, Pencil, XCircle } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ratioToPercent } from "@/lib/purchasing/return-form"
import type { SupplierReturn, SupplierReturnLine, Supplier, Product } from "@/types"
import { errorMessage } from "@/lib/errors"

const STATUS_LABEL: Record<string, { label: string; variant: "secondary" | "success" | "warning" }> = {
  draft: { label: "Nháp", variant: "warning" },
  completed: { label: "Đã gửi", variant: "success" },
  cancelled: { label: "Đã huỷ", variant: "secondary" },
}

const ZONE_LABEL: Record<string, string> = {
  sale: "Kho hàng bán",
  date: "Kho hàng date (gần hạn)",
}

const REASON_LABEL: Record<string, string> = {
  near_expiry: "Hàng gần hạn",
  expired: "Hàng hết hạn",
  damaged: "Hàng hư hỏng",
  wrong_item: "Sai hàng",
  other: "Khác",
}

interface LineRow extends Omit<SupplierReturnLine, "product"> {
  product?: Pick<Product, "id" | "name" | "sku" | "base_unit"> | undefined
}

type Detail = Omit<SupplierReturn, "supplier" | "lines"> & {
  supplier?: Pick<Supplier, "id" | "name" | "code"> | undefined
  lines?: LineRow[]
}

export default function PurchaseReturnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { loading: authLoading } = useRoleGuard("inventory")
  const supabase = createClient()
  const { toast } = useToast()
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [hdrRes, lineRes] = await Promise.all([
      supabase
        .from("supplier_returns")
        .select("id, return_code, return_date, reason, notes, discount, vat_override, subtotal, vat, total, status, warehouse_zone, stock_entry_id, payable_credit_id, completed_at, cancel_reason, created_at, supplier:suppliers(id, name, code)")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("supplier_return_lines")
        .select("id, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, line_total, notes, sort_order, product:products(id, name, sku, base_unit)")
        .eq("return_id", id)
        /* ⚠ THEO `sort_order`, KHÔNG THEO `created_at`. Sửa phiếu là xoá
           hết dòng rồi ghi lại trong một lượt — mọi dòng cùng một mốc
           thời gian, và tờ in mỗi lần một thứ tự. */
        .order("sort_order"),
    ])
    const qErr = ([hdrRes, lineRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[purchase-returns/id] truy vấn lỗi:", qErr.message)
    if (hdrRes.data) {
      const hdr = hdrRes.data as unknown as Detail
      hdr.lines = (lineRes.data as unknown as LineRow[]) || []
      setData(hdr)
    } else {
      setData(null)
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const handleSend = async () => {
    if (!data) return
    if (!window.confirm("Gửi phiếu trả NCC?\n\nHệ thống sẽ xuất kho theo FIFO trong zone đã chọn và tạo credit memo giảm công nợ NCC. Sau khi gửi không thể sửa.")) {
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.rpc("complete_supplier_return", { p_return_id: data.id })
      if (error) throw new Error(error.message)
      toast({ title: "Đã gửi phiếu — xuất kho + giảm công nợ NCC" })
      await load()
    } catch (err) {
      toast({ title: "Lỗi", description: friendlyError(errorMessage(err)), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  /**
   * HUỶ PHIẾU ĐÃ GỬI — đảo ngược qua RPC (migration 143).
   *
   * ⚠ KHÔNG TỰ CỘNG HÀNG VỀ KHO Ở ĐÂY. `cancel_supplier_return` cộng
   *   trả về ĐÚNG lô đã lấy — kể cả hạn dùng và giá vốn của từng lô —
   *   rồi xoá khoản giảm công nợ, trong một giao dịch. Cộng ở trình
   *   duyệt là đi tìm lô theo FIFO lần nữa, và hàng về một lô KHÁC với
   *   hạn khác: tồn thì đúng mà hạn thì sai.
   */
  const handleCancel = async () => {
    if (!data) return
    const done = data.status === "completed"
    if (!window.confirm(
      done
        ? "Huỷ phiếu trả NCC?\n\nHàng sẽ cộng trả về đúng lô đã lấy và khoản giảm công nợ NCC bị xoá. Không huỷ được nếu NCC đã cấn trừ tiền hoặc lô đã đóng."
        : "Huỷ phiếu nháp này?\n\nPhiếu nháp chưa đụng tới kho hay công nợ."
    )) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc("cancel_supplier_return", {
        p_return_id: data.id, p_reason: "Người dùng huỷ từ màn chi tiết",
      })
      if (error) throw new Error(error.message)
      toast({ title: done ? "Đã huỷ phiếu — kho và công nợ đã hoàn về" : "Đã huỷ phiếu nháp" })
      await load()
    } catch (err) {
      toast({ title: "Không huỷ được", description: friendlyError(errorMessage(err)), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!data) return
    if (!window.confirm("Xoá phiếu nháp này?")) return
    setBusy(true)
    try {
      const { error } = await supabase.from("supplier_returns").delete().eq("id", data.id)
      if (error) throw new Error(error.message)
      toast({ title: "Đã xoá phiếu nháp" })
      router.push("/purchase-returns")
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!data) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy phiếu</div>

  const st = STATUS_LABEL[data.status] || STATUS_LABEL.draft
  const isDraft = data.status === "draft"
  const lines = data.lines || []

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Phiếu trả NCC ${data.return_code || "(nháp)"}`}
        description={`${data.supplier?.name || "—"} · ${formatDate(data.return_date)}`}
        backHref="/purchase-returns"
      >
        <Badge variant={st.variant}>{st.label}</Badge>
        {isDraft && (
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/purchase-returns/${data.id}/edit`}>
                <Pencil className="h-4 w-4 mr-1.5" /> Sửa
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={busy}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Xoá nháp
            </Button>
            <Button size="sm" onClick={handleSend} disabled={busy || lines.length === 0}>
              <Send className="h-4 w-4 mr-1.5" />
              {busy ? "Đang gửi..." : "Gửi phiếu"}
            </Button>
          </>
        )}
        {/* ⚠ PHIẾU ĐÃ GỬI VẪN SỬA VÀ HUỶ ĐƯỢC (chủ nhà chốt 20/09/2026:
            "Tương tự phiếu trả hàng cũng vậy"). Trước đây gửi xong là
            phiếu đóng cứng — gửi nhầm một phiếu là hàng đã ra khỏi kho,
            công nợ đã giảm, và không có đường nào quay lại ngoài sửa
            tay trong cơ sở dữ liệu. */}
        {data.status === "completed" && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/purchase-returns/${data.id}/edit`}>
              <Pencil className="h-4 w-4 mr-1.5" /> Sửa phiếu
            </Link>
          </Button>
        )}
        {data.status !== "cancelled" && (
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={busy}>
            <XCircle className="h-4 w-4 mr-1.5" /> Huỷ phiếu
          </Button>
        )}
      </PageHeader>

      {data.status === "cancelled" && (
        <div className="rounded-xl border border-outline-variant bg-muted/40 px-3.5 py-3 text-sm">
          <span className="font-semibold">Phiếu đã huỷ.</span>{" "}
          {/* ⚠ LÝ DO HUỶ PHẢI HIỆN RA — không hiện thì người mở lại chỉ
              thấy một chứng từ chết mà không biết vì sao. */}
          {data.cancel_reason || "Không ghi lý do."}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Thông tin chung</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Nhà cung cấp" value={data.supplier?.name || "—"} />
            <Info label="Mã phiếu" value={data.return_code || "(chưa sinh — sẽ tạo khi gửi)"} mono />
            <Info label="Ngày trả" value={formatDate(data.return_date)} />
            <Info label="Xuất từ kho" value={ZONE_LABEL[data.warehouse_zone] || data.warehouse_zone} />
            <Info label="Lý do" value={data.reason ? REASON_LABEL[data.reason] || data.reason : "—"} />
            <Info label="Ngày tạo" value={formatDate(data.created_at)} />
            {data.completed_at && (
              <Info label="Ngày gửi" value={formatDate(data.completed_at)} />
            )}
            {data.notes && (
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</p>
                <p className="whitespace-pre-wrap">{data.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tổng tiền</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Tổng hàng (chưa VAT)" value={formatCurrency(data.subtotal)} />
            <Row label="VAT" value={formatCurrency(data.vat)} />
            {/* ⚠ GIẢM GIÁ TRỪ SAU THUẾ (mig 146) — hiện nó DƯỚI dòng thuế
                để thứ tự đọc đúng bằng thứ tự trong phép tính. */}
            {Number(data.discount) > 0 && (
              <Row label="Giảm giá cả phiếu" value={`−${formatCurrency(data.discount)}`} />
            )}
            <div className="flex justify-between pt-2 border-t font-bold">
              <span>NCC hoàn lại</span>
              <span className="text-primary tabular-nums">{formatCurrency(data.total)}</span>
            </div>
            {data.status === "completed" && (
              <p className="text-[11px] text-muted-foreground pt-2">
                Đã giảm công nợ NCC số tiền {formatCurrency(data.total)}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Chi tiết hàng trả</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {lines.length === 0 ? (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">Chưa có dòng hàng</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">STT</th>
                  <th className="px-3 py-2 text-left">Sản phẩm</th>
                  <th className="px-3 py-2 text-left">Ghi chú</th>
                  <th className="px-3 py-2 text-left">ĐVT</th>
                  <th className="px-3 py-2 text-right">SL</th>
                  <th className="px-3 py-2 text-right">Đơn giá</th>
                  <th className="px-3 py-2 text-right">Giảm giá</th>
                  <th className="px-3 py-2 text-right">VAT %</th>
                  <th className="px-3 py-2 text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.product?.name || "—"}</div>
                      {l.product?.sku && (
                        <div className="text-[11px] text-muted-foreground">{l.product.sku}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{l.notes || "—"}</td>
                    <td className="px-3 py-2">
                      {l.unit_name}
                      {Number(l.conversion_factor) > 1 ? (
                        <span className="text-[11px] text-muted-foreground"> (×{l.conversion_factor})</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.unit_price)}</td>
                    {/* ⚠ CỘT NÀY LÀ SỐ TIỀN, không phải phần trăm — biểu
                        mẫu quy ra tiền trước khi ghi xuống. */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(l.line_discount) > 0 ? formatCurrency(l.line_discount) : "—"}
                    </td>
                    {/* ⚠ CỘT `vat_rate` LÀ TỈ LỆ (mig 141) — in thẳng nó
                        rồi dán dấu % vào là hiện "0.1%" cho một dòng
                        thuế 10%. Quy đổi bằng đúng hàm mà biểu mẫu dùng. */}
                    <td className="px-3 py-2 text-right tabular-nums">{ratioToPercent(l.vat_rate)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {data.status === "completed" && (
        <Card>
          <CardHeader><CardTitle>Liên kết sau khi gửi</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.stock_entry_id && (
              <Link
                href={`/inventory/entries/${data.stock_entry_id}`}
                className="flex items-center gap-2 text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Phiếu xuất kho liên quan
              </Link>
            )}
            {data.payable_credit_id && (
              <Link
                href={`/payables/${data.payable_credit_id}`}
                className="flex items-center gap-2 text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Bút toán giảm công nợ NCC
              </Link>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono" : ""}>{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function friendlyError(msg: string): string {
  if (msg.includes("INSUFFICIENT_STOCK")) {
    const parts = msg.split("|").map((s) => s.trim())
    if (parts.length > 1) {
      return `Không đủ tồn để xuất — ${parts.slice(1).join(" · ")}. Đổi kho khác hoặc giảm số lượng / nhập đủ rồi gửi lại.`
    }
    return "Không đủ tồn kho trong kho đã chọn để xuất. Kiểm tra số lượng / chọn kho khác."
  }
  if (msg.includes("RETURN_HAS_NO_LINES")) return "Phiếu chưa có dòng hàng."
  if (msg.includes("RETURN_NOT_DRAFT")) return "Phiếu không ở trạng thái nháp."
  if (msg.includes("ORG_MISMATCH")) return "Không có quyền cho tổ chức này."
  return msg
}
