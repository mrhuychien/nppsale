"use client"

/** Tạo nhanh NHÀ CUNG CẤP tại chỗ — tạo xong trả NCC cho nơi gọi tự chọn (chủ nhà 03/10/2026, Update 3.10). */
import { KhungTaoNhanh } from "@/components/ui/khung-tao-nhanh"
import { SupplierForm, type NccVuaTao } from "@/components/suppliers/supplier-form"

export function TaoNhanhNcc({
  open,
  onOpenChange,
  chuBanDau,
  onDaTao,
  moTa = "Tạo xong NCC được chọn luôn vào phiếu đang làm.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chữ đang gõ ở ô tìm NCC — thành tên NCC. */
  chuBanDau?: string
  onDaTao: (ncc: NccVuaTao) => void
  moTa?: string
}) {
  return (
    <KhungTaoNhanh
      open={open}
      onOpenChange={onOpenChange}
      tieuDe="Thêm nhà cung cấp mới"
      moTa={moTa}
      testId="tao-nhanh-ncc"
    >
      {open && (
        <SupplierForm
          tenBanDau={chuBanDau}
          onDaTao={(n) => {
            onDaTao(n)
            onOpenChange(false)
          }}
          onHuy={() => onOpenChange(false)}
        />
      )}
    </KhungTaoNhanh>
  )
}
