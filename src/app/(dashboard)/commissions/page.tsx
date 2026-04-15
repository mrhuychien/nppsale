"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import { Award, Trophy } from "lucide-react"
import Link from "next/link"
import type { CommissionWallet } from "@/types"

export default function CommissionsPage() {
  const { loading: authLoading } = useRoleGuard("commissions")
  const [wallets, setWallets] = useState<CommissionWallet[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("commission_wallets")
        .select("*, user:users(*)")
        .order("earned", { ascending: false })
      setWallets((data as CommissionWallet[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Hoa hồng" description="Tự thưởng và bảng xếp hạng NV">
        <Button variant="outline" asChild>
          <Link href="/commissions/policies">Chính sách hoa hồng</Link>
        </Button>
      </PageHeader>

      {wallets.length === 0 ? (
        <EmptyState icon={<Award className="h-8 w-8 text-muted-foreground" />} title="Chưa có dữ liệu hoa hồng" description="Hoa hồng sẽ được tính từ đơn hàng đã giao" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500" /> Bảng xếp hạng</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Nhân viên</TableHead>
                    <TableHead>Kỳ</TableHead>
                    <TableHead className="text-right">Hoa hồng</TableHead>
                    <TableHead className="text-right">Đã chi</TableHead>
                    <TableHead className="text-right">Còn lại</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallets.map((w, i) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-bold">{i + 1}</TableCell>
                      <TableCell className="font-medium">{w.user?.full_name || "-"}</TableCell>
                      <TableCell>{w.period}</TableCell>
                      <TableCell className="text-right">{formatCurrency(w.earned)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(w.paid)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(w.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
