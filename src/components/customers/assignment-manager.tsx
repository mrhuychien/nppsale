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
import { errorMessage } from "@/lib/errors"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import { formatCurrency } from "@/lib/utils"
import { loiNhanVien } from "@/lib/users/nghi-viec"

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
  /* Nợ NPP đang giữ của khách (NV cũ nghỉ việc — mig 223): giao kèm khi phân công NV chính.
     Chủ nhà 02/10/2026: "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối lại sau". */
  const [noNpp, setNoNpp] = useState<{ so: number; tien: number }>({ so: 0, tien: 0 })
  const [giaoNo, setGiaoNo] = useState(true)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    let huy = false
    supabase
      .from("receivables")
      .select("amount, paid")
      .eq("customer_id", customerId)
      .not("ve_npp_luc", "is", null)
      .neq("status", "paid")
      .then(({ data, error }) => {
        // DB chưa chạy mig 223 → không có cột → coi như không có nợ NPP giữ.
        if (huy || error || !data) return
        const ds = data as Array<{ amount: number | null; paid: number | null }>
        setNoNpp({ so: ds.length, tien: ds.reduce((t, r) => t + (Number(r.amount) || 0) - (Number(r.paid) || 0), 0) })
      })
    return () => { huy = true }
  }, [customerId, assignments.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchSalesUsers() {
      const { data, error: dataErr } = await supabase.from("users").select("id, full_name").eq("role", "sales").eq("is_active", true)
      if (dataErr) console.error("[customers] truy vấn lỗi:", dataErr.message)
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
      if (assignRole === "primary" && noNpp.so > 0 && giaoNo) {
        const { error: gErr } = await supabase.rpc("giao_cong_no_npp", { p_customer_id: customerId, p_user_id: selectedUser })
        if (gErr) {
          toast({ title: "Đã phân công, nhưng chưa giao được công nợ", description: loiNhanVien(gErr.message), variant: "destructive" })
          setSelectedUser("")
          onUpdate()
          return
        }
        setNoNpp({ so: 0, tien: 0 })
      }
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
    /* ⚠ HAI LỖI TRONG BA DÒNG CŨ. `error` rỗng không có nghĩa là đã xoá
       — RLS từ chối thì PostgREST trả 200 kèm mảng rỗng, nên nhánh
       `if (!error)` chạy và màn hình báo "Đã xóa phân công" trong khi
       phân công vẫn còn. Và khi CÓ lỗi thật thì không có nhánh `else`
       nào cả: màn hình đứng im, không toast, không log. Người dùng bấm
       Xoá, không thấy gì xảy ra, bấm lại. Xem `@/lib/db/must-write`. */
    try {
      await ghiPhaiTrungDong(supabase.from("customer_assignments").delete().eq("id", id))
      toast({ title: "Đã xóa phân công" })
      onUpdate()
    } catch (err) {
      toast({ title: "Không xoá được phân công", description: errorMessage(err), variant: "destructive" })
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

      {noNpp.so > 0 && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="giao-no-npp">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={giaoNo}
            onChange={(e) => setGiaoNo(e.target.checked)}
            disabled={assignRole !== "primary"}
          />
          <span>
            NPP đang giữ <b>{noNpp.so} khoản nợ · {formatCurrency(noNpp.tien)}</b> của khách này (NV cũ đã nghỉ).
            {assignRole === "primary" ? " Giao luôn cho NV chính được phân công." : " Chỉ giao nợ cho NV chính."}
          </span>
        </label>
      )}

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
