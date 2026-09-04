"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, Eraser, ImageOff, PenLine } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"

/** Bucket ảnh POD — tạo ở migration 101, cùng khuôn với `visit-photos`. */
const BUCKET = "pod-photos"
/** Cạnh dài tối đa của ảnh sau khi nén, tính bằng px. */
const MAX_EDGE = 1280
/** Chất lượng JPEG sau khi nén. */
const JPEG_QUALITY = 0.7

/**
 * Nén ảnh TRƯỚC khi tải lên.
 *
 * Ảnh gốc từ camera điện thoại là 3–8MB. Tài xế đang đứng trước cửa nhà
 * khách, sóng 3G — tải 6MB là đứng đó chờ hoặc bỏ dở. 1280px đủ để đọc
 * thùng hàng và tên đường, và xuống còn ~200KB.
 *
 * Hỏng thì trả về BLOB GỐC chứ không ném: thà tải chậm còn hơn mất bằng
 * chứng giao hàng.
 */
async function shrinkImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1) return file
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", JPEG_QUALITY)
    )
    return blob || file
  } catch {
    return file
  }
}

/**
 * Màn ký nhận + chụp ảnh giao hàng (POD).
 *
 * Cột `delivery_lines.pod_photo_url` và `pod_signature` có từ migration
 * 001 và trang chi tiết đơn đã HIỂN THỊ ảnh POD — chỉ chưa bao giờ có chỗ
 * nào GHI vào. Đây là nửa còn thiếu, không phải tính năng mới.
 *
 * Phải có ít nhất MỘT bằng chứng (chữ ký hoặc ảnh) mới cho xác nhận: POD
 * mà không có gì để chứng minh thì chỉ là một ô tick. Nút bị khoá nói ra
 * lý do thay vì biến mất (SKILL.md §4).
 */
