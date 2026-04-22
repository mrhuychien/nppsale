"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Camera, Keyboard } from "lucide-react"

interface BarcodeScannerProps {
  open: boolean
  onClose: () => void
  onScan: (code: string) => void
  title?: string
}

export function BarcodeScanner({ open, onClose, onScan, title = "Quét mã vạch" }: BarcodeScannerProps) {
  const [mode, setMode] = useState<"camera" | "manual">("camera")
  const [manualInput, setManualInput] = useState("")
  const [cameraError, setCameraError] = useState("")
  const scannerRef = useRef<HTMLDivElement>(null)
  const html5QrCodeRef = useRef<unknown>(null)
  const manualRef = useRef<HTMLInputElement>(null)

  // Start/stop camera scanner
  useEffect(() => {
    if (!open || mode !== "camera") return

    let scanner: { clear: () => Promise<void>; stop: () => Promise<void> } | null = null

    async function startScanner() {
      try {
        setCameraError("")
        const { Html5Qrcode } = await import("html5-qrcode")
        const scannerId = "barcode-scanner-region"

        // Ensure container exists
        if (!document.getElementById(scannerId)) return

        const html5QrCode = new Html5Qrcode(scannerId)
        html5QrCodeRef.current = html5QrCode
        scanner = html5QrCode

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 280, height: 150 },
            aspectRatio: 1.5,
          },
          (decodedText: string) => {
            onScan(decodedText)
          },
          () => {
            // Ignore scan failures (continuous scanning)
          }
        )
      } catch (err) {
        console.error("Camera error:", err)
        setCameraError(
          err instanceof Error ? err.message : "Không thể mở camera. Vui lòng dùng chế độ nhập tay."
        )
        setMode("manual")
      }
    }

    // Small delay to ensure DOM is ready
    const timer = setTimeout(startScanner, 200)

    return () => {
      clearTimeout(timer)
      if (scanner) {
        scanner.stop().catch(() => {})
        scanner.clear().catch(() => {})
      }
    }
  }, [open, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus manual input
  useEffect(() => {
    if (open && mode === "manual") {
      setTimeout(() => manualRef.current?.focus(), 100)
    }
  }, [open, mode])

  // Cleanup on close
  useEffect(() => {
    if (!open && html5QrCodeRef.current) {
      const s = html5QrCodeRef.current as { stop: () => Promise<void>; clear: () => Promise<void> }
      s.stop().catch(() => {})
      s.clear().catch(() => {})
      html5QrCodeRef.current = null
    }
  }, [open])

  if (!open) return null

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      onScan(manualInput.trim())
      setManualInput("")
      manualRef.current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-card w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl border-t sm:border border-border/40 p-5 space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">{title}</h3>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode("camera")}
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
            {cameraError ? (
              <div className="text-center py-8 space-y-2">
                <p className="text-sm text-destructive">{cameraError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("manual")}>
                  Chuyển sang nhập tay
                </Button>
              </div>
            ) : (
              <>
                <div
                  id="barcode-scanner-region"
                  ref={scannerRef}
                  className="rounded-xl overflow-hidden bg-black"
                />
                <p className="text-xs text-center text-muted-foreground">
                  Hướng camera vào mã vạch. Tự động nhận diện khi quét thành công.
                </p>
              </>
            )}
          </div>
        )}

        {/* Manual mode */}
        {mode === "manual" && (
          <div className="space-y-3">
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
              Thêm sản phẩm
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
