"use client"

import { useEffect, useRef, useState } from "react"
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
import { Camera, MapPin, RotateCcw, Loader2, Check } from "lucide-react"

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

  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [result, setResult] = useState<VisitResult>("no_order")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Capture GPS when dialog opens
  useEffect(() => {
    if (!open) {
      // Reset when closing
      setPhotoBlob(null)
      setPhotoPreview(null)
      setCoords(null)
      setGpsError(null)
      setResult("no_order")
      setNotes("")
      return
    }
    if (!navigator.geolocation) {
      setGpsError("Trình duyệt không hỗ trợ định vị")
      return
    }
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsLoading(false)
      },
      (err) => {
        setGpsError(err.message || "Không thể lấy vị trí")
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [open])

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPhotoBlob(f)
    setPhotoPreview(URL.createObjectURL(f))
  }

  const retakePhoto = () => {
    setPhotoBlob(null)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    fileInputRef.current?.click()
  }

  const handleSubmit = async () => {
    if (!user?.org_id || !user.id) {
      toast({ title: "Chưa đăng nhập", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      // 1. Upload photo if present
      let photoUrl: string | null = null
      if (photoBlob) {
        const ext = photoBlob.type.includes("png") ? "png" : "jpg"
        const path = `${user.org_id}/${customerId}/${Date.now()}-${user.id.slice(0, 8)}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from("visit-photos")
          .upload(path, photoBlob, {
            contentType: photoBlob.type || "image/jpeg",
            upsert: false,
          })
        if (uploadErr) throw uploadErr
        const { data: pub } = supabase.storage.from("visit-photos").getPublicUrl(path)
        photoUrl = pub.publicUrl
      }

      // 2. Insert visit_log row
      const now = new Date()
      const { error: insertErr } = await supabase.from("visit_logs").insert({
        org_id: user.org_id,
        sales_user_id: user.id,
        customer_id: customerId,
        visit_date: now.toISOString().slice(0, 10),
        check_in_at: now.toISOString(),
        check_in_lat: coords?.lat ?? null,
        check_in_lng: coords?.lng ?? null,
        result,
        notes: notes.trim() || null,
        photo_url: photoUrl,
      })
      if (insertErr) throw insertErr

      // 3. Notify the primary assignee (if different from the visiting user)
      //    This is useful for managers overseeing the rep's portfolio.
      const { data: primaryAssignment } = await supabase
        .from("customer_assignments")
        .select("user_id")
        .eq("customer_id", customerId)
        .eq("role", "primary")
        .maybeSingle()
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
      const message = err instanceof Error ? err.message : "Không thể ghi nhận"
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
          {/* Photo capture */}
          <div>
            <Label className="text-sm font-semibold">Ảnh cửa hàng</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelected}
              className="hidden"
            />
            {photoPreview ? (
              <div className="mt-1.5 relative rounded-xl overflow-hidden border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Ảnh cửa hàng"
                  className="w-full h-52 object-cover"
                />
                <button
                  type="button"
                  onClick={retakePhoto}
                  className="absolute top-2 right-2 rounded-lg bg-black/60 text-white text-xs font-semibold px-2 py-1 flex items-center gap-1"
                >
                  <RotateCcw className="h-3 w-3" /> Chụp lại
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="mt-1.5 w-full h-28 border-dashed"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="h-5 w-5 mr-2" />
                Bấm để chụp ảnh cửa hàng
              </Button>
            )}
          </div>

          {/* GPS */}
          <div className="rounded-xl border p-3 bg-muted/20">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Vị trí check-in</p>
            </div>
            {gpsLoading ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Đang lấy vị trí...
              </p>
            ) : coords ? (
              <p className="text-xs font-mono text-muted-foreground">
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
              </p>
            ) : (
              <p className="text-xs text-destructive">{gpsError || "Chưa có"}</p>
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
          <Button type="button" onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lưu
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
