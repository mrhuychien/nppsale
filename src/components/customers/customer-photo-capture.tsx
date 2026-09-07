"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Camera, MapPin, AlertTriangle, Trash2, ExternalLink, Loader2 } from "lucide-react"
import { prepareImage } from "@/lib/images/prepare"
import {
  MAX_PHOTOS,
  farFromStore,
  nextFreeSlot,
  shouldPinCustomer,
  type Fix,
} from "@/lib/customers/photos"
import { formatDate } from "@/lib/utils"

const BUCKET = "customer-photos"

export type CustomerPhoto = {
  id: string
  slot: number
  photo_url: string
  taken_at: string
  gps_lat: number | null
  gps_lng: number | null
  gps_accuracy: number | null
}

/**
 * Chụp ảnh điểm bán — tối đa 3 tấm, mỗi tấm kèm THỜI GIAN và TOẠ ĐỘ.
 *
 * Vị trí lấy TỰ ĐỘNG ngay khi mở khối này, không bắt bấm thêm nút: NVBH
 * đang đứng trước cửa hàng, mọi thao tác thừa đều là một lý do để bỏ qua.
 *
 * Tấm ảnh ĐẦU TIÊN của một điểm bán chưa có toạ độ sẽ ghim luôn điểm bán
 * vào vị trí đó — đó là cách "tạo danh sách ở nhà rồi cập nhật sau" khép
 * lại mà không cần thao tác riêng.
 */
