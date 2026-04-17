"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import {
  Camera,
  CheckCircle2,
  ImageIcon,
  MapPin,
  Phone,
  Trash2,
  XCircle,
  PackageCheck,
  ClipboardList,
} from "lucide-react"

interface PodLineData {
  id: string
  delivery_id: string
  status: string
  pod_photo_url: string | null
  pod_signature: string | null
  delivered_at: string | null
  notes: string | null
  order_id: string
  order?: {
    order_code: string
    total: number
    customer?: {
      store_name: string
      phone: string
      address: string
    } | null
  } | null
}

interface DeliveryLite {
  id: string
  driver_id: string | null
  route_name: string | null
  status: string
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error || new Error("Không thể đọc ảnh"))
    reader.readAsDataURL(file)
  })
}

async function compressImage(file: File, maxDim = 1280, quality = 0.75): Promise<string> {
  // Fall back to a plain data URL if canvas / Image APIs aren't available
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fileToDataUrl(file)
  }
  try {
    const originalUrl = await fileToDataUrl(file)
    const img = new Image()
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Không thể tải ảnh"))
    })
    img.src = originalUrl
    const loadedImg = await loaded
    const { width, height } = loadedImg
    const scale = Math.min(1, maxDim / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return originalUrl
    ctx.drawImage(loadedImg, 0, 0, w, h)
    return canvas.toDataURL("image/jpeg", quality)
  } catch (err) {
    console.warn("[pod] image compression failed, using original", err)
    return fileToDataUrl(file)
  }
}

