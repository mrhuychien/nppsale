"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BarcodeScanner } from "@/components/ui/barcode-scanner"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { findByCode, shouldAcceptScan } from "@/lib/sell/scan"
import { conversionFor, sellableUnits, unitPriceFor } from "@/lib/sell/pricing"
import { toast } from "@/hooks/use-toast"

/**
 * Quét mã vạch — mỗi mã đọc được là +1 vào giỏ, quét liên tục.
 *
 * Dùng lại `BarcodeScanner` của dự án (đã có camera + nhập tay + xử lý
 * lỗi quyền truy cập) thay vì dựng bộ quét thứ hai.
 */
export default function SellScanPage() {
  const router = useRouter()
  const cart = useSellCart()
  const { products, stockByProduct, customerById } = useSellData()
  const lastRef = useRef<{ code: string; at: number } | null>(null)
  const [added, setAdded] = useState(0)

  const groupId = customerById(cart.customerId)?.group_id ?? null

  const handleScan = (raw: string) => {
    const now = Date.now()
    // Xem chú thích trong src/lib/sell/scan.ts — camera bắn 10 lần/giây.
    if (!shouldAcceptScan(raw, lastRef.current, now)) return
    lastRef.current = { code: raw.trim(), at: now }

    const p = findByCode(products, raw)
    if (!p) {
      toast({ title: "Không tìm thấy sản phẩm", description: `Mã: ${raw}`, variant: "destructive" })
      return
    }
    if ((stockByProduct[p.id] ?? 0) <= 0) {
      toast({ title: `Hết hàng: ${p.name}`, variant: "destructive" })
      return
    }
    // Quét thì thêm theo ĐƠN VỊ CƠ SỞ: mã vạch in trên vỏ hộp là mã của
    // hộp, không phải của thùng.
    const unit = sellableUnits(p)[0]
    const price = unitPriceFor(p, unit, groupId)
    cart.addLine({
      productId: p.id,
      unit,
      qty: 1,
      price,
      listPrice: price,
      note: "",
      conversion: conversionFor(p, unit),
      vatRate: Number(p.vat_rate ?? 0),
    })
    setAdded((n) => n + 1)
    toast({ title: `+1 ${unit} · ${p.name}` })
  }

  return (
    <>
      <BarcodeScanner
        open
        onClose={() => router.back()}
        onScan={handleScan}
        title={added > 0 ? `Quét mã vạch · đã thêm ${added}` : "Quét mã vạch"}
      />
    </>
  )
}
