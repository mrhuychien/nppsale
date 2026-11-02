"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Camera, Keyboard, RotateCcw } from "lucide-react"
import { NHIP_QUET_MS, O_NGAM, batNetLienTuc, cauLoiCamera, coAnhGiai, moCamera, tatCamera, vungCat } from "@/lib/quet/camera"
import { taoBoGiai } from "@/lib/quet/bo-giai"
import { shouldAcceptScan } from "@/lib/sell/scan"

interface BarcodeScannerProps {
  open: boolean
  onClose: () => void
  onScan: (code: string) => void
  title?: string
  /** Nhãn nút gửi ở chế độ nhập tay — màn thêm hàng vào phiếu: "Thêm sản phẩm"; form sản phẩm: "Dùng mã này". */
  manualLabel?: string
}

/**
 * BỘ QUÉT MÃ VẠCH DÙNG CHUNG (form sản phẩm, nhập kho, xuất kho, POS quét) — camera + nhập tay.
 *
 * Chủ nhà 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được". Bản cũ để html5-qrcode tự lo camera:
 * camera 640×480, giải mã trên ô 280×150 điểm ảnh CSS, ZXing đóng kèm dò vạch mở đầu sai → điện thoại gần như không đọc
 * được mã nào; còn đóng hộp khi camera đang chạy thì `clear()` ném lỗi đồng bộ trong hàm dọn → SẬP TRANG (màn "Không thể
 * kết nối", mất form đang nhập). Nay app tự mở camera (src/lib/quet/camera.ts), cắt đúng ô ngắm ở độ phân giải gốc, giải
 * bằng bộ đọc sẵn của máy hoặc ZXing đã vá (src/lib/quet/bo-giai.ts); đóng hộp chỉ tắt camera, không gì ném ra ngoài.
 * Camera đọc ~8 khung/giây: CÙNG một mã chỉ gọi `onScan` lại sau 1,5 giây (`shouldAcceptScan`) — Nhập kho không tự lọc,
 * giơ mã một giây từng thành tám dòng. Nhập tay / máy quét USB không qua cửa này (quét hai lần là hai lần thật).
 */
