"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Camera, MapPin, AlertTriangle, Trash2, ExternalLink, Loader2, LocateFixed, RefreshCw } from "lucide-react"
import { prepareImage } from "@/lib/images/prepare"
import {
  CUSTOMER_PHOTO_BUCKET,
  MANAGE_PHOTO_ROLES,
  MAX_PHOTOS,
  canRepinStore,
  distanceText,
  farFromStore,
  isStorePinFromPhoto,
  nextFreeSlot,
  photoStoragePath,
  repinQuestion,
  shouldPinCustomer,
  type Fix,
} from "@/lib/customers/photos"
import { formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"

export type CustomerPhoto = {
  id: string
  slot: number
  photo_url: string
  taken_at: string
  gps_lat: number | null
  gps_lng: number | null
  gps_accuracy: number | null
}

type StoreGps = { lat: number | null; lng: number | null }

/**
 * Nhờ máy chủ xoá file ảnh không còn dùng — trình duyệt tự xoá không được (xem đầu
 * `src/app/api/customers/photo-cleanup/route.ts`). Hỏng thì chỉ ghi log: ảnh đã gỡ khỏi điểm bán rồi, file sót lại
 * chỉ tốn chỗ trong kho.
 */
function cleanupPhotoFiles(paths: Array<string | null>): void {
  const list = paths.filter((p): p is string => !!p)
  if (list.length === 0) return
  fetch("/api/customers/photo-cleanup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths: list }),
    // Người dùng rời trang ngay sau khi bấm thì yêu cầu vẫn đi nốt.
    keepalive: true,
  })
    .then((res) => {
      if (!res.ok) console.error("[customer-photos] dọn file ảnh lỗi:", res.status)
    })
    .catch((e) => console.error("[customer-photos] dọn file ảnh lỗi:", errorMessage(e)))
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
 *
 * Sửa / cập nhật lại / xoá (chủ nhà 12/10/2026): "Chụp lại" thay tấm ảnh tại chỗ, file cũ xoá khỏi kho; tấm đã ghim
 * vị trí điểm bán thì vị trí đi theo ảnh mới, xoá tấm ấy thì hỏi xoá luôn vị trí. Vị trí điểm bán có nút riêng:
 * cập nhật theo chỗ đang đứng / xoá.
 */
export function CustomerPhotoCapture({
  customerId,
  customerName,
  storeGps,
  onChanged,
}: {
  customerId: string
  customerName: string
  storeGps: StoreGps
  onChanged?: () => void
}) {
  const supabase = createClient()
  const { user } = useAuth()
  const { toast } = useToast()

  const [photos, setPhotos] = useState<CustomerPhoto[]>([])
  const [loading, setLoading] = useState(true)
  /** Ô đang tải lên (chụp mới hoặc chụp lại); null = rảnh. Trong lúc đó khoá mọi nút chụp / xoá. */
  const [uploading, setUploading] = useState<number | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [deleting, setDeleting] = useState<CustomerPhoto | null>(null)
  /** Xoá tấm ảnh đã ghim vị trí: xoá luôn vị trí điểm bán? Mặc định có — ảnh với vị trí là một cặp. */
  const [alsoClearPin, setAlsoClearPin] = useState(true)
  const [deleteBusy, setDeleteBusy] = useState(false)
  /** Vị trí điểm bán đang hiện — đổi NGAY sau khi ghi, không chờ trang cha tải lại. */
  const [store, setStore] = useState<StoreGps>(storeGps)
  const [askPin, setAskPin] = useState<"update" | "clear" | null>(null)
  const [pinBusy, setPinBusy] = useState(false)

  useEffect(() => {
    setStore({ lat: storeGps.lat, lng: storeGps.lng })
  }, [storeGps.lat, storeGps.lng])

  const canManage = !!user && MANAGE_PHOTO_ROLES.includes(user.role)

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

  /**
   * Lấy vị trí ngay khi khối này hiện ra — không chờ người bấm. `then` nhận toạ độ vừa đọc (null = không đọc được);
   * `fresh` đọc mới hẳn: cập nhật vị trí điểm bán phải theo chỗ ĐANG đứng, không lấy số đọc lúc mở trang.
   */
  const readFix = useCallback((then?: (f: Fix | null) => void, fresh = false) => {
    if (!navigator.geolocation) {
      setGpsError("Máy không hỗ trợ định vị")
      then?.(null)
      return
    }
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
        setFix(f)
        setGpsError(null)
        setGpsBusy(false)
        then?.(f)
      },
      (err) => {
        // Không chặn chụp ảnh: máy tắt định vị vẫn phải nộp được ảnh,
        // chỉ là tấm đó không mang giá trị bằng chứng vị trí.
        setGpsError(err.message || "Không lấy được vị trí")
        setGpsBusy(false)
        then?.(null)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: fresh ? 0 : 30000 }
    )
  }, [])

  useEffect(() => { readFix() }, [readFix])

  const slot = nextFreeSlot(photos.map((p) => p.slot))
  const far = farFromStore(store, fix)
  const pin = shouldPinCustomer(store, fix)
  const repin = canRepinStore(store, fix)
  const hasStore = store.lat != null && store.lng != null

  /** Ghi vị trí điểm bán (null = xoá). Database từ chối thì NÉM — nơi gọi báo. */
  const writeStoreGps = async (next: { lat: number; lng: number } | null) => {
    await ghiPhaiTrungDong(
      supabase.from("customers").update({ gps_lat: next?.lat ?? null, gps_lng: next?.lng ?? null }).eq("id", customerId)
    )
    setStore({ lat: next?.lat ?? null, lng: next?.lng ?? null })
  }

  /** `thay` = CHỤP LẠI tấm đó (giữ ô cũ); null = chụp thêm vào ô trống đầu tiên. */
  const handleFile = async (file: File, thay: CustomerPhoto | null) => {
    const o = thay ? thay.slot : slot
    if (o === null) {
      toast({ title: `Đã đủ ${MAX_PHOTOS} ảnh`, description: "Bấm Chụp lại dưới một tấm để thay, hoặc xoá bớt.", variant: "destructive" })
      return
    }
    if (!user?.org_id) {
      toast({ title: "Chưa đăng nhập", variant: "destructive" })
      return
    }
    setUploading(o)
    // Chốt MỘT mốc thời gian dùng cho cả dấu trên ảnh lẫn cột taken_at —
    // gọi new Date() hai lần thì hai chỗ lệch nhau vài giây và về sau
    // không ai biết cái nào đúng.
    const takenAt = new Date()
    /** File vừa tải lên mà database chưa nhận — hỏng giữa chừng thì dọn đi. */
    let orphan: string | null = null
    try {
      const blob = await prepareImage(file, {
        takenAt,
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        accuracy: fix?.accuracy ?? null,
        title: customerName,
      })
      const path = `${user.org_id}/${customerId}/${o}-${takenAt.getTime()}.jpg`
      const { error: upErr } = await supabase.storage
        .from(CUSTOMER_PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false })
      if (upErr) throw upErr
      orphan = path
      const url = supabase.storage.from(CUSTOMER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl

      const anh = {
        photo_url: url,
        taken_at: takenAt.toISOString(),
        gps_lat: fix?.lat ?? null,
        gps_lng: fix?.lng ?? null,
        gps_accuracy: fix?.accuracy ?? null,
        uploaded_by: user.id,
      }
      if (thay) {
        // ⚠ SỬA DÒNG TẠI CHỖ, không xoá-rồi-chèn: chèn hỏng sau khi đã xoá là mất cả ảnh cũ lẫn ảnh mới.
        await ghiPhaiTrungDong(supabase.from("customer_photos").update(anh).eq("id", thay.id))
      } else {
        await supabase.from("customer_photos").insert({
          org_id: user.org_id,
          customer_id: customerId,
          slot: o,
          ...anh,
        }).throwOnError()
      }
      orphan = null
      // Ảnh cũ không còn dòng nào trỏ tới → xoá file khỏi kho.
      if (thay) cleanupPhotoFiles([photoStoragePath(thay.photo_url)])

      // Vị trí điểm bán theo ảnh mới:
      //   · điểm bán CHƯA có toạ độ → ghim (`shouldPinCustomer`, như cũ — không bao giờ tự đè toạ độ đã có);
      //   · CHỤP LẠI đúng tấm đã ghim vị trí → vị trí đi theo ảnh mới (ảnh với vị trí là một cặp).
      const pinFromOld = !!thay && isStorePinFromPhoto(store, thay)
      const followPhoto = pinFromOld && repin.ok
      let note = ""
      if ((pin.pin || followPhoto) && fix) {
        try {
          await writeStoreGps({ lat: fix.lat, lng: fix.lng })
          note = followPhoto ? " và cập nhật vị trí điểm bán" : " và ghim vị trí điểm bán"
        } catch (e) {
          console.error("[customer-photos] ghim vị trí lỗi:", errorMessage(e))
          note = " — chưa ghim được vị trí điểm bán"
        }
      } else if (pinFromOld) {
        note = ` — vị trí điểm bán giữ nguyên: ${repin.reason}`
      }
      toast({ title: `${thay ? `Đã thay ảnh ${o}` : "Đã lưu ảnh"}${note}` })
      await load()
      onChanged?.()
    } catch (e) {
      if (orphan) cleanupPhotoFiles([orphan])
      toast({
        title: thay ? "Không thay được ảnh" : "Không lưu được ảnh",
        description: errorMessage(e, "Lỗi không xác định"),
        variant: "destructive",
      })
    } finally {
      setUploading(null)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    const clearPin = alsoClearPin && isStorePinFromPhoto(store, deleting)
    setDeleteBusy(true)
    try {
      await ghiPhaiTrungDong(supabase.from("customer_photos").delete().eq("id", deleting.id))
      cleanupPhotoFiles([photoStoragePath(deleting.photo_url)])
      let note = ""
      if (clearPin) {
        try {
          await writeStoreGps(null)
          note = " và vị trí điểm bán"
        } catch (e) {
          console.error("[customer-photos] xoá vị trí lỗi:", errorMessage(e))
          note = " — chưa xoá được vị trí điểm bán"
        }
      }
      toast({ title: `Đã xoá ảnh${note}` })
      setDeleting(null)
      await load()
      onChanged?.()
    } catch (e) {
      toast({
        title: "Không xoá được",
        description: errorMessage(e, "Lỗi không xác định"),
        variant: "destructive",
      })
    } finally {
      setDeleteBusy(false)
    }
  }

  /** "Cập nhật theo chỗ đang đứng": đọc vị trí MỚI rồi mới hỏi. */
  const startRepin = () =>
    readFix((f) => {
      const r = canRepinStore(store, f)
      if (r.ok) setAskPin("update")
      else toast({ title: "Chưa cập nhật được vị trí", description: r.reason, variant: "destructive" })
    }, true)

  const savePin = async (next: { lat: number; lng: number } | null) => {
    setPinBusy(true)
    try {
      await writeStoreGps(next)
      toast({ title: next ? "Đã cập nhật vị trí điểm bán" : "Đã xoá vị trí điểm bán" })
      setAskPin(null)
      onChanged?.()
    } catch (e) {
      toast({
        title: next ? "Không cập nhật được vị trí" : "Không xoá được vị trí",
        description: errorMessage(e, "Lỗi không xác định"),
        variant: "destructive",
      })
    } finally {
      setPinBusy(false)
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
          <button type="button" onClick={() => readFix()} className="tap text-xs font-semibold text-primary underline">
            {gpsError ? `Không có vị trí — thử lại` : "Lấy vị trí"}
          </button>
        )}
      </div>

      {/* Vị trí ĐIỂM BÁN (khác vị trí máy ở dòng trên) — sửa được, xoá được. */}
      <div data-testid="vi-tri-diem-ban" className="space-y-2 rounded-xl border border-outline-variant/60 p-2.5">
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-semibold text-on-surface">Vị trí điểm bán:</span>
          {hasStore ? (
            <a
              href={`https://maps.google.com/?q=${store.lat},${store.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-semibold text-primary"
            >
              {Number(store.lat).toFixed(5)}, {Number(store.lng).toFixed(5)}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-on-surface-variant">Chưa có</span>
          )}
        </p>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={gpsBusy || pinBusy} onClick={startRepin}>
              <LocateFixed className="mr-1.5 h-4 w-4" />
              {hasStore ? "Cập nhật theo chỗ đang đứng" : "Ghim vị trí đang đứng"}
            </Button>
            {hasStore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-error"
                disabled={pinBusy}
                onClick={() => setAskPin("clear")}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Xoá vị trí
              </Button>
            )}
          </div>
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
        <div className="space-y-1">
          <p className="flex items-start gap-1.5 text-xs font-semibold text-[#b54708]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Bạn đang cách điểm bán khoảng {distanceText(far)}. Ảnh vẫn lưu được, kèm đúng toạ độ này.
          </p>
          {canManage && repin.ok && (
            <button type="button" onClick={startRepin} className="tap text-xs font-semibold text-primary underline">
              Vị trí điểm bán sai? Cập nhật về chỗ này
            </button>
          )}
        </div>
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
            <figure key={p.id} data-testid={`anh-diem-ban-${p.slot}`} className="overflow-hidden rounded-xl border border-outline-variant">
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
                {isStorePinFromPhoto(store, p) && (
                  <div className="flex items-center gap-0.5 font-semibold text-tertiary">
                    <MapPin className="h-2.5 w-2.5 shrink-0" /> Ghim vị trí điểm bán
                  </div>
                )}
                {canManage && (
                  <div className="flex flex-wrap items-center gap-x-2">
                    <label
                      className={`tap inline-flex items-center gap-1 font-semibold text-primary ${
                        uploading !== null ? "pointer-events-none opacity-50" : "cursor-pointer"
                      }`}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {uploading === p.slot ? "Đang thay…" : "Chụp lại"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        aria-label={`Chụp lại ảnh ${p.slot}`}
                        disabled={uploading !== null}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          e.target.value = ""
                          if (f) handleFile(f, p)
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setAlsoClearPin(true)
                        setDeleting(p)
                      }}
                      disabled={uploading !== null}
                      className="tap inline-flex items-center gap-1 text-error disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" /> Xoá
                    </button>
                  </div>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {canManage && (
        <label
          className={`tap flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant text-sm font-semibold ${
            slot === null || uploading !== null ? "pointer-events-none opacity-50" : "cursor-pointer"
          }`}
        >
          <Camera className="h-4 w-4" />
          {uploading !== null && uploading === slot
            ? "Đang tải lên…"
            : slot === null
              ? `Đã đủ ${MAX_PHOTOS} ảnh — bấm Chụp lại dưới tấm muốn thay`
              : `Chụp ảnh ${slot}/${MAX_PHOTOS}`}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Chụp ảnh mới"
            disabled={slot === null || uploading !== null}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) handleFile(f, null)
            }}
          />
        </label>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xoá ảnh ${deleting?.slot ?? ""}?`}
        description="Ảnh bị gỡ khỏi điểm bán và xoá hẳn khỏi kho ảnh. Chụp lại được bất cứ lúc nào."
        variant="destructive"
        confirmLabel="Xoá ảnh"
        loading={deleteBusy}
        onConfirm={handleDelete}
      >
        {deleting && isStorePinFromPhoto(store, deleting) && (
          <div className="flex items-start gap-2 text-sm">
            <Checkbox
              id="xoa-luon-vi-tri"
              checked={alsoClearPin}
              onCheckedChange={(v) => setAlsoClearPin(v === true)}
              className="mt-0.5"
            />
            <label htmlFor="xoa-luon-vi-tri" className="leading-snug">
              Xoá luôn vị trí điểm bán — vị trí đang ghim lấy từ ảnh này. Tấm chụp tới sẽ ghim lại.
            </label>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={askPin === "update"}
        onOpenChange={(o) => !o && setAskPin(null)}
        title={hasStore ? "Cập nhật vị trí điểm bán?" : "Ghim vị trí điểm bán?"}
        description={fix ? repinQuestion(fix, repin.movedMeters) : ""}
        confirmLabel="Cập nhật vị trí"
        loading={pinBusy}
        onConfirm={() => {
          if (fix && repin.ok) savePin({ lat: fix.lat, lng: fix.lng })
        }}
      />

      <ConfirmDialog
        open={askPin === "clear"}
        onOpenChange={(o) => !o && setAskPin(null)}
        title="Xoá vị trí điểm bán?"
        description="Toạ độ cũ bị gỡ, ảnh giữ nguyên. Tấm ảnh chụp tới tại điểm bán sẽ tự ghim lại vị trí — hoặc bấm “Ghim vị trí đang đứng”."
        variant="destructive"
        confirmLabel="Xoá vị trí"
        loading={pinBusy}
        onConfirm={() => savePin(null)}
      />
    </div>
  )
}
