"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { Trash2, Plus } from "lucide-react"
import type { ProductUnit } from "@/types"

interface UnitManagerProps {
  productId: string
  baseUnit: string
  units: ProductUnit[]
  onUpdate: () => void
}

export function UnitManager({ productId, baseUnit, units, onUpdate }: UnitManagerProps) {
  const [newUnit, setNewUnit] = useState("")
  const [newConversion, setNewConversion] = useState("")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  const handleAdd = async () => {
    if (!newUnit || !newConversion) return
    setLoading(true)
    try {
      const { error } = await supabase.from("product_units").insert({
        product_id: productId,
        unit_name: newUnit,
        conversion: parseInt(newConversion),
      })
      if (error) throw error
      setNewUnit("")
      setNewConversion("")
      toast({ title: "Da them don vi tinh" })
      onUpdate()
    } catch {
      toast({ title: "Loi", description: "Khong the them don vi tinh", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("product_units").delete().eq("id", id)
    if (error) {
      toast({ title: "Loi", description: "Khong the xoa", variant: "destructive" })
      return
    }
    toast({ title: "Da xoa don vi tinh" })
    onUpdate()
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Don vi</TableHead>
            <TableHead>Quy doi</TableHead>
            <TableHead className="w-16"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">{baseUnit}</TableCell>
            <TableCell>1 (co ban)</TableCell>
            <TableCell></TableCell>
          </TableRow>
          {units.map((unit) => (
            <TableRow key={unit.id}>
              <TableCell>{unit.unit_name}</TableCell>
              <TableCell>= {unit.conversion} {baseUnit}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(unit.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-2">
        <Input placeholder="Ten DVT (VD: Thung)" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
        <Input type="number" placeholder="Quy doi" value={newConversion} onChange={(e) => setNewConversion(e.target.value)} className="w-32" />
        <Button onClick={handleAdd} disabled={loading} size="icon">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