export function BarcodeScanner({ open, onClose, onScan, title = "Quét mã vạch", manualLabel = "Thêm sản phẩm" }: BarcodeScannerProps) {
  const [mode, setMode] = useState<"camera" | "manual">("camera")
  const [manualInput, setManualInput] = useState("")
  const [cameraError, setCameraError] = useState("")
  const [dangMo, setDangMo] = useState(true)
  /** Bấm "Thử lại camera" → tăng số này để chạy lại effect mở camera. */
  const [lanThu, setLanThu] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const khungRef = useRef<HTMLDivElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)
  /** Hàm mới nhất của nơi gọi — vòng quét sống lâu hơn một lượt vẽ, đừng giữ hàm cũ. */
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!open || mode !== "camera") return
    const video = videoRef.current
    if (!video) return
    let huy = false
    let luong: MediaStream | null = null
    let hen: ReturnType<typeof setTimeout> | undefined
    let maCuoi: { code: string; at: number } | null = null
    const anh = document.createElement("canvas")
    const ve = anh.getContext("2d", { willReadFrequently: true })
    setCameraError("")
    setDangMo(true)

    const baoLoi = (e: unknown) => {
      if (huy) return
      tatCamera(luong)
      setCameraError(cauLoiCamera(e))
      setMode("manual")
    }

    const quet = async (giai: (c: HTMLCanvasElement) => Promise<string | null>) => {
      if (huy) return
      try {
        if (ve && video.readyState >= 2 && video.videoWidth > 0 && !document.hidden) {
          const khung = khungRef.current
          const v = vungCat(video.videoWidth, video.videoHeight, khung?.clientWidth ?? 0, khung?.clientHeight ?? 0)
          const co = coAnhGiai(v.sw, v.sh)
          if (anh.width !== co.w || anh.height !== co.h) {
            anh.width = co.w
            anh.height = co.h
          }
          ve.drawImage(video, v.sx, v.sy, v.sw, v.sh, 0, 0, co.w, co.h)
          const ma = await giai(anh)
          const bayGio = Date.now()
          if (ma && !huy && shouldAcceptScan(ma, maCuoi, bayGio)) {
            maCuoi = { code: ma.trim(), at: bayGio }
            onScanRef.current(ma)
          }
        }
      } catch {
        /* khung này hỏng (video vừa đổi cỡ…) — đọc khung sau */
      }
      if (!huy) hen = setTimeout(() => void quet(giai), NHIP_QUET_MS)
    }

    // Camera và bộ giải nạp CÙNG LÚC; hộp đóng giữa chừng (chưa kịp cho quyền camera…) thì luồng về sau vẫn bị tắt.
    const giaiP = taoBoGiai()
    giaiP.catch(() => {})
    void (async () => {
      try {
        const s = await moCamera()
        luong = s
        if (huy) {
          tatCamera(s)
          return
        }
        s.getVideoTracks()[0]?.addEventListener("ended", () => {
          const e = new Error("camera tắt")
          e.name = "AbortError"
          baoLoi(e)
        })
        video.srcObject = s
        // iPhone Safari chỉ cho tự phát video có `muted` + `playsinline` — React không ghi thuộc tính `muted`, đặt tay cả hai.
        video.muted = true
        video.setAttribute("muted", "")
        video.setAttribute("playsinline", "")
        await video.play().catch(() => {})
        const boGiai = await giaiP
        if (huy) return
        void batNetLienTuc(s)
        setDangMo(false)
        video.dataset.boGiai = boGiai.ten
        void quet((c) => boGiai.giai(c))
      } catch (e) {
        baoLoi(e)
      }
    })()

    return () => {
      huy = true
      clearTimeout(hen)
      tatCamera(luong)
      luong = null
      video.srcObject = null
    }
  }, [open, mode, lanThu])

  // Focus manual input
  useEffect(() => {
    if (open && mode === "manual") {
      setTimeout(() => manualRef.current?.focus(), 100)
    }
  }, [open, mode])

  if (!open) return null

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      onScan(manualInput.trim())
      setManualInput("")
      manualRef.current?.focus()
    }
  }

  const thuLaiCamera = () => {
    setCameraError("")
    setMode("camera")
    setLanThu((n) => n + 1)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="bg-card w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl border-t sm:border border-border/40 p-5 space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">{title}</h3>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
          <button
            type="button"
            onClick={() => (mode === "camera" ? undefined : thuLaiCamera())}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
              mode === "camera" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            <Camera className="h-3.5 w-3.5" /> Camera
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
              mode === "manual" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            <Keyboard className="h-3.5 w-3.5" /> Nhập tay
          </button>
        </div>

        {/* Camera mode */}
        {mode === "camera" && (
          <div className="space-y-3">
            <div ref={khungRef} className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                data-testid="camera-quet"
                className="absolute inset-0 h-full w-full object-cover"
                playsInline
                muted
                autoPlay
              />
              {/* Ô ngắm = đúng phần ảnh đem đi giải mã (O_NGAM) — mã ngoài ô không đọc. */}
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]"
                style={{ width: `${O_NGAM.rong * 100}%`, height: `${O_NGAM.cao * 100}%` }}
              >
                <div className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-destructive/80" />
              </div>
              {dangMo && (
                <div className="absolute inset-0 grid place-items-center text-xs text-white/80">Đang mở camera…</div>
              )}
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Đưa mã vạch vào giữa khung, cách 10–15 cm. Tự nhận khi đọc được.
            </p>
          </div>
        )}

        {/* Manual mode */}
        {mode === "manual" && (
          <div className="space-y-3">
            {cameraError && (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs text-destructive">{cameraError}</p>
                <Button type="button" variant="outline" size="sm" onClick={thuLaiCamera}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Thử lại camera
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Nhập mã vạch thủ công hoặc dùng máy quét Bluetooth/USB
            </p>
            <Input
              ref={manualRef}
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleManualSubmit()
                }
              }}
              placeholder="Quét hoặc nhập mã vạch..."
              className="text-center text-lg font-mono h-12"
              autoFocus
            />
            <Button type="button" className="w-full" onClick={handleManualSubmit} disabled={!manualInput.trim()}>
              {manualLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
