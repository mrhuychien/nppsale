"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchSelect } from "@/components/ui/search-select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { RETURN_REASONS } from "@/lib/constants"
import { Pencil, Trash2, X, ExternalLink, Info, PackageCheck, Ban } from "lucide-react"
import {
  completeReturn,
  cancelReturn,
  RETURN_ZONES,
  type ReturnZone,
} from "@/lib/returns/complete-return"
import type { Return, ReturnLine } from "@/types"
import { errorMessage } from "@/lib/errors"

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("returns")
  const [ret, setRet] = useState<Return | null>(null)
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ notes: "", credit_note_amount: "" })
  const [actionLoading, setActionLoading] = useState(false)
  /** Kho nhận hàng trả — người duyệt phải chọn, không đoán hộ. */
  const [zone, setZone] = useState<ReturnZone>("sale")
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  /**
   * Nhân viên phiếu này TÍNH CHO (mig 160) — khác `requester`, người GÕ.
   *
   * ⚠ HỎI RIÊNG MỘT CÂU, KHÔNG NHÉT VÀO CÂU LỚN Ở TRÊN. Mã nguồn lên
   *   trước migration là chuyện thường ở đây; nhét vào là cột chưa có
   *   thì CẢ màn chi tiết phiếu trả trắng bóc. Hỏi riêng thì hỏng riêng.
   *
   * ⚠ `coCot === false` NGHĨA LÀ CHƯA CHẠY MIG 160 — khác hẳn "chưa gán".
   *   Chưa có cột mà vẫn vẽ ô chọn là mời người ta bấm một cái nút mà
   *   máy chủ chắc chắn từ chối.
   */
  const [salesUserId, setSalesUserId] = useState<string | null>(null)
  const [salesUserName, setSalesUserName] = useState<string | null>(null)
  const [coCotNguoiDungTen, setCoCotNguoiDungTen] = useState(false)
  const [sellers, setSellers] = useState<Array<{ id: string; full_name: string; role: string }>>([])
  const [doiNguoiDungTen, setDoiNguoiDungTen] = useState(false)
  const [nguoiDungTenMoi, setNguoiDungTenMoi] = useState("")
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [retRes, linesRes, nguoiRes] = await Promise.all([
      supabase
        .from("returns")
        .select(
          /*
           * ⚠ ĐỌC CẢ HÓA ĐƠN BÁN, KHÔNG CHỈ ĐƠN HÀNG. Phiếu trả TỰ SINH
           *   (đơn có hàng đổi/trả kèm) được `post_invoice` gắn
           *   `invoice_id` lúc xuất hàng — mig 125. Cái mốc ấy có thật
           *   trong sổ nhưng chưa từng hiện ra màn nào, nên người đối
           *   chiếu không biết khoản trừ này thuộc tờ hóa đơn nào.
           *
           * ⚠ ĐƠN VÀ HÓA ĐƠN LÀ HAI MỐC KHÁC NHAU, giữ cả hai. Một đơn
           *   giao nhiều đợt có nhiều hóa đơn; chỉ hiện mã đơn là người
           *   ta phải tự đoán đợt nào.
           */
          "id, order_id, invoice_id, reason, status, credit_note_amount, photo_url, notes, created_at, destination_zone, completed_at, cancel_reason, applied_receipt_id, customer:customers(*), requester:users!returns_requested_by_fkey(*), approver:users!returns_approved_by_fkey(*), order:sales_orders(order_code), invoice:sales_invoices(invoice_code, invoice_date)"
        )
        .eq("id", id)
        .single(),
      supabase.from("return_lines").select("id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange, product:products(*)").eq("return_id", id),
      supabase
        .from("returns")
        .select("sales_user_id, seller:users!returns_sales_user_id_fkey(id, full_name)")
        .eq("id", id)
        .maybeSingle(),
    ])
    const qErr = ([retRes, linesRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[returns/id] truy vấn lỗi:", qErr.message)
    if (retRes.data) {
      const r = retRes.data as unknown as Return
      setRet(r)
      setEditForm({
        notes: r.notes || "",
        credit_note_amount: r.credit_note_amount != null ? String(r.credit_note_amount) : "",
      })
    }
    setLines((linesRes.data as unknown as ReturnLine[]) || [])
    if (nguoiRes.error) {
      // Chưa chạy mig 160 — giấu hẳn khối "tính cho nhân viên" đi.
      setCoCotNguoiDungTen(false)
    } else {
      const n = nguoiRes.data as unknown as {
        sales_user_id: string | null
        seller: { id: string; full_name: string } | null
      } | null
      setCoCotNguoiDungTen(true)
      setSalesUserId(n?.sales_user_id ?? null)
      setSalesUserName(n?.seller?.full_name ?? null)
      setNguoiDungTenMoi(n?.sales_user_id ?? "")
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  /**
   * ⚠ CHỈ CHỦ NHÀ / QUẢN LÝ ĐỔI ĐƯỢC NGƯỜI ĐỨNG TÊN — y như lúc lập
   *   phiếu. Trigger mig 160 canh cả `UPDATE OF sales_user_id`, nên nhân
   *   viên bấm cũng bị máy chủ từ chối; giấu ô đi là để họ không phải
   *   gặp một lời từ chối không hiểu vì sao.
   */
  const canPickSeller = user?.role === "owner" || user?.role === "manager"

  useEffect(() => {
    if (!canPickSeller || !coCotNguoiDungTen || !user?.org_id) return
    let cancelled = false
    createClient()
      .from("users")
      .select("id, full_name, role")
      .eq("org_id", user.org_id)
      /* Đúng bộ vai trò trigger cho phép — hiện tên mà máy chủ từ chối
         là bẫy người dùng. */
      .in("role", ["sales", "manager", "owner"])
      .order("full_name")
      .then(({ data }) => {
        if (!cancelled) {
          setSellers((data as Array<{ id: string; full_name: string; role: string }>) || [])
        }
      })
    return () => {
      cancelled = true
    }
  }, [canPickSeller, coCotNguoiDungTen, user?.org_id])

  const sellerOptions = useMemo(
    () =>
      sellers.map((u) => ({
        id: u.id,
        label: u.full_name || "(chưa đặt tên)",
        hint: u.id === user?.id ? "chính bạn" : u.role,
      })),
    [sellers, user?.id]
  )

  /**
   * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Không đếm dòng thì
   *   màn hiện "Đã đổi" trong khi cột trong sổ không nhúc nhích.
   *
   * ⚠ ĐỔI XONG ĐỌC LẠI TỪ SỔ, đừng vá state bằng thứ vừa gửi đi. Trigger
   *   có quyền điền khác: để trống thì nó tự lấy nhân viên của đơn gốc.
   */
  const luuNguoiDungTen = async () => {
    if (!ret) return
    setActionLoading(true)
    try {
      const { data, error } = await supabase
        .from("returns")
        .update({ sales_user_id: nguoiDungTenMoi || null })
        .eq("id", ret.id)
        .select("id")
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error("Không đổi được người đứng tên — bạn không có quyền trên phiếu này.")
      }
      setDoiNguoiDungTen(false)
      await fetchData()
      toast({ title: "Đã đổi người đứng tên phiếu" })
    } catch (err) {
      toast({ title: "Không đổi được", description: errorMessage(err), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  /**
   * ⚠ BẢNG `returns` KHÔNG CÓ MỘT POLICY DELETE NÀO (002_rls_policies chỉ
   * tạo SELECT / INSERT / UPDATE). Nghĩa là lệnh xoá dưới đây LUÔN xoá 0
   * dòng, PostgREST trả HTTP 200 và `error` là null — bản trước báo "Đã
   * xoá phiếu trả hàng" rồi đẩy người dùng về danh sách, nơi phiếu vẫn
   * nằm nguyên đó. Kiểm số dòng là cách duy nhất biết được.
   */
  const handleDelete = async () => {
    if (!ret) return
    setActionLoading(true)
    try {
      const { data, error } = await supabase
        .from("returns")
        .delete()
        .eq("id", ret.id)
        .select("id")
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          "Không xoá được phiếu trả — bạn không có quyền xoá phiếu trả. Nếu phiếu lập nhầm, dùng nút Huỷ phiếu."
        )
      }
      toast({ title: "Đã xoá phiếu trả hàng" })
      router.push("/returns")
    } catch (error) {
      toast({ title: "Không xoá được", description: errorMessage(error), variant: "destructive" })
      setActionLoading(false)
    }
  }

  /**
   * HOÀN THÀNH PHIẾU TRẢ — nhập kho + giảm công nợ, một giao dịch.
   *
   * ⚠ ĐI QUA RPC, KHÔNG GHI THẲNG. Migration 120 đã gỡ trigger tự nhập
   * kho, nên đặt `status = 'completed'` bằng một lệnh UPDATE chỉ làm
   * phiếu TRÔNG như đã xong: hàng không vào tồn, công nợ không giảm, và
   * không ai quay lại xử lý nó nữa.
   */
  const handleComplete = async () => {
    if (!ret || actionLoading) return
    setActionLoading(true)
    try {
      await completeReturn(supabase, ret.id, zone)
      toast({
        title: "Đã hoàn thành phiếu trả",
        description: `Hàng đã nhập ${zone === "sale" ? "kho bán" : "kho cận date"}; công nợ đã trừ.`,
      })
      fetchData()
    } catch (err) {
      toast({ title: "Không hoàn thành được", description: errorMessage(err), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  /**
   * HUỶ PHIẾU TRẢ. Phiếu còn ở Phiếu tạm thì chỉ đổi trạng thái; phiếu ĐÃ
   * hoàn thành thì RPC đảo kho và tính lại công nợ — và từ chối nếu khoản
   * có đã cấn trừ vào một phiếu thu.
   */
  const handleCancel = async () => {
    if (!ret || actionLoading) return
    const reason = cancelReason.trim()
    if (!reason) {
      toast({ title: "Phải ghi lý do huỷ", variant: "destructive" })
      return
    }
    setActionLoading(true)
    try {
      await cancelReturn(supabase, ret.id, reason)
      toast({ title: "Đã huỷ phiếu trả" })
      setCancelOpen(false)
      setCancelReason("")
      fetchData()
    } catch (err) {
      toast({ title: "Không huỷ được", description: errorMessage(err), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!ret) return
    setActionLoading(true)
    try {
      /**
       * ⚠ POLICY UPDATE CỦA `returns` CHỈ MỞ CHO OWNER / MANAGER, trong
       * khi nút Sửa bật theo `returns.update` — mà bảng phân quyền cấp ô
       * đó cho cả thủ kho. Thủ kho bấm Lưu thì RLS từ chối bằng 0 dòng,
       * HTTP 200, `error` null: màn báo "Đã cập nhật" rồi tải lại và số
       * cũ hiện về.
       *
       * ⚠ VÀ KHÔNG SỬA SỐ TIỀN CỦA PHIẾU ĐÃ HOÀN THÀNH. Công nợ chỉ được
       * tính lại bên trong RPC; sửa tay ở đây là `receivables` và
       * `returns` lệch nhau vĩnh viễn, không lệnh nào kéo về được.
       */
      const patch: Record<string, unknown> = { notes: editForm.notes || null }
      if (ret.status !== "completed") {
        patch.credit_note_amount = editForm.credit_note_amount
          ? parseFloat(editForm.credit_note_amount)
          : null
      }
      const { data, error } = await supabase
        .from("returns")
        .update(patch)
        .eq("id", ret.id)
        .select("id")
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          "Không lưu được — bạn không có quyền sửa phiếu trả. Tải lại trang để xem bản mới nhất."
        )
      }
      toast({ title: "Đã cập nhật phiếu trả hàng" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: errorMessage(error), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!ret) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy phiếu trả hàng</div>

  const reasonLabel = RETURN_REASONS.find((r) => r.value === ret.reason)?.label || ret.reason || "—"
  const orderCode = (ret as Return & { order?: { order_code?: string } }).order?.order_code
  const inv = (ret as Return & {
    invoice_id?: string | null
    invoice?: { invoice_code?: string; invoice_date?: string } | null
  })
  // Phiếu trả giờ chỉ là bản ghi tra cứu — không còn workflow duyệt.
  // Cho phép sửa ghi chú / credit note + (owner) xoá.
  const canEdit = !!user && hasPermission(user.role, "returns", "update")
  /**
   * ⚠ TÊN QUYỀN PHẢI KHỚP THỨ RPC KIỂM. `complete_return` và
   * `cancel_return` đều hỏi `returns.approve` (migration 120) — gài màn
   * hình bằng một quyền khác là nút hiện ra rồi RPC ném FORBIDDEN.
   */
  const canApprove = !!user && hasPermission(user.role, "returns", "approve")
  const canDelete = !!user && user.role === "owner"

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Phiếu trả — ${ret.customer?.store_name || "N/A"}`}
        description={`Tạo: ${formatDate(ret.created_at)} • Lý do: ${reasonLabel}`}
        backHref="/returns"
      >
        <StatusBadge status={ret.status} type="return" />
      </PageHeader>

      {/* ⚠ KHỐI NÀY TỪNG NÓI "nhập kho đã xử lý ở bước Bàn giao lại từ lái
          xe" — đúng với luồng cũ, sai hẳn với v2. Trong v2 không có bước
          bàn giao nào, và `complete_return` là đường DUY NHẤT nhập kho. */}
      {ret.status === "submitted" && (
        <Card className="border-[#fdb022]/40 bg-[#fff7e6]">
          <CardContent className="grid gap-3 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#b54708]" />
              <p className="text-xs font-semibold text-[#b54708]">
                Hàng CHƯA vào kho và công nợ CHƯA giảm. Cả hai chỉ xảy ra khi bấm Hoàn thành.
              </p>
            </div>
            {canApprove && (
              <>
                {/* ⚠ KHO NHẬN LÀ QUYẾT ĐỊNH CỦA NGƯỜI DUYỆT, không đoán hộ:
                    hàng còn bán được thì về kho bán, cận hạn hoặc cần xử lý
                    riêng thì về kho cận date. Chọn nhầm là hoặc đem hàng
                    cận hạn bán tiếp, hoặc chôn hàng còn tốt. */}
                <div className="grid gap-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Nhập về kho nào
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {RETURN_ZONES.map((z) => (
                      <button
                        key={z.value}
                        type="button"
                        onClick={() => setZone(z.value)}
                        aria-pressed={zone === z.value}
                        className={`rounded-xl border-[1.5px] px-3 py-2 text-left text-xs font-bold transition-colors ${
                          zone === z.value
                            ? "border-[#b54708] bg-white text-[#b54708]"
                            : "border-outline-variant bg-white/60 text-muted-foreground hover:bg-white"
                        }`}
                      >
                        <span className="block">{z.label}</span>
                        <span className="block font-semibold opacity-70">{z.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleComplete} disabled={actionLoading}>
                    <PackageCheck className="mr-2 h-4 w-4" />
                    {actionLoading ? "Đang xử lý…" : "Hoàn thành — nhập kho & trừ công nợ"}
                  </Button>
                  <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={actionLoading}>
                    <Ban className="mr-2 h-4 w-4" /> Huỷ phiếu
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {ret.status === "completed" && (
        <Card className="border-tertiary/30 bg-[#ecfdf3]">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Info className="h-4 w-4 shrink-0 text-tertiary" />
            <p className="min-w-0 flex-1 text-xs font-semibold text-tertiary">
              Đã nhập kho{ret.destination_zone ? ` (${ret.destination_zone === "sale" ? "kho bán" : "kho cận date"})` : ""} và
              đã trừ công nợ.
              {!ret.order_id &&
                " Phiếu không gắn đơn nào — khoản có này đem cấn trừ ở màn Phiếu thu."}
            </p>
            {canApprove && (
              <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)} disabled={actionLoading}>
                <Ban className="mr-2 h-4 w-4" /> Huỷ phiếu
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {ret.status === "cancelled" && (
        <Card className="border-outline-variant bg-surface-container-low">
          <CardContent className="flex items-start gap-3 p-4 text-xs font-semibold text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Phiếu đã huỷ. Kho và công nợ đã được trả về như trước.
              {ret.cancel_reason ? ` Lý do: ${ret.cancel_reason}` : ""}
            </span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details + lines */}
        <div className="lg:col-span-2 space-y-4">
          {/* Lines */}
          <Card>
            <CardHeader><CardTitle>Chi tiết hàng trả</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Loại</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>ĐVT</TableHead>
                      <TableHead className="text-right tabular-nums">SL</TableHead>
                      <TableHead className="text-right tabular-nums">Đơn giá</TableHead>
                      <TableHead className="text-right tabular-nums">VAT</TableHead>
                      <TableHead className="text-right tabular-nums">Thành tiền</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => {
                      const isExchange = !!(line as { is_exchange?: boolean | null }).is_exchange
                      return (
                        <TableRow key={line.id} className={isExchange ? "bg-[#eff8ff]/40" : undefined}>
                          <TableCell>
                            {isExchange ? (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#eff8ff] text-[#175cd3] border border-[#175cd3]/40">
                                ĐỔI
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fff4ed] text-[#b54708] border border-[#fdb022]/40">
                                TRẢ
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{line.product?.name || "—"}</TableCell>
                          <TableCell>{line.unit_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(line.unit_price)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {Math.round((line.vat_rate ?? 0) * 100)}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {isExchange ? (
                              <span className="text-[#175cd3] italic">không trừ tiền</span>
                            ) : (
                              formatCurrency(line.line_total)
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {lines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                          Chưa có sản phẩm trả
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {(() => {
                const refundT = lines
                  .filter((l) => !(l as { is_exchange?: boolean | null }).is_exchange)
                  .reduce((s, l) => s + Number(l.line_total || 0), 0)
                const exchangeT = lines
                  .filter((l) => (l as { is_exchange?: boolean | null }).is_exchange)
                  .reduce((s, l) => s + Number(l.line_total || 0), 0)
                if (lines.length === 0 && ret.credit_note_amount == null) return null
                return (
                  <div className="mt-4 text-right border-t border-border/40 pt-4 space-y-1">
                    {refundT > 0 && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Trả trừ công nợ:</span>{" "}
                        <span className="font-semibold">{formatCurrency(refundT)}</span>
                      </p>
                    )}
                    {exchangeT > 0 && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Đổi (không trừ công nợ):</span>{" "}
                        <span className="font-semibold text-[#175cd3]">
                          {formatCurrency(exchangeT)}
                        </span>
                      </p>
                    )}
                    <p className="text-lg font-black">
                      Credit Note: {formatCurrency(ret.credit_note_amount ?? refundT)}
                    </p>
                    {refundT > 0 && exchangeT > 0 && (
                      <p className="text-[11px] italic text-muted-foreground">
                        * Chỉ phần TRẢ trừ công nợ; phần ĐỔI thu về kho mà không động đến tiền.
                      </p>
                    )}
                  </div>
                )
              })()}
            </CardContent>
          </Card>

          {/* Edit panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin phiếu trả</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditForm({
                    notes: ret.notes || "",
                    credit_note_amount: ret.credit_note_amount != null ? String(ret.credit_note_amount) : "",
                  })
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!editMode ? (
                <>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Credit Note</Label>
                    <p className="font-semibold">
                      {ret.credit_note_amount != null ? formatCurrency(ret.credit_note_amount) : <span className="text-muted-foreground">Chưa xác định</span>}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                    <p className="whitespace-pre-wrap">{ret.notes || <span className="text-muted-foreground">Không có</span>}</p>
                  </div>
                  {ret.photo_url && (
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hình ảnh</Label>
                      <Link href={ret.photo_url} target="_blank" className="block text-primary hover:underline">
                        Xem ảnh đính kèm
                      </Link>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* ⚠ PHIẾU ĐÃ HOÀN THÀNH THÌ KHOÁ SỐ TIỀN. Công nợ chỉ được
                      tính lại bên trong RPC; sửa tay ở đây là `receivables` và
                      `returns` lệch nhau vĩnh viễn, không lệnh nào kéo về được.
                      Khoá ở đây VÀ ở hàm lưu — chỉ khoá một chỗ là còn đường
                      vòng. */}
                  {ret.status === "completed" ? (
                    <div className="space-y-1">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        Credit Note (VND)
                      </Label>
                      <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm font-semibold tabular-nums">
                        {formatCurrency(ret.credit_note_amount ?? 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Phiếu đã nhập kho và đã trừ công nợ — số này khoá lại. Cần đổi thì huỷ phiếu
                        rồi lập lại.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Credit Note (VND)</Label>
                      <Input
                        type="number"
                        value={editForm.credit_note_amount}
                        onChange={(e) => setEditForm({ ...editForm, credit_note_amount: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full">
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column - customer + links */}
        <div className="space-y-4">
          {/* Customer info */}
          <Card>
            <CardHeader><CardTitle>Khách hàng</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-bold">{ret.customer?.store_name || "—"}</p>
              <p className="text-muted-foreground">{ret.customer?.owner_name}</p>
              <p>{ret.customer?.phone}</p>
              <p className="text-muted-foreground">{ret.customer?.address}</p>
            </CardContent>
          </Card>

          {/* Links */}
          <Card>
            <CardHeader><CardTitle>Liên kết</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {ret.order_id && (
                <Link
                  href={`/orders/${ret.order_id}`}
                  className="flex items-center gap-2 text-primary hover:underline font-semibold"
                >
                  <ExternalLink className="h-4 w-4" />
                  Đơn hàng gốc {orderCode ? `(${orderCode})` : ""}
                </Link>
              )}
              {/*
                ⚠ HÓA ĐƠN BÁN LÀ MỐC ĐỐI CHIẾU THẬT của khoản trừ này.
                  Khoản trừ công nợ tính trên tờ hóa đơn, không trên đơn
                  đặt hàng — nên khi đối chiếu, đây mới là tờ giấy phải
                  mở ra. (Trần "chỉ trả được hàng đã xuất" đã bỏ từ
                  22/09/2026, xem migration 158 — hóa đơn nay là mốc đối
                  chiếu chứ không còn là giới hạn.)
              */}
              {inv.invoice_id && (
                <Link
                  href={`/sales-invoices/${inv.invoice_id}`}
                  className="flex items-center gap-2 text-primary hover:underline font-semibold"
                >
                  <ExternalLink className="h-4 w-4" />
                  Hóa đơn bán{" "}
                  {inv.invoice?.invoice_code
                    ? `(${inv.invoice.invoice_code}${
                        inv.invoice.invoice_date ? ` · ${formatDate(inv.invoice.invoice_date)}` : ""
                      })`
                    : ""}
                </Link>
              )}
              <div className="pt-2 border-t border-border/40">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người tạo</Label>
                <p>{ret.requester?.full_name || "—"}</p>
              </div>

              {/*
                ⚠ HAI DÒNG KHÁC NHAU, ĐỪNG GỘP. "Người tạo" là ai GÕ
                  phiếu; dòng này là phiếu TÍNH CHO ai. NPP gõ hộ một
                  phiếu của nhân viên đi tuyến thì hai cái tên khác nhau,
                  và cái thứ hai mới là cái báo cáo nhân viên đọc.

                ⚠ CHƯA GÁN THÌ NÓI "CHƯA GÁN", đừng để một gạch ngang.
                  Gạch ngang đọc ra "không ai" — còn sự thật là phiếu lập
                  trước khi sổ có cột này, và báo cáo vẫn đang đoán.
              */}
              {coCotNguoiDungTen && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Tính cho nhân viên
                  </Label>
                  {doiNguoiDungTen ? (
                    <div className="mt-1 space-y-2">
                      <SearchSelect
                        id="ret-seller"
                        options={sellerOptions}
                        valueId={nguoiDungTenMoi}
                        onPick={(o) => setNguoiDungTenMoi(o?.id ?? "")}
                        placeholder="Gõ tên nhân viên…"
                        emptyHint="Không tìm thấy nhân viên nào khớp."
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={luuNguoiDungTen} disabled={actionLoading}>
                          Lưu
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDoiNguoiDungTen(false)
                            setNguoiDungTenMoi(salesUserId ?? "")
                          }}
                          disabled={actionLoading}
                        >
                          Huỷ
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className={salesUserId ? "" : "text-muted-foreground"}>
                        {salesUserName || (salesUserId ? "—" : "Chưa gán")}
                      </p>
                      {canPickSeller && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDoiNguoiDungTen(true)}
                        >
                          <Pencil className="mr-1 h-3 w-3" /> Đổi
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {ret.approver && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người xử lý</Label>
                  <p>{ret.approver.full_name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Admin: delete only */}
          {canDelete && (
            <Card>
              <CardHeader><CardTitle>Thao tác quản trị</CardTitle></CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xoá phiếu trả
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xoá vĩnh viễn phiếu trả hàng?"
        description="Phiếu trả này sẽ bị xoá cùng toàn bộ chi tiết. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xoá vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      {/*
        ⚠ HUỶ PHIẾU TRẢ BẮT BUỘC CÓ LÝ DO — `cancel_return` RAISE
        `REASON_REQUIRED` khi để trống, nên hỏi ở đây thay vì để RPC từ
        chối sau khi người dùng đã bấm.
        ⚠ Và huỷ một phiếu ĐÃ hoàn thành là ĐẢO KHO: RPC trừ lại tồn đã
        nhập và tính lại công nợ. Nói thẳng ra trong câu mô tả.
      */}
      <Dialog open={cancelOpen} onOpenChange={(o) => !actionLoading && setCancelOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Huỷ phiếu trả?</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {ret.status === "completed"
                ? "Phiếu này đã nhập kho. Huỷ sẽ trừ lại số hàng đã nhập và tính lại công nợ của đơn gốc."
                : "Phiếu chưa nhập kho, huỷ chỉ đổi trạng thái."}
            </p>
            {/* ⚠ NÓI TRƯỚC HAI KHOÁ CỦA `cancel_return`, đừng để người dùng
                gõ xong lý do rồi mới nhận lỗi. Đơn gốc chỉ cần đã thu MỘT
                ĐỒNG là phiếu trả gắn đơn đó không huỷ được nữa — một
                chiều, không quay lại. */}
            {ret.status === "completed" && (
              <p className="rounded-lg bg-[#fff7e6] px-3 py-2 text-xs font-semibold leading-snug text-[#7a4b00]">
                Không huỷ được nếu khoản có đã cấn trừ vào một phiếu thu, hoặc nếu đơn gốc đã thu
                tiền — dù chỉ một phần. Khi đó phải huỷ phiếu thu trước.
              </p>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lý do huỷ</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder="Ví dụ: khách đổi ý, nhập nhầm số lượng…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={actionLoading}>
                Quay lại
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={actionLoading || !cancelReason.trim()}
              >
                {actionLoading ? "Đang huỷ…" : "Huỷ phiếu trả"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
