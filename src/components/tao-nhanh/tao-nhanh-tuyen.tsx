"use client"

/** Tạo nhanh TUYẾN BÁN HÀNG tại chỗ — tạo xong trả tuyến cho nơi gọi tự chọn (chủ nhà 03/10/2026). */
import { KhungTaoNhanh } from "@/components/ui/khung-tao-nhanh"
import { RouteForm } from "@/components/customers/route-form"
import type { TuyenVuaTao } from "@/lib/customers/tuyen"

export function TaoNhanhTuyen({
  open,
  onOpenChange,
  chuBanDau,
  onDaTao,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chữ đang gõ ở ô tìm tuyến. */
  chuBanDau?: string
  onDaTao: (tuyen: TuyenVuaTao) => void
}) {
  return (
    <KhungTaoNhanh
      open={open}
      onOpenChange={onOpenChange}
      tieuDe="Thêm tuyến bán hàng"
      moTa="Mã tuyến là duy nhất trong tổ chức, viết hoa (VD: GT, MT, HORECA, TUYEN1)."
      testId="tao-nhanh-tuyen"
    >
      {open && (
        <RouteForm
          chuBanDau={chuBanDau}
          onDaLuu={(t) => {
            onDaTao(t)
            onOpenChange(false)
          }}
          onHuy={() => onOpenChange(false)}
        />
      )}
    </KhungTaoNhanh>
  )
}
