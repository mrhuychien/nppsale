"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { MapPin, Loader2, Check, AlertTriangle, CheckCircle2, ExternalLink, RotateCw, Store } from "lucide-react"
import { errorMessage } from "@/lib/errors"
import { distanceText, type Fix } from "@/lib/customers/photos"
import {
  cauHoiCheckIn, cauSaiSoLon, danhGiaCheckIn, docViTriTotNhat, linkBanDo, mayDangDung, saiSoLon, toaDoText,
} from "@/lib/customers/vi-tri"
import { vnDateKey } from "@/lib/orders/status-tone"

interface VisitCheckinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId: string
  customerName: string
  onSuccess?: () => void
}

type VisitResult = "order_placed" | "no_order" | "closed" | "not_visited"

const RESULT_OPTIONS: { value: VisitResult; label: string }[] = [
  { value: "order_placed", label: "Đã đặt đơn" },
  { value: "no_order", label: "Không đặt đơn" },
  { value: "closed", label: "Cửa hàng đóng" },
  { value: "not_visited", label: "Chưa ghé (ghi chú)" },
]

/**
 * Ghé thăm (check-in) khi đi tuyến: vị trí + kết quả + ghi chú.
 *
 * ⚠ KHÔNG CHỤP ẢNH — chủ nhà 12/10/2026: "Khi đi tuyến chỉ cần checkin ko cần chụp ảnh". Ảnh điểm bán là hồ sơ của
 *   cửa hàng (khối "Ảnh điểm bán", có duyệt), không phải việc của mỗi lượt ghé. Lượt ghé cũ có ảnh vẫn hiện ở lịch sử.
 *
 * ⚠ VỊ TRÍ (chủ nhà 23/11/2026: "Kiểm tra tại sao toạ độ vị trí trên google maps và trên app lại lệch nhau?"): đọc bằng
 *   `docViTriTotNhat` (theo dõi vài giây, lấy lần sai số nhỏ nhất — lần đọc đầu của điện thoại hay là định vị theo mạng),
 *   hiện SAI SỐ, hiện vị trí điểm bán ĐANG LƯU kèm link bản đồ của cả hai điểm (khoảng cách đo tới điểm ấy, không phải tới
 *   chỗ Google tìm theo địa chỉ), sai số lớn thì nói thẳng + nút Lấy lại vị trí. Luật: `@/lib/customers/vi-tri`.
 */
