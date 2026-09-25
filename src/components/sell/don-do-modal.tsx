"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useSellCart } from "@/hooks/use-sell-cart"
import { coDonDangLamDo, hoiKhiVaoTrang } from "@/lib/sell/don-do"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

/**
 * Hỏi MỘT lần mỗi lần vào luồng bán hàng (layout /sell gắn lại), ngay khi giỏ đã đọc
 * xong bộ nhớ. Đi lại giữa các màn trong luồng không hỏi lại. Xem `lib/sell/don-do.ts`.
 */
export function DonDoModal() {
  const cart = useSellCart()
  const pathname = usePathname() ?? ""
  const daXet = useRef(false)
  const [mo, setMo] = useState(false)

  useEffect(() => {
    if (!cart.ready || daXet.current) return
    daXet.current = true
    if (hoiKhiVaoTrang(pathname) && coDonDangLamDo(cart)) setMo(true)
  }, [cart, pathname])

  const soMon = cart.cart.length + cart.returnLines.length
  return (
    <>
    {/* Đóng bằng dấu X = giữ đơn dở (không bao giờ tự xoá giỏ khi người dùng chưa bấm "Không"). */}
    <Dialog open={mo} onOpenChange={(v) => { if (!v) setMo(false) }}>
      <DialogContent className="max-w-sm" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Bạn có đơn hàng đang làm dở</DialogTitle>
          <DialogDescription>Bạn có muốn tiếp tục?</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground" data-don-do-tom-tat>
          {cart.editing?.orderCode ? `Đang sửa đơn ${cart.editing.orderCode} · ` : ""}
          {soMon} mặt hàng · {formatCurrency(cart.totals.grandTotal)}
        </p>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={() => {
              cart.clear()
              setMo(false)
            }}
          >
            Không
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={() => setMo(false)}>
            Có
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
