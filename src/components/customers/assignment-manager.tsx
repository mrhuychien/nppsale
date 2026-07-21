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
      const { data } = await supabase.from("users").select("id, full_name").eq("role", "sales").eq("is_active", true)
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
      toast({ title: "Đã phân công nhân viên" })
      setSelectedUser("")
      onUpdate()
    } catch {
      toast({ title: "Lỗi", description: "Không thể phân công", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (id: string) => {
    const { error } = await supabase.from("customer_assignments").delete().eq("id", id)
    if (!error) {
      toast({ title: "Đã xóa phân công" })
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
              <TableHead>Nhân viên</TableHead>
              <TableHead>Vai trò</TableHead>
              <TableHead>Ngày phân công</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.user?.full_name || a.user_id}</TableCell>
                <TableCell>
                  <Badge variant={a.role === "primary" ? "default" : "secondary"}>
                    {a.role === "primary" ? "Chính" : "Phụ"}
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
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {assignments.length === 0 ? (
          <p className="text-center text-muted-foreground py-4 text-sm">Chưa có phân công</p>
        ) : (
          assignments.map((a) => (
            <div key={a.id} className="rounded-xl border bg-muted/20 p-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{a.user?.full_name || a.user_id}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={a.role === "primary" ? "default" : "secondary"} className="text-xs">
                    {a.role === "primary" ? "Chính" : "Phụ"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{a.assigned_at}</span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => handleRemove(a.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={selectedUser} onValueChange={setSelectedUser}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Chọn NV Sales" /></SelectTrigger>
          <SelectContent>
            {salesUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assignRole} onValueChange={setAssignRole}>
          <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="primary">Chính</SelectItem>
            <SelectItem value="secondary">Phụ</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleAssign} disabled={loading || !selectedUser} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> Phân công
        </Button>
      </div>
    </div>
  )
}
