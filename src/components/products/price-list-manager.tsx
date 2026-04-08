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
  customerGroups: CustomerGroup[]
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
      toast({ title: "Da them gia" })
      onUpdate()
    } catch {
      toast({ title: "Loi", description: "Khong the them gia", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("price_lists").delete().eq("id", id)
    if (!error) {
      toast({ title: "Da xoa" })
      onUpdate()
    }
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nhom KH</TableHead>
            <TableHead>DVT</TableHead>
            <TableHead className="text-right">Gia ban</TableHead>
            <TableHead>Hieu luc</TableHead>
            <TableHead className="w-16"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {priceLists.map((pl) => (
            <TableRow key={pl.id}>
              <TableCell>{pl.group ? pl.group.name : "Tat ca"}</TableCell>
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

      <div className="flex flex-wrap gap-2">
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Nhom KH" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tat ca</SelectItem>
            {customerGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={unitName} onValueChange={setUnitName}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {allUnits.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="number" placeholder="Gia ban (VND)" value={price} onChange={(e) => setPrice(e.target.value)} className="w-40" />
        <Button onClick={handleAdd} disabled={loading}>
          <Plus className="mr-2 h-4 w-4" /> Them gia
        </Button>
      </div>
    </div>
  )
}
