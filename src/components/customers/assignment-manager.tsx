"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { Trash2, Plus } from "lucide-react"
import type { CustomerAssignment, User } from "@/types"

interface AssignmentManagerProps {
  customerId: string
  assignments: CustomerAssignment[]
  onUpdate: () => void
}

export function AssignmentManager({ customerId, assignments, onUpdate }: AssignmentManagerProps) {
  const [salesUsers, setSalesUsers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState("")
  const [assignRole, setAssignRole] = useState("primary")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    async function fetchSalesUsers() {
      const { data } = await supabase.from("users").select("*").eq("role", "sales").eq("is_active", true)
      setSalesUsers((data as User[]) || [])
    }
    fetchSalesUsers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAssign = async () => {
    if (!selectedUser) return
    setLoading(true)
    try {
      const { error } = await supabase.from("customer_assignments").insert({
        customer_id: customerId,
        user_id: selectedUser,
        role: assignRole,
      })
      if (error) throw error
      toast({ title: "Da phan cong nhan vien" })
      setSelectedUser("")
      onUpdate()
    } catch {
      toast({ title: "Loi", description: "Khong the phan cong", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (id: string) => {
    const { error } = await supabase.from("customer_assignments").delete().eq("id", id)
    if (!error) {
      toast({ title: "Da xoa phan cong" })
      onUpdate()
    }
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nhan vien</TableHead>
            <TableHead>Vai tro</TableHead>
            <TableHead>Ngay phan cong</TableHead>
            <TableHead className="w-16"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignments.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.user?.full_name || a.user_id}</TableCell>
              <TableCell>
                <Badge variant={a.role === "primary" ? "default" : "secondary"}>
                  {a.role === "primary" ? "Chinh" : "Phu"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{a.assigned_at}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => handleRemove(a.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-wrap gap-2">
        <Select value={selectedUser} onValueChange={setSelectedUser}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Chon NV Sales" /></SelectTrigger>
          <SelectContent>
            {salesUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assignRole} onValueChange={setAssignRole}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="primary">Chinh</SelectItem>
            <SelectItem value="secondary">Phu</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleAssign} disabled={loading || !selectedUser}>
          <Plus className="mr-2 h-4 w-4" /> Phan cong
        </Button>
      </div>
    </div>
  )
}