export function PodCaptureSheet({
  open,
  onOpenChange,
  line,
  orgId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  line: {
    id: string
    orderCode: string
    storeName: string
    total: number
  } | null
  orgId: string | undefined
  onSaved: () => void
}) {
  const supabase = createClient()
  const { toast } = useToast()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasStroke, setHasStroke] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  // Xem trước ảnh. Thu hồi object URL cũ trước khi tạo cái mới, nếu không
  // mỗi lần chụp lại là một blob nằm lại trong bộ nhớ tới khi đóng tab.
  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  // Mỗi lần mở lại là một điểm giao khác — không được giữ chữ ký của
  // khách trước.
  useEffect(() => {
    if (!open) {
      setPhoto(null)
      setNotes("")
      setHasStroke(false)
    }
  }, [open])

  /**
   * Chỉnh kích thước bộ đệm canvas theo mật độ điểm ảnh của máy.
   *
   * Không làm thì nét ký bị răng cưa trên màn Retina. Chặn DPR ở 2: máy
   * DPR 3 cho ảnh PNG to gấp 2,25 lần mà mắt không phân biệt được, trong
   * khi chữ ký này nằm trong một cột `text` của Postgres.
   *
   * Đo bằng rAF sau khi sheet mở: lúc sheet còn đang trượt vào,
   * getBoundingClientRect có thể trả 0 và canvas sẽ rỗng vĩnh viễn.
   *
   * ĐO LẠI tối đa 20 khung hình (~330ms) chứ không bỏ cuộc sau khung đầu:
   * đo một lần rồi return là canvas giữ nguyên cỡ mặc định 300×150, nét
   * ký lệch hẳn so với ngón tay và không có gì báo hiệu.
   */
  useEffect(() => {
    if (!open) return
    let id = 0
    let tries = 0
    const measure = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0) {
        if (++tries < 20) id = requestAnimationFrame(measure)
        return
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.2
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.strokeStyle = "#111827"
    }
    id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [open])

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    // ctx đang scale theo DPR nên hình chữ nhật này phủ RỘNG HƠN bộ đệm
    // thật — cố ý: phủ thừa thì vô hại, còn phủ thiếu để sót nét ký cũ.
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasStroke(false)
  }

  const blockReason = !hasStroke && !photo ? "Cần chữ ký hoặc ảnh giao hàng" : null

  const handleSave = async () => {
    if (!line || blockReason) return
    setSaving(true)
    try {
      let uploadedUrl: string | null = null
      if (photo) {
        // Không có org_id thì đường dẫn không qua nổi policy storage —
        // và im lặng lưu dòng KHÔNG kèm ảnh là mất bằng chứng mà không
        // ai biết. Dừng lại và nói ra.
        if (!orgId) throw new Error("Thiếu org_id — không tải được ảnh lên. Tải lại trang rồi thử lại.")
        const blob = await shrinkImage(photo)
        const path = `${orgId}/${line.id}/${Date.now()}.jpg`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, blob, { contentType: "image/jpeg", upsert: false })
        if (upErr) throw upErr
        uploadedUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
      }

      // Chỉ ghi những cột THỰC SỰ có giá trị mới. Ghi null đè lên chữ ký
      // đã có từ lần xác nhận trước là xoá bằng chứng bằng một lần bấm
      // nhầm.
      const updates: Record<string, unknown> = {
        status: "delivered",
        delivered_at: new Date().toISOString(),
      }
      if (hasStroke && canvasRef.current) {
        updates.pod_signature = canvasRef.current.toDataURL("image/png")
      }
      if (uploadedUrl) updates.pod_photo_url = uploadedUrl
      if (notes.trim()) updates.notes = notes.trim()

      await supabase.from("delivery_lines").update(updates).eq("id", line.id).throwOnError()

      toast({ title: `Đã xác nhận giao ${line.orderCode}` })
      onOpenChange(false)
      onSaved()
    } catch (err: unknown) {
      // KHÔNG đóng sheet khi lỗi: đóng đi là mất chữ ký khách vừa ký và
      // phải mời họ ký lại.
      toast({
        title: "Chưa lưu được",
        description: err instanceof Error ? err.message : "Có lỗi xảy ra",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        {line && (
          <>
            <SheetHeader>
              <SheetTitle className="truncate text-left">{line.storeName}</SheetTitle>
              <p className="text-left text-xs text-on-surface-variant">
                {line.orderCode} • {formatCurrency(line.total)}
              </p>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-on-surface-variant">
                  <PenLine className="h-3.5 w-3.5" /> Khách ký nhận
                </Label>
                {/* 220px: dưới 200px thì chữ ký bị bó thành một vệt và
                    người ký phải viết nhỏ hơn cỡ chữ tự nhiên của họ.
                    touch-none là BẮT BUỘC — không có nó, ngón tay kéo trên
                    canvas sẽ cuộn trang thay vì vẽ. */}
                <canvas
                  ref={canvasRef}
                  className="h-[220px] w-full touch-none rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-lowest"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    const ctx = e.currentTarget.getContext("2d")
                    if (!ctx) return
                    const p = pointAt(e)
                    ctx.beginPath()
                    ctx.moveTo(p.x, p.y)
                    drawing.current = true
                  }}
                  onPointerMove={(e) => {
                    if (!drawing.current) return
                    const ctx = e.currentTarget.getContext("2d")
                    if (!ctx) return
                    const p = pointAt(e)
                    ctx.lineTo(p.x, p.y)
                    ctx.stroke()
                    if (!hasStroke) setHasStroke(true)
                  }}
                  onPointerUp={() => {
                    drawing.current = false
                  }}
                  onPointerCancel={() => {
                    drawing.current = false
                  }}
                  aria-label="Ô ký nhận của khách"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">
                    {hasStroke ? "Đã ký" : "Chưa ký"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="tap h-11 text-xs"
                    onClick={clearSignature}
                    disabled={!hasStroke}
                  >
                    <Eraser className="mr-1.5 h-3.5 w-3.5" /> Ký lại
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-on-surface-variant">
                  <Camera className="h-3.5 w-3.5" /> Ảnh giao hàng
                </Label>
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrl}
                    alt="Ảnh giao hàng"
                    className="h-[220px] w-full rounded-xl border border-outline-variant object-cover"
                  />
                ) : (
                  <div className="flex h-[220px] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-outline-variant text-on-surface-variant">
                    <ImageOff className="h-6 w-6" />
                    <span className="text-xs">Chưa có ảnh</span>
                  </div>
                )}
                {/* capture="environment" mở thẳng camera sau. Không có nó,
                    máy hiện bộ chọn ảnh và tài xế phải qua hai màn. */}
                <label className="tap flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-outline-variant text-sm font-semibold">
                  <Camera className="h-4 w-4" />
                  {photo ? "Chụp lại" : "Chụp ảnh"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-on-surface-variant">
                  Ghi chú giao hàng
                </Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="VD: giao cho bảo vệ, khách hẹn chiều lấy…"
                  className="h-11"
                />
              </div>

              {/* M6.3 — nút h-14. Tài xế đứng ngoài đường, một tay cầm
                  điện thoại một tay giữ hàng. */}
              <div className="sticky bottom-0 -mx-6 border-t border-outline-variant bg-surface-container-lowest px-6 py-3 pb-safe">
                <Button
                  className="h-14 w-full text-base"
                  onClick={handleSave}
                  disabled={saving || !!blockReason}
                  title={blockReason || undefined}
                >
                  {saving ? "Đang lưu..." : blockReason || "Xác nhận đã giao"}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