export function CustomerPhotoCapture({
  customerId,
  customerName,
  storeGps,
  onChanged,
}: {
  customerId: string
  customerName: string
  storeGps: { lat: number | null; lng: number | null }
  onChanged?: () => void
}) {
  const supabase = createClient()
  const { user } = useAuth()
  const { toast } = useToast()

  const [photos, setPhotos] = useState<CustomerPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [fix, setFix] = useState<Fix | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [deleting, setDeleting] = useState<CustomerPhoto | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const canManage = !!user && ["owner", "manager", "sales"].includes(user.role)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from("customer_photos")
      .select("id, slot, photo_url, taken_at, gps_lat, gps_lng, gps_accuracy")
      .eq("customer_id", customerId)
      .order("slot")
    if (error) console.error("[customer-photos] truy vấn lỗi:", error.message)
    setPhotos((data as CustomerPhoto[]) || [])
    setLoading(false)
  }, [customerId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  /** Lấy vị trí ngay khi khối này hiện ra — không chờ người bấm. */
  const readFix = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Máy không hỗ trợ định vị")
      return
    }
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        setGpsError(null)
        setGpsBusy(false)
      },
      (err) => {
        // Không chặn chụp ảnh: máy tắt định vị vẫn phải nộp được ảnh,
        // chỉ là tấm đó không mang giá trị bằng chứng vị trí.
        setGpsError(err.message || "Không lấy được vị trí")
        setGpsBusy(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
  }, [])

  useEffect(() => { readFix() }, [readFix])

  const slot = nextFreeSlot(photos.map((p) => p.slot))
  const far = farFromStore(storeGps, fix)
  const pin = shouldPinCustomer(storeGps, fix)

  const handleFile = async (file: File) => {
    if (slot === null) {
      toast({ title: `Đã đủ ${MAX_PHOTOS} ảnh`, description: "Xoá bớt một tấm rồi chụp lại.", variant: "destructive" })
      return
    }
    if (!user?.org_id) {
      toast({ title: "Chưa đăng nhập", variant: "destructive" })
      return
    }
    setUploading(true)
    // Chốt MỘT mốc thời gian dùng cho cả dấu trên ảnh lẫn cột taken_at —
    // gọi new Date() hai lần thì hai chỗ lệch nhau vài giây và về sau
    // không ai biết cái nào đúng.
    const takenAt = new Date()
    try {
      const blob = await prepareImage(file, {
        takenAt,
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        accuracy: fix?.accuracy ?? null,
        title: customerName,
      })
      const path = `${user.org_id}/${customerId}/${slot}-${takenAt.getTime()}.jpg`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false })
      if (upErr) throw upErr
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

      await supabase.from("customer_photos").insert({
        org_id: user.org_id,
        customer_id: customerId,
        slot,
        photo_url: url,
        taken_at: takenAt.toISOString(),
        gps_lat: fix?.lat ?? null,
        gps_lng: fix?.lng ?? null,
        gps_accuracy: fix?.accuracy ?? null,
        uploaded_by: user.id,
      }).throwOnError()

      // Ghim điểm bán bằng vị trí lúc chụp — CHỈ khi nó chưa có toạ độ.
      if (pin.pin && fix) {
        const { error } = await supabase
          .from("customers")
          .update({ gps_lat: fix.lat, gps_lng: fix.lng })
          .eq("id", customerId)
        if (error) console.error("[customer-photos] ghim vị trí lỗi:", error.message)
        else toast({ title: "Đã lưu ảnh và ghim vị trí điểm bán" })
      } else {
        toast({ title: "Đã lưu ảnh" })
      }
      await load()
      onChanged?.()
    } catch (e) {
      toast({
        title: "Không lưu được ảnh",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
        variant: "destructive",
      })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await supabase.from("customer_photos").delete().eq("id", deleting.id).throwOnError()
      toast({ title: "Đã xoá ảnh" })
      setDeleting(null)
      await load()
      onChanged?.()
    } catch (e) {
      toast({
        title: "Không xoá được",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={photos.length > 0 ? "success" : "warning"}>
          {photos.length}/{MAX_PHOTOS} ảnh
        </Badge>
        {gpsBusy ? (
          <span className="flex items-center gap-1 text-xs text-on-surface-variant">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang lấy vị trí…
          </span>
        ) : fix ? (
          <span className="flex items-center gap-1 text-xs text-tertiary">
            <MapPin className="h-3.5 w-3.5" />
            {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
            {fix.accuracy != null && ` (±${Math.round(fix.accuracy)}m)`}
          </span>
        ) : (
          <button type="button" onClick={readFix} className="tap text-xs font-semibold text-primary underline">
            {gpsError ? `Không có vị trí — thử lại` : "Lấy vị trí"}
          </button>
        )}
      </div>

      {/* Nói trước điều SẼ xảy ra, đừng để người dùng phát hiện sau. */}
      {pin.pin && (
        <p className="flex items-start gap-1.5 text-xs text-primary">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Điểm bán chưa có toạ độ — tấm ảnh này sẽ ghim luôn vị trí hiện tại.
        </p>
      )}
      {far !== null && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-[#b54708]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Bạn đang cách điểm bán khoảng {far}m. Ảnh vẫn lưu được, kèm đúng toạ độ này.
        </p>
      )}
      {gpsError && (
        <p className="flex items-start gap-1.5 text-xs text-on-surface-variant">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {gpsError} — ảnh vẫn lưu được nhưng sẽ không có toạ độ.
        </p>
      )}

      {loading ? (
        <div className="h-28 animate-pulse rounded-xl bg-surface-container" />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <figure key={p.id} className="overflow-hidden rounded-xl border border-outline-variant">
              <a href={p.photo_url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photo_url} alt={`Ảnh ${p.slot}`} className="h-28 w-full object-cover" />
              </a>
              <figcaption className="space-y-0.5 p-1.5 text-[10px] text-on-surface-variant">
                <div>{formatDate(p.taken_at)}</div>
                {p.gps_lat != null && p.gps_lng != null ? (
                  <a
                    href={`https://maps.google.com/?q=${p.gps_lat},${p.gps_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-semibold text-primary"
                  >
                    Bản đồ <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : (
                  <span>Không có vị trí</span>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setDeleting(p)}
                    className="tap flex items-center gap-1 text-error"
                  >
                    <Trash2 className="h-3 w-3" /> Xoá
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {canManage && (
        <label
          className={`tap flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant text-sm font-semibold ${
            slot === null || uploading ? "pointer-events-none opacity-50" : "cursor-pointer"
          }`}
        >
          <Camera className="h-4 w-4" />
          {uploading
            ? "Đang tải lên…"
            : slot === null
              ? `Đã đủ ${MAX_PHOTOS} ảnh`
              : `Chụp ảnh ${slot}/${MAX_PHOTOS}`}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </label>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Xoá ảnh này?"
        description="Ảnh sẽ bị gỡ khỏi điểm bán. Chụp lại được bất cứ lúc nào."
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
