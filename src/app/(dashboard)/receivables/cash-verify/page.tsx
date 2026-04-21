"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent,  } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  CheckCircle2,
  AlertTriangle,
  Wallet,
  Filter,
} from "lucide-react"

interface CashCollection {
  id: string
  driver_id: string
  work_date: string
  total_collected: number
  total_submitted: number
  discrepancy: number | null
  status: string
  verified_by: string | null
  verified_at: string | null
  driver?: { full_name: string }
}

export default function CashVerifyPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [collections, setCollections] = useState<CashCollection[]>([])
  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10))
  const [processingId, setProcessingId] = useState<string | null>(null)

  const fetchCollections = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from("cash_collections")
      .select("*, driver:users!cash_collections_driver_id_fkey(full_name)")
      .order("work_date", { ascending: false })

    if (filterDate) {
      query = query.eq("work_date", filterDate)
    }

    const { data } = await query
    if (data) setCollections(data as unknown as CashCollection[])
    setLoading(false)
  }, [supabase, filterDate])

  useEffect(() => {
    fetchCollections()
  }, [fetchCollections])

  const handleVerify = async (collectionId: string) => {
    if (!user) return
    setProcessingId(collectionId)
    await supabase
      .from("cash_collections")
      .update({
        verified_by: user.id,
        verified_at: new Date().toISOString(),
        status: "verified",
      })
      .eq("id", collectionId)
    await fetchCollections()
    setProcessingId(null)
  }

  const handleDiscrepancy = async (collectionId: string) => {
    if (!user) return
    const notes = prompt("Ghi chú chênh lệch:")
    if (notes === null) return
    setProcessingId(collectionId)
    await supabase
      .from("cash_collections")
      .update({
        status: "discrepancy",
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      })
      .eq("id", collectionId)
    await fetchCollections()
    setProcessingId(null)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "submitted":
        return <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">Chờ xác nhận</Badge>
      case "verified":
        return <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">Đã xác nhận</Badge>
      case "discrepancy":
        return <Badge variant="outline" className="text-red-700 border-red-200 bg-red-50">Chênh lệch</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title="Xác nhận tiền COD"
        description="Đối soát tiền thu COD từ tài xế"
      />

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <input
          type="date"
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có phiếu nộp tiền"
          description="Không có phiếu nộp tiền nào cho ngày đã chọn"
        />
      ) : (
        <div className="space-y-4">
          {collections.map((c) => {
            const discrepancy = (c.total_collected || 0) - (c.total_submitted || 0)
            return (
              <Card key={c.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {(c.driver as unknown as { full_name: string })?.full_name || "Tài xế"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(c.work_date)}
                      </p>
                    </div>
                    {getStatusBadge(c.status)}
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-surface-low rounded-lg p-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Thu</p>
                      <p className="text-sm font-bold text-foreground">{formatCurrency(c.total_collected)}</p>
                    </div>
                    <div className="bg-surface-low rounded-lg p-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Nộp</p>
                      <p className="text-sm font-bold text-foreground">{formatCurrency(c.total_submitted)}</p>
                    </div>
                    <div className={`rounded-lg p-2 ${discrepancy !== 0 ? "bg-red-50" : "bg-green-50"}`}>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Lệch</p>
                      <p className={`text-sm font-bold ${discrepancy !== 0 ? "text-red-600" : "text-green-600"}`}>
                        {formatCurrency(Math.abs(discrepancy))}
                      </p>
                    </div>
                  </div>

                  {c.status === "submitted" && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleVerify(c.id)}
                        disabled={processingId === c.id}
                        className="flex-1 text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Xác nhận
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDiscrepancy(c.id)}
                        disabled={processingId === c.id}
                        className="flex-1 text-xs text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                        Chênh lệch
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