export function VisitCheckinDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  onSuccess,
}: VisitCheckinDialogProps) {
  const { user } = useAuth()
  const { toast } = useToast()
  const supabase = createClient()

  /** Lần đọc tốt nhất tới giờ (đang tinh chỉnh thì vẫn hiện). */
  const [fix, setFix] = useState<Fix | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  /** Tăng để đọc lại vị trí (nút "Lấy lại vị trí"). */
  const [luotDoc, setLuotDoc] = useState(0)
  const [result, setResult] = useState<VisitResult>("no_order")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [customerCoords, setCustomerCoords] = useState<{ lat: number; lng: number } | null>(null)

  // Load customer's stored GPS so we can compare with the check-in coordinates
  useEffect(() => {
    if (!open || !customerId) return
    let cancelled = false
    ;(async () => {
      const { data, error: dataErr } = await supabase
        .from("customers")
        .select("gps_lat, gps_lng")
        .eq("id", customerId)
        .maybeSingle()
      if (dataErr) console.error("[customers/visit-checkin-dialog] truy vấn lỗi:", dataErr.message)
      if (cancelled) return
      const row = data as { gps_lat: number | null; gps_lng: number | null } | null
      if (row && row.gps_lat != null && row.gps_lng != null) {
        setCustomerCoords({ lat: Number(row.gps_lat), lng: Number(row.gps_lng) })
      } else {
        setCustomerCoords(null)
      }
    })()
    return () => { cancelled = true }
  }, [open, customerId, supabase])

  // Reset khi đóng
  useEffect(() => {
    if (open) return
    setFix(null)
    setGpsError(null)
    setGpsLoading(false)
    setResult("no_order")
    setNotes("")
    setCustomerCoords(null)
    setLuotDoc(0)
  }, [open])

  // Đọc vị trí khi mở hộp và mỗi lần bấm "Lấy lại vị trí" — đọc MỚI, bỏ số cũ (người đã đi chỗ khác).
  useEffect(() => {
    if (!open) return
    const huy = new AbortController()
    setFix(null)
    setGpsError(null)
    setGpsLoading(true)
    docViTriTotNhat(typeof navigator !== "undefined" ? navigator.geolocation : null, { onDoc: setFix, signal: huy.signal })
      .then((f) => {
        if (huy.signal.aborted) return
        setFix(f)
        setGpsLoading(false)
      })
      .catch((e) => {
        if (huy.signal.aborted) return
        setGpsError(errorMessage(e, "Không lấy được vị trí"))
        setGpsLoading(false)
      })
    return () => huy.abort()
  }, [open, luotDoc])

  const danhGia = fix ? danhGiaCheckIn(fix, customerCoords) : null

  const handleSubmit = async () => {
    if (!user?.org_id || !user.id) {
      toast({ title: "Chưa đăng nhập", variant: "destructive" })
      return
    }
    // Xa điểm bán (hoặc sai số lớn tới mức chưa biết có ở cửa hàng không) thì hỏi — trừ "Chưa ghé" (ghi chú ngoài tuyến).
    const hoi = danhGia && result !== "not_visited" ? cauHoiCheckIn(danhGia) : null
    if (hoi && !window.confirm(hoi)) return
    setSaving(true)
    try {
      // 1. Insert visit_log row
      const now = new Date()
      const { error: insertErr } = await supabase.from("visit_logs").insert({
        org_id: user.org_id,
        sales_user_id: user.id,
        customer_id: customerId,
        // Ngày theo giờ VN — `toISOString()` là ngày UTC: ghé trước 7 giờ sáng ghi thành hôm qua.
        visit_date: vnDateKey(now),
        check_in_at: now.toISOString(),
        check_in_lat: fix?.lat ?? null,
        check_in_lng: fix?.lng ?? null,
        result,
        notes: notes.trim() || null,
      })
      if (insertErr) throw insertErr

      // 2. Notify the primary assignee (if different from the visiting user)
      //    This is useful for managers overseeing the rep's portfolio.
      const { data: primaryAssignment, error: primaryAssignmentErr } = await supabase
        .from("customer_assignments")
        .select("user_id")
        .eq("customer_id", customerId)
        .eq("role", "primary")
        // ⚠ Chỉ phân công CÒN HIỆU LỰC. Có lịch sử phân công (người cũ
        //   đã nghỉ) là nhiều dòng → `.maybeSingle()` lỗi → bỏ qua thông báo.
        //   Dòng cũ để trống `status` vẫn là còn hiệu lực (cùng luật với
        //   `lib/opening-balance/io.ts`).
        .or("status.is.null,status.eq.active")
        .limit(1)
        .maybeSingle()
      if (primaryAssignmentErr) console.error("[customers/visit-checkin-dialog] truy vấn lỗi:", primaryAssignmentErr.message)
      const primaryRepId = (primaryAssignment as { user_id?: string } | null)?.user_id
      if (primaryRepId && primaryRepId !== user.id) {
        const { createNotification } = await import("@/lib/notifications")
        const resultLabels: Record<string, string> = {
          order_placed: "đã đặt đơn",
          no_order: "không đặt đơn",
          closed: "cửa hàng đóng",
          not_visited: "chưa ghé",
        }
        createNotification(supabase, {
          orgId: user.org_id,
          userId: primaryRepId,
          type: "visit_logged",
          title: `Có lượt ghé thăm ${customerName}`,
          body: `${user.full_name || "NV"} đã ghé • ${resultLabels[result] || result}`,
          linkUrl: `/customers/${customerId}`,
          metadata: { customer_id: customerId, result, by: user.id },
        })
      }

      toast({ title: `Đã ghi nhận ghé thăm: ${customerName}` })
      onSuccess?.()
      onOpenChange(false)
    } catch (err) {
      const message = errorMessage(err, "Không thể ghi nhận")
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ghé thăm khách hàng</DialogTitle>
          <DialogDescription className="truncate">{customerName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* GPS */}
          <div className="rounded-xl border p-3 bg-muted/20 space-y-2" data-testid="vi-tri-check-in">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Vị trí check-in</p>
              {!gpsLoading && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs"
                  onClick={() => setLuotDoc((n) => n + 1)}
                >
                  <RotateCw className="mr-1 h-3 w-3" /> Lấy lại vị trí
                </Button>
              )}
            </div>
            {fix ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-mono" data-testid="toa-do-check-in">{toaDoText(fix)}</span>
                <a
                  href={linkBanDo(fix.lat, fix.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
                >
                  Bản đồ <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            ) : !gpsLoading ? (
              <p className="text-xs text-destructive">{gpsError || "Chưa có"}</p>
            ) : null}
            {gpsLoading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {fix ? "Đang lấy vị trí chính xác hơn..." : "Đang lấy vị trí..."}
              </p>
            )}

            {/* Vị trí điểm bán ĐANG LƯU — khoảng cách đo tới điểm này. */}
            {customerCoords ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground" data-testid="diem-ban-da-luu">
                <Store className="h-3 w-3 shrink-0" />
                <span>
                  Điểm bán đã lưu:{" "}
                  <span className="font-mono">{customerCoords.lat.toFixed(6)}, {customerCoords.lng.toFixed(6)}</span>
                </span>
                <a
                  href={linkBanDo(customerCoords.lat, customerCoords.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
                >
                  Bản đồ <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            ) : fix ? (
              <p className="text-[11px] text-muted-foreground">
                Điểm bán chưa lưu vị trí → không thể đối chiếu khoảng cách.
              </p>
            ) : null}

            {fix && saiSoLon(fix) && (
              <div className="rounded-lg border border-[#fdb022]/40 bg-[#fff4ed] p-2 text-xs text-[#b54708] flex items-start gap-1.5" data-testid="sai-so-lon">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{cauSaiSoLon(fix.accuracy as number, mayDangDung())}</span>
              </div>
            )}

            {/* Đối chiếu với vị trí điểm bán đang lưu */}
            {danhGia && danhGia.loai !== "chua-luu" && (
              danhGia.loai === "dung" ? (
                <div className="rounded-lg border border-tertiary/40 bg-[#ecfdf3] p-2 text-xs text-tertiary flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Đúng vị trí điểm bán ({distanceText(danhGia.cachM)})</span>
                </div>
              ) : danhGia.loai === "gan" ? (
                <div className="rounded-lg border border-[#fdb022]/40 bg-[#fff4ed] p-2 text-xs text-[#b54708] flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Cách điểm bán {distanceText(danhGia.cachM)} — kiểm tra lại bạn có đang ở đúng cửa hàng không.
                  </span>
                </div>
              ) : danhGia.loai === "chua-ro" ? (
                <div className="rounded-lg border border-[#fdb022]/40 bg-[#fff4ed] p-2 text-xs text-[#b54708] flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Chưa xác định được bạn có ở điểm bán không — cách vị trí đã lưu {distanceText(danhGia.cachM)}, sai số
                    lớn hơn thế. Bấm Lấy lại vị trí.
                  </span>
                </div>
              ) : (
                <div className="rounded-lg border border-error/40 bg-error-container p-2 text-xs text-error flex items-start gap-1.5" data-testid="check-in-xa">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Cách điểm bán {distanceText(danhGia.cachM)} — quá xa, hệ thống sẽ yêu cầu xác nhận.
                    {!saiSoLon(fix) && " Nếu bạn đang đứng ở cửa hàng thì vị trí điểm bán đang lưu bị sai — bấm Bản đồ ở dòng “Điểm bán đã lưu” để xem, rồi cập nhật ở khối Ảnh điểm bán."}
                  </span>
                </div>
              )
            )}
          </div>

          {/* Result */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Kết quả</Label>
            <Select value={result} onValueChange={(v) => setResult(v as VisitResult)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESULT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Ghi chú</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="VD: KH nhận đơn, hẹn giao T4..."
            />
          </div>
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1"
          >
            Hủy
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saving || (gpsLoading && !fix)}
            className="flex-1"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lưu
              </>
            ) : gpsLoading && !fix ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lấy vị trí
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-1.5" /> Ghi nhận
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
