"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ProductForm } from "./product-form"
import type { Product } from "@/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the new product is saved successfully. */
  onCreated?: (product: Product) => void
  /** "compact" hides Vị trí + trọng lượng for faster entry. Default full. */
  variant?: "full" | "compact"
}

export function ProductCreateDialog({
  open,
  onOpenChange,
  onCreated,
  variant = "compact",
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo hàng hóa</DialogTitle>
        </DialogHeader>
        <ProductForm
          variant={variant}
          onSaved={(p) => {
            onCreated?.(p)
            onOpenChange(false)
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
