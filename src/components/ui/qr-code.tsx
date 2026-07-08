"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { cn } from "@/lib/utils"

interface QrCodeProps {
  /** Nội dung nhúng vào mã (thường là 1 URL). */
  value: string
  /** Cạnh mã QR tính bằng px. Mặc định 220. */
  size?: number
  className?: string
}

/**
 * Dựng mã QR hoàn toàn phía client (không gọi dịch vụ ngoài — token nhạy
 * cảm). Trả về SVG nên in / phóng to đều nét.
 */
export function QrCode({ value, size = 220, className }: QrCodeProps) {
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setError(false)
    QRCode.toString(value, {
      type: "svg",
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1220", light: "#ffffff" },
    })
      .then((out) => {
        if (active) setSvg(out)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [value, size])

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-outline-variant bg-surface-container-low text-xs text-on-surface-variant",
          className
        )}
        style={{ width: size, height: size }}
      >
        Không dựng được mã QR
      </div>
    )
  }

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-xl bg-white p-3 shadow-card ring-1 ring-outline-variant/60",
        className
      )}
      style={{ width: size + 24, height: size + 24 }}
      // qrcode trả SVG tin cậy (dựng local), an toàn để nhúng.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
