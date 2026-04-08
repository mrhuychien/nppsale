"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { SalesOrder } from "@/types"

interface MergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orders: SalesOrder[]
  onMerge: (orderIds: string[]) => void
  loading?: boolean
}

export function MergeDialog({ open, onOpenChange, orders, onMerge, loading }: MergeDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleOrder = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gop don hang</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Chon cac don hang cung khach hang de gop thanh 1 don</p>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {orders.map((o) => (
            <label key={o.id} className="flex items-center gap-3 p-2 rounded hover:bg-accent cursor-pointer">
              <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggleOrder(o.id)} />
              <div className="flex-1">
                <span className="font-mono text-sm">{o.order_code}</span>
                <span className="text-sm text-muted-foreground ml-2">{formatDate(o.order_date)}</span>
              </div>
              <span className="font-medium">{formatCurrency(o.total)}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huy</Button>
          <Button onClick={() => onMerge(Array.from(selected))} disabled={selected.size < 2 || loading}>
            {loading ? "Dang gop..." : `Gop ${selected.size} don`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
