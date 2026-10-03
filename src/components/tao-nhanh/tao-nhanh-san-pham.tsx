"use client"

/**
 * Tạo nhanh SẢN PHẨM tại chỗ — tạo xong trả sản phẩm cho nơi gọi (thêm luôn vào phiếu đang làm). Chủ nhà
 * 03/10/2026, Update 3.10. Thay cho `ProductCreateDialog` cũ (không nơi nào dùng).
 */
import { KhungTaoNhanh } from "@/components/ui/khung-tao-nhanh"
import { ProductForm } from "@/components/products/product-form"
import type { Product } from "@/types"

export function TaoNhanhSanPham({
  open,
  onOpenChange,
  chuBanDau,
  nccBanDau,
  onDaTao,
  moTa = "Tạo xong sản phẩm được thêm luôn vào phiếu đang làm.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chữ đang gõ ở ô tìm mặt hàng — thành tên hàng. */
  chuBanDau?: string
  /** NCC gán sẵn (NCC của phiếu đang làm) — người dùng vẫn đổi được. */
  nccBanDau?: string
  onDaTao: (sanPham: Product) => void
  moTa?: string
}) {
  return (
    <KhungTaoNhanh open={open} onOpenChange={onOpenChange} tieuDe="Tạo sản phẩm mới" moTa={moTa} testId="tao-nhanh-san-pham">
      {open && (
        <ProductForm
          variant="compact"
          tenBanDau={chuBanDau}
          nccBanDau={nccBanDau}
          anTaoThem
          onSaved={(p) => {
            onDaTao(p)
            onOpenChange(false)
          }}
          onCancel={() => onOpenChange(false)}
        />
      )}
    </KhungTaoNhanh>
  )
}