export default function PodConfirmationPage() {
  const params = useParams<{ id: string; lineId: string }>()
  const deliveryId = params?.id
  const lineId = params?.lineId
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [line, setLine] = useState<PodLineData | null>(null)
  const [delivery, setDelivery] = useState<DeliveryLite | null>(null)

  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState("")
  const [notes, setNotes] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadData = useCallback(async () => {
    if (!deliveryId || !lineId) return
    try {
      setLoading(true)
      setError(null)
      const [lineRes, delRes] = await Promise.all([
        supabase
          .from("delivery_lines")
          .select(
            "id, delivery_id, status, pod_photo_url, pod_signature, delivered_at, notes, order_id, order:sales_orders(order_code, total, customer:customers(store_name, phone, address))"
          )
          .eq("id", lineId)
          .single(),
        supabase
          .from("deliveries")
          .select("id, driver_id, route_name, status")
          .eq("id", deliveryId)
          .single(),
      ])
      if (lineRes.error) throw lineRes.error
      if (delRes.error) throw delRes.error
      const lineData = lineRes.data as unknown as PodLineData
      setLine(lineData)
      setDelivery(delRes.data as DeliveryLite)
      setSignatureName(lineData.pod_signature || "")
      setNotes(lineData.notes || "")
      setPhotoDataUrl(lineData.pod_photo_url || null)
    } catch (err) {
      console.error("[pod] load error:", err)
      setError(err instanceof Error ? err.message : "Không thể tải dữ liệu")
    } finally {
      setLoading(false)
    }
  }, [deliveryId, lineId, supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const canAccess = useMemo(() => {
    if (!user || !delivery) return false
    if (["owner", "manager", "warehouse"].includes(user.role)) return true
    if (user.role === "driver" && delivery.driver_id === user.id) return true
    return false
  }, [user, delivery])

  const handlePickPhoto = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await compressImage(file)
      setPhotoDataUrl(dataUrl)
    } catch (err) {
      toast({
        title: "Không thể đọc ảnh",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      })
    } finally {
      // reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleClearPhoto = () => {
    setPhotoDataUrl(null)
  }

  const handleConfirmDelivered = async () => {
    if (!line) return
    if (!photoDataUrl) {
      toast({
        title: "Thiếu ảnh POD",
        description: "Vui lòng chụp ảnh giao hàng trước khi xác nhận.",
        variant: "destructive",
      })
      return
    }
    if (!signatureName.trim()) {
      toast({
        title: "Thiếu họ tên người nhận",
        description: "Vui lòng nhập họ tên người nhận làm chữ ký xác nhận.",
        variant: "destructive",
      })
      return
    }
    setSubmitting(true)
    try {
      const nowIso = new Date().toISOString()
      const { error: lineErr } = await supabase
        .from("delivery_lines")
        .update({
          status: "delivered",
          pod_photo_url: photoDataUrl,
          pod_signature: signatureName.trim(),
          notes: notes.trim() || null,
          delivered_at: nowIso,
        })
        .eq("id", line.id)
      if (lineErr) throw lineErr

      if (line.order_id) {
        const { error: orderErr } = await supabase
          .from("sales_orders")
          .update({ status: "delivered" })
          .eq("id", line.order_id)
        if (orderErr) {
          console.warn("[pod] failed to update sales_order:", orderErr.message)
        }
      }
      toast({ title: "Đã xác nhận giao hàng" })
      router.push(`/deliveries/${deliveryId}`)
    } catch (err) {
      toast({
        title: "Lỗi",
        description:
          err instanceof Error ? err.message : "Không thể xác nhận giao hàng",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleFailDelivery = async () => {
    if (!line) return
    if (!notes.trim()) {
      toast({
        title: "Cần ghi chú lý do",
        description: "Vui lòng nhập lý do giao thất bại trong ghi chú.",
        variant: "destructive",
      })
      return
    }
    setSubmitting(true)
    try {
      const nowIso = new Date().toISOString()
      const { error: lineErr } = await supabase
        .from("delivery_lines")
        .update({
          status: "failed",
          notes: notes.trim(),
          pod_signature: signatureName.trim() || null,
          delivered_at: nowIso,
        })
        .eq("id", line.id)
      if (lineErr) throw lineErr
      toast({ title: "Đã đánh dấu giao thất bại" })
      router.push(`/deliveries/${deliveryId}`)
    } catch (err) {
      toast({
        title: "Lỗi",
        description:
          err instanceof Error ? err.message : "Không thể cập nhật",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (error || !line || !delivery) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-6 rounded-2xl">
          <p className="font-semibold mb-1">Không thể tải thông tin giao hàng</p>
          <p className="text-sm">{error || "Không tìm thấy đơn giao"}</p>
          <Link
            href={`/deliveries/${deliveryId}`}
            className="mt-3 text-sm font-semibold underline inline-block"
          >
            Quay lại
          </Link>
        </div>
      </div>
    )
  }

  if (!canAccess) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-amber-100 border border-amber-200 text-amber-800 p-6 rounded-2xl">
          <p className="font-semibold mb-1">Không có quyền truy cập</p>
          <p className="text-sm">
            Chỉ tài xế được phân công hoặc quản lý mới có thể xác nhận POD cho
            chuyến giao này.
          </p>
          <Link
            href={`/deliveries/${deliveryId}`}
            className="mt-3 text-sm font-semibold underline inline-block"
          >
            Quay lại
          </Link>
        </div>
      </div>
    )
  }

  const isLocked = line.status !== "pending"
  const customer = line.order?.customer

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-4">
      <PageHeader
        title="Xác nhận POD"
        description={delivery.route_name ? `Chuyến ${delivery.route_name}` : "Xác nhận giao hàng"}
        backHref=""
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-full shrink-0">
          {line.order?.order_code || "—"}
        </span>
      </PageHeader>

      {isLocked && (
        <div className="bg-amber-100 border border-amber-200 text-amber-800 p-4 rounded-2xl text-sm">
          <p className="font-semibold">Đơn này đã được xác nhận</p>
          <p className="text-xs mt-0.5">
            Trạng thái hiện tại:{" "}
            <span className="font-bold">
              {line.status === "delivered"
                ? "Đã giao"
                : line.status === "failed"
                  ? "Giao thất bại"
                  : line.status}
            </span>
            . Bạn có thể xem thông tin nhưng không thể chỉnh sửa.
          </p>
        </div>
      )}

      {/* Customer card */}
      <div className="bg-card rounded-2xl shadow-ambient p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground truncate">
              {customer?.store_name || "Khách hàng"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Tổng đơn: {formatCurrency(line.order?.total || 0)}
            </p>
          </div>
        </div>
        {customer?.phone && (
          <a
            href={`tel:${customer.phone}`}
            className="flex items-center gap-2 text-sm text-foreground active:text-primary"
          >
            <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">{customer.phone}</span>
          </a>
        )}
        {customer?.address && (
          <div className="flex items-start gap-2 text-sm text-foreground">
            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <span>{customer.address}</span>
          </div>
        )}
      </div>

      {/* Photo capture */}
      <div className="bg-card rounded-2xl shadow-ambient p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Camera className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground">Chụp ảnh POD</h3>
            <p className="text-xs text-muted-foreground">
              Chụp ảnh hàng hóa đã bàn giao cho khách
            </p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
          disabled={isLocked}
        />

        {photoDataUrl ? (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-surface-low">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoDataUrl}
                alt="Ảnh POD"
                className="w-full max-h-80 object-contain bg-black/5"
              />
            </div>
            {!isLocked && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePickPhoto}
                  className="w-full"
                >
                  <Camera className="h-4 w-4 mr-2" /> Chụp lại
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearPhoto}
                  className="w-full text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa ảnh
                </Button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handlePickPhoto}
            disabled={isLocked}
            className="relative w-full aspect-video rounded-xl bg-surface-low border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 active:bg-surface-container transition-colors disabled:opacity-50"
          >
            <ImageIcon className="h-10 w-10 text-muted-foreground" />
            <span className="text-sm font-semibold text-muted-foreground">
              Nhấn để mở camera
            </span>
            <span className="text-[11px] text-muted-foreground">
              Hỗ trợ chụp trực tiếp hoặc chọn từ thư viện
            </span>
          </button>
        )}
      </div>

      {/* Signature */}
      <div className="bg-card rounded-2xl shadow-ambient p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground">Chữ ký người nhận</h3>
            <p className="text-xs text-muted-foreground">
              Nhập họ tên đầy đủ của người nhận hàng
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signature">Họ tên người nhận</Label>
          <Input
            id="signature"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Họ tên người nhận"
            disabled={isLocked}
            className="text-base"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="bg-card rounded-2xl shadow-ambient p-5 space-y-3">
        <div className="min-w-0">
          <h3 className="font-bold text-foreground">Ghi chú</h3>
          <p className="text-xs text-muted-foreground">
            Ghi chú bắt buộc khi giao thất bại (lý do)
          </p>
        </div>
        <Textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="vd: Khách đã nhận đủ hàng / Khách vắng nhà, hẹn giao lại"
          disabled={isLocked}
        />
      </div>

      {/* Actions */}
      {!isLocked && (
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={handleConfirmDelivered}
            disabled={submitting}
            className="w-full bg-gradient-primary text-white font-bold py-4 rounded-2xl shadow-ambient-md flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-base">
              {submitting ? "Đang xử lý..." : "Xác nhận đã giao"}
            </span>
          </button>
          <Button
            type="button"
            variant="outline"
            onClick={handleFailDelivery}
            disabled={submitting}
            className="w-full py-4 h-auto text-destructive hover:bg-destructive/10 border border-destructive/30 rounded-2xl font-bold"
          >
            <XCircle className="h-5 w-5 mr-2" />
            Giao thất bại
          </Button>
        </div>
      )}
    </div>
  )
}
