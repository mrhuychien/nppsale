"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { Trash2, Plus } from "lucide-react"
import type { PriceList, CustomerGroup, ProductUnit } from "@/types"

interface PriceListManagerProps {
  productId: string
  baseUnit: string
  units: ProductUnit[]
  priceLists: PriceList[]
  customerGroups: Pick<CustomerGroup, "id" | "name">[]
  onUpdate: () => void
}

export function PriceListManager({
  productId, baseUnit, units, priceLists, customerGroups, onUpdate,
}: PriceListManagerProps) {
  const [unitName, setUnitName] = useState(baseUnit)
  const [groupId, setGroupId] = useState("all")
  const [price, setPrice] = useState("")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  const allUnits = [baseUnit, ...units.map((u) => u.unit_name)]

  const handleAdd = async () => {
    if (!price) return
    setLoading(true)
    try {
      const { error } = await supabase.from("price_lists").insert({
        product_id: productId,
        group_id: groupId === "all" ? null : groupId,
        unit_name: unitName,
        price: parseInt(price),
        effective_from: new Date().toISOString().slice(0, 10),
      })
      if (error) throw error
      setPrice("")
      toast({ title: "Đã thêm giá" })
      onUpdate()
    } catch {
      toast({ title: "Lỗi", description: "Không thể thêm giá", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("price_lists").delete().eq("id", id)
    if (!error) {
      toast({ title: "Đã xóa" })
      onUpdate()
    }
  }

  return (
    <div className="space-y-4">
      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nhóm KH</TableHead>
              <TableHead>ĐVT</TableHead>
              <TableHead className="text-right">Giá bán</TableHead>
              <TableHead>Hiệu lực</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {priceLists.map((pl) => (
              <TableRow key={pl.id}>
                <TableCell>{pl.group ? pl.group.name : "Tất cả"}</TableCell>
                <TableCell>{pl.unit_name}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(pl.price)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{pl.effective_from || "-"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(pl.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {priceLists.length === 0 ? (
          <p className="text-center text-muted-foreground py-4 text-sm">Chưa có giá nào</p>
        ) : (
          priceLists.map((pl) => (
            <div key={pl.id} className="rounded-xl border bg-muted/20 p-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {pl.group ? pl.group.name : "Tất cả"} • {pl.unit_name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Hiệu lực: {pl.effective_from || "-"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm">{formatCurrency(pl.price)}</p>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => handleDelete(pl.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Nhóm KH" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            {customerGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={unitName} onValueChange={setUnitName}>
          <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {allUnits.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="number" placeholder="Giá bán (VND)" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full sm:w-40" />
        <Button onClick={handleAdd} disabled={loading} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> Thêm giá
        </Button>
      </div>
    </div>
  )
}
