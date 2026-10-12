"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  Camera, MapPin, AlertTriangle, Trash2, ExternalLink, Loader2, LocateFixed, RefreshCw, ShieldCheck, Lock,
} from "lucide-react"
import { prepareImage } from "@/lib/images/prepare"
import {
  CUSTOMER_PHOTO_BUCKET,
  MANAGE_PHOTO_ROLES,
  MAX_PHOTOS,
  canRepinStore,
  distanceText,
  farFromStore,
  haversineMeters,
  isStorePinFromPhoto,
  nextFreeSlot,
  photoStoragePath,
  repinQuestion,
  shouldPinCustomer,
  type Fix,
} from "@/lib/customers/photos"
import {
  PHOTO_REQUEST_COLUMNS,
  canApprovePhotos,
  chuaCoDuyetAnh,
  duyetDiemBan,
  duyetYeuCauAnh,
  huyYeuCauAnh,
  mustRequestChange,
  pendingForPin,
  pendingForSlot,
  requestLabel,
  slotsInUse,
  xinDoiAnh,
  type PhotoRequest,
} from "@/lib/customers/photo-approval"
import { formatDate, formatDateTime } from "@/lib/utils"
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

/** Trạng thái duyệt (mig 244). `null` = máy chủ chưa có bước duyệt (chưa chạy migration) → khối chạy như trước. */
type Approval = { at: string | null; byName: string | null }

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
 *
 * DUYỆT (mig 244, chủ nhà 12/10/2026): người duyệt bấm "Duyệt ảnh + vị trí" là khoá; từ đó NV chụp lại / xoá / dời
 * vị trí thành YÊU CẦU chờ duyệt (ảnh cũ giữ nguyên tới lúc duyệt). Người duyệt sửa thẳng, duyệt / từ chối yêu cầu.
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
  const [approval, setApproval] = useState<Approval | null>(null)
  const [pending, setPending] = useState<PhotoRequest[]>([])
  const [decideBusy, setDecideBusy] = useState(false)
  /** Hộp "Từ chối" đang mở cho các yêu cầu này (kèm lý do). */
  const [rejecting, setRejecting] = useState<PhotoRequest[] | null>(null)
  const [rejectNote, setRejectNote] = useState("")
  const [askUnapprove, setAskUnapprove] = useState(false)

  useEffect(() => {
    setStore({ lat: storeGps.lat, lng: storeGps.lng })
  }, [storeGps.lat, storeGps.lng])

  const canManage = !!user && MANAGE_PHOTO_ROLES.includes(user.role)
  const canApprove = canApprovePhotos(user?.role)
  /** Đã duyệt mà người này không có quyền duyệt → mọi thay đổi thành yêu cầu. */
  const requestMode = mustRequestChange(approval?.at, canApprove)

  const load = useCallback(async () => {
    setLoading(true)
    const [ph, kh, yc] = await Promise.all([
      supabase
        .from("customer_photos")
        .select("id, slot, photo_url, taken_at, gps_lat, gps_lng, gps_accuracy")
        .eq("customer_id", customerId)
        .order("slot"),
      supabase
        .from("customers")
        .select("photo_approved_at, approver:users!customers_photo_approved_by_fkey(full_name)")
        .eq("id", customerId)
        .maybeSingle(),
      supabase
        .from("customer_photo_requests")
        .select(PHOTO_REQUEST_COLUMNS)
        .eq("customer_id", customerId)
        .eq("status", "pending")
        .order("requested_at"),
    ])
    if (ph.error) console.error("[customer-photos] truy vấn lỗi:", ph.error.message)
    setPhotos((ph.data as CustomerPhoto[]) || [])
    const loiDuyet = kh.error ?? yc.error
    if (loiDuyet) {
      // Chưa chạy mig 244 → không có bước duyệt, khối chạy như cũ. Lỗi khác thì ghi log (DB vẫn tự chặn ghi thẳng).
      if (!chuaCoDuyetAnh(loiDuyet)) console.error("[customer-photos] đọc trạng thái duyệt lỗi:", loiDuyet.message)
      setApproval(null)
      setPending([])
    } else {
      const k = kh.data as { photo_approved_at?: string | null; approver?: { full_name?: string | null } | null } | null
      setApproval({ at: k?.photo_approved_at ?? null, byName: k?.approver?.full_name ?? null })
      setPending((yc.data as unknown as PhotoRequest[]) || [])
    }
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

  const slot = nextFreeSlot(slotsInUse(photos, pending))
  const far = farFromStore(store, fix)
  const pin = shouldPinCustomer(store, fix)
  const repin = canRepinStore(store, fix)
  const hasStore = store.lat != null && store.lng != null
  const pinReq = pendingForPin(pending)

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
      // Vị trí điểm bán theo ảnh mới:
      //   · điểm bán CHƯA có toạ độ → ghim (`shouldPinCustomer`, như cũ — không bao giờ tự đè toạ độ đã có);
      //   · CHỤP LẠI đúng tấm đã ghim vị trí → vị trí đi theo ảnh mới (ảnh với vị trí là một cặp).
      const pinFromOld = !!thay && isStorePinFromPhoto(store, thay)
      const followPhoto = pinFromOld && repin.ok

      if (requestMode) {
        // Đã duyệt → GỬI YÊU CẦU, chưa đổi gì: ảnh mới nằm trong kho, gắn vào điểm bán khi người duyệt đồng ý.
        const meta = { url, takenAt: anh.taken_at, lat: anh.gps_lat, lng: anh.gps_lng, accuracy: anh.gps_accuracy }
        const pinMoi = (pin.pin || followPhoto) && fix ? { action: "set" as const, lat: fix.lat, lng: fix.lng } : undefined
        const kq = await xinDoiAnh(supabase, {
          customerId,
          photo: thay ? { action: "replace", photoId: thay.id, ...meta } : { action: "add", slot: o, ...meta },
          pin: pinMoi,
        })
        orphan = null
        cleanupPhotoFiles(kq.fileBo.map(photoStoragePath))
        toast({
          title: `Đã gửi yêu cầu: ${requestLabel(thay ? "photo_replace" : "photo_add", o)}${pinMoi ? " · Dời vị trí" : ""}`,
          description: "Chờ chủ NPP duyệt — ảnh và vị trí cũ giữ nguyên tới lúc ấy.",
        })
        await load()
        return
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
      if (requestMode) {
        const kq = await xinDoiAnh(supabase, {
          customerId,
          photo: { action: "delete", photoId: deleting.id },
          pin: clearPin ? { action: "clear" } : undefined,
        })
        cleanupPhotoFiles(kq.fileBo.map(photoStoragePath))
        toast({
          title: `Đã gửi yêu cầu: ${requestLabel("photo_delete", deleting.slot)}${clearPin ? " · Xoá vị trí" : ""}`,
          description: "Chờ chủ NPP duyệt — ảnh giữ nguyên tới lúc ấy.",
        })
        setDeleting(null)
        await load()
        return
      }
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
        title: requestMode ? "Không gửi được yêu cầu" : "Không xoá được",
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
      if (requestMode) {
        await xinDoiAnh(supabase, { customerId, pin: next ? { action: "set", lat: next.lat, lng: next.lng } : { action: "clear" } })
        toast({ title: `Đã gửi yêu cầu: ${requestLabel(next ? "pin_set" : "pin_clear", null)}`, description: "Chờ chủ NPP duyệt." })
        setAskPin(null)
        await load()
        return
      }
      await writeStoreGps(next)
      toast({ title: next ? "Đã cập nhật vị trí điểm bán" : "Đã xoá vị trí điểm bán" })
      setAskPin(null)
      onChanged?.()
    } catch (e) {
      toast({
        title: requestMode ? "Không gửi được yêu cầu" : next ? "Không cập nhật được vị trí" : "Không xoá được vị trí",
        description: errorMessage(e, "Lỗi không xác định"),
        variant: "destructive",
      })
    } finally {
      setPinBusy(false)
    }
  }

  /** Người duyệt đồng ý / từ chối (một hay nhiều yêu cầu). */
  const decide = async (reqs: PhotoRequest[], dongY: boolean, ghiChu?: string) => {
    setDecideBusy(true)
    try {
      const kq = await duyetYeuCauAnh(supabase, reqs.map((r) => r.id), dongY, ghiChu)
      cleanupPhotoFiles(kq.fileBo.map(photoStoragePath))
      toast({
        title: dongY ? `Đã duyệt ${kq.xong} yêu cầu` : `Đã từ chối ${kq.xong} yêu cầu`,
        description: kq.boQua > 0 ? `${kq.boQua} yêu cầu không còn áp được (ảnh gốc đã đổi) — đã bỏ.` : undefined,
      })
      setRejecting(null)
      setRejectNote("")
      await load()
      onChanged?.()
    } catch (e) {
      toast({ title: "Không duyệt được", description: errorMessage(e, "Lỗi không xác định"), variant: "destructive" })
    } finally {
      setDecideBusy(false)
    }
  }

  const withdraw = async (r: PhotoRequest) => {
    setDecideBusy(true)
    try {
      const kq = await huyYeuCauAnh(supabase, r.id)
      cleanupPhotoFiles(kq.fileBo.map(photoStoragePath))
      toast({ title: `Đã rút yêu cầu: ${requestLabel(r.kind, r.slot)}` })
      await load()
    } catch (e) {
      toast({ title: "Không rút được yêu cầu", description: errorMessage(e, "Lỗi không xác định"), variant: "destructive" })
    } finally {
      setDecideBusy(false)
    }
  }

  /** Duyệt (khoá) / bỏ duyệt bộ ảnh + vị trí. */
  const setStoreApproval = async (duyet: boolean) => {
    setDecideBusy(true)
    try {
      const kq = await duyetDiemBan(supabase, customerId, duyet)
      cleanupPhotoFiles(kq.fileBo.map(photoStoragePath))
      toast({ title: duyet ? "Đã duyệt ảnh + vị trí điểm bán" : "Đã bỏ duyệt — nhân viên sửa thẳng được" })
      setAskUnapprove(false)
      await load()
      onChanged?.()
    } catch (e) {
      toast({ title: "Không đổi được trạng thái duyệt", description: errorMessage(e, "Lỗi không xác định"), variant: "destructive" })
    } finally {
      setDecideBusy(false)
    }
  }

  const xinNhan = requestMode ? "Gửi yêu cầu" : null

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

      {/* Trạng thái DUYỆT (mig 244) — máy chủ chưa có bước duyệt thì không hiện. */}
      {approval && (
        <div data-testid="trang-thai-duyet-anh" className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {approval.at ? (
              <Badge variant="success">
                <ShieldCheck className="mr-1 h-3 w-3" /> Đã duyệt
              </Badge>
            ) : (
              <Badge variant="warning">Chưa duyệt</Badge>
            )}
            {approval.at && (
              <span className="text-xs text-on-surface-variant">
                {approval.byName ? `${approval.byName} · ` : ""}
                {formatDate(approval.at)}
              </span>
            )}
            {canApprove && !approval.at && (photos.length > 0 || hasStore) && (
              <Button type="button" size="sm" disabled={decideBusy} onClick={() => setStoreApproval(true)}>
                <ShieldCheck className="mr-1.5 h-4 w-4" /> Duyệt ảnh + vị trí
              </Button>
            )}
            {canApprove && approval.at && (
              <Button type="button" variant="ghost" size="sm" disabled={decideBusy} onClick={() => setAskUnapprove(true)}>
                Bỏ duyệt
              </Button>
            )}
          </div>
          {requestMode && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Ảnh và vị trí đã được duyệt — chụp lại, xoá, dời vị trí sẽ gửi chủ NPP duyệt, chưa đổi ngay.
            </p>
          )}
        </div>
      )}

      {/* Yêu cầu CHỜ DUYỆT — người duyệt đồng ý / từ chối; người gửi rút được. */}
      {pending.length > 0 && (
        <div data-testid="yeu-cau-cho-duyet" className="space-y-2 rounded-xl border border-amber-300 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-700">Chờ duyệt ({pending.length})</p>
            {canApprove && pending.length > 1 && (
              <Button type="button" size="sm" disabled={decideBusy} onClick={() => decide(pending, true)}>
                Duyệt tất cả
              </Button>
            )}
          </div>
          {pending.map((r) => {
            const ten = requestLabel(r.kind, r.slot)
            const dich = r.kind === "pin_set" && r.pin_lat != null && r.pin_lng != null ? { lat: Number(r.pin_lat), lng: Number(r.pin_lng) } : null
            return (
              <div key={r.id} data-testid={`yeu-cau-${r.kind}-${r.slot ?? "vt"}`} className="flex items-start gap-2 rounded-lg border border-outline-variant/60 bg-card p-2">
                {r.photo_url ? (
                  <a href={r.photo_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.photo_url} alt={`Ảnh mới — ${ten}`} className="h-14 w-14 rounded-md object-cover" />
                  </a>
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-surface-container text-on-surface-variant">
                    {r.kind.startsWith("pin_") ? <MapPin className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-0.5 text-xs">
                  <p className="font-semibold text-on-surface">{ten}</p>
                  {dich && (
                    <a
                      href={`https://maps.google.com/?q=${dich.lat},${dich.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 font-semibold text-primary"
                    >
                      {dich.lat.toFixed(5)}, {dich.lng.toFixed(5)}
                      {hasStore && ` · cách vị trí cũ ${distanceText(haversineMeters(Number(store.lat), Number(store.lng), dich.lat, dich.lng))}`}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                  <p className="text-on-surface-variant">
                    {r.requester?.full_name || "Nhân viên"} · {formatDateTime(r.requested_at)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {canApprove ? (
                    <>
                      <Button type="button" size="sm" disabled={decideBusy} onClick={() => decide([r], true)}>
                        Duyệt
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-error"
                        disabled={decideBusy}
                        onClick={() => {
                          setRejecting([r])
                          setRejectNote("")
                        }}
                      >
                        Từ chối
                      </Button>
                    </>
                  ) : r.requested_by === user?.id ? (
                    <Button type="button" variant="ghost" size="sm" disabled={decideBusy} onClick={() => withdraw(r)}>
                      Rút
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

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
          {pinReq && (
            <span className="rounded-full border border-amber-300 px-1.5 text-[11px] font-semibold text-amber-700">
              Chờ duyệt: {requestLabel(pinReq.kind, null)}
            </span>
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
          {photos.map((p) => {
            const cho = pendingForSlot(pending, p.slot)
            return (
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
                  {cho && <div className="font-semibold text-amber-700">Chờ duyệt: {requestLabel(cho.kind, cho.slot)}</div>}
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
            )
          })}
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
              : `Chụp ảnh ${slot}/${MAX_PHOTOS}${requestMode ? " (gửi duyệt)" : ""}`}
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
        description={
          requestMode
            ? "Ảnh đã được duyệt — gửi yêu cầu xoá để chủ NPP duyệt. Ảnh giữ nguyên tới lúc ấy."
            : "Ảnh bị gỡ khỏi điểm bán và xoá hẳn khỏi kho ảnh. Chụp lại được bất cứ lúc nào."
        }
        variant="destructive"
        confirmLabel={xinNhan ?? "Xoá ảnh"}
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
        description={fix ? repinQuestion(fix, repin.movedMeters) + (requestMode ? " Gửi chủ NPP duyệt." : "") : ""}
        confirmLabel={xinNhan ?? "Cập nhật vị trí"}
        loading={pinBusy}
        onConfirm={() => {
          if (fix && repin.ok) savePin({ lat: fix.lat, lng: fix.lng })
        }}
      />

      <ConfirmDialog
        open={askPin === "clear"}
        onOpenChange={(o) => !o && setAskPin(null)}
        title="Xoá vị trí điểm bán?"
        description={
          requestMode
            ? "Vị trí đã được duyệt — gửi yêu cầu xoá để chủ NPP duyệt. Vị trí giữ nguyên tới lúc ấy."
            : "Toạ độ cũ bị gỡ, ảnh giữ nguyên. Tấm ảnh chụp tới tại điểm bán sẽ tự ghim lại vị trí — hoặc bấm “Ghim vị trí đang đứng”."
        }
        variant="destructive"
        confirmLabel={xinNhan ?? "Xoá vị trí"}
        loading={pinBusy}
        onConfirm={() => savePin(null)}
      />

      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Từ chối: ${rejecting?.map((r) => requestLabel(r.kind, r.slot)).join(" · ") ?? ""}?`}
        description="Ảnh và vị trí giữ nguyên; nhân viên nhận thông báo kèm lý do."
        variant="destructive"
        confirmLabel="Từ chối"
        loading={decideBusy}
        onConfirm={() => rejecting && decide(rejecting, false, rejectNote)}
      >
        <Textarea
          rows={2}
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="Lý do (không bắt buộc) — VD: ảnh mờ, sai cửa hàng"
          aria-label="Lý do từ chối"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={askUnapprove}
        onOpenChange={setAskUnapprove}
        title="Bỏ duyệt ảnh + vị trí?"
        description={`Nhân viên lại sửa thẳng được ảnh và vị trí, không cần duyệt.${pending.length > 0 ? ` ${pending.length} yêu cầu đang chờ sẽ bị huỷ.` : ""}`}
        confirmLabel="Bỏ duyệt"
        loading={decideBusy}
        onConfirm={() => setStoreApproval(false)}
      />
    </div>
  )
}
