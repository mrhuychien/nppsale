"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, UserPlus, CheckCircle2, MapPin, Phone, User as UserIcon } from "lucide-react"
import Link from "next/link"

interface DupeRow {
  id: string
  store_name: string
  owner_name: string
  phone: string
  address: string | null
  ward: string | null
  primary_user_name: string | null
  has_my_assignment: boolean
}

interface CustomerDupeFinderProps {
  /** Gọi khi user khẳng định không trùng — tiếp tục tạo mới. */
  onConfirmCreateNew: (initialQuery: string) => void
}

export function CustomerDupeFinder({ onConfirmCreateNew }: CustomerDupeFinderProps) {
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DupeRow[]>([])
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const isSales = user?.role === "sales"

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (debounced.length < 2) {
        setResults([])
        return
      }
      setSearching(true)
      const { data, error } = await supabase.rpc("search_customer_dupes", { p_q: debounced })
      if (cancelled) return
      if (error) {
        toast({ title: "Lỗi tìm kiếm", description: error.message, variant: "destructive" })
        setResults([])
      } else {
        setResults((data as DupeRow[]) || [])
      }
      setSearching(false)
    }
    run()
    return () => { cancelled = true }
  }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaim = async (row: DupeRow) => {
    setClaimingId(row.id)
    try {
      const { data, error } = await supabase.rpc("claim_customer_for_me", { p_customer_id: row.id })
      if (error) throw error
      const status = (data as { status?: string; role?: string } | null)?.status
      const role = (data as { status?: string; role?: string } | null)?.role
      if (status === "already_assigned") {
        toast({ title: "Khách đã trong danh sách của bạn" })
      } else if (status === "claimed") {
        toast({
          title: `Đã thêm vào danh sách (${role === "primary" ? "phụ trách chính" : "phụ trách phụ"})`,
        })
      }
      // Refresh row state
      setResults((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, has_my_assignment: true } : r))
      )
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-bold">Tìm khách hàng đã có</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Trước khi thêm mới, hãy kiểm tra xem khách hàng đã tồn tại trong hệ thống chưa. Gõ
          <span className="font-semibold"> SĐT, địa chỉ hoặc tên</span> để tìm.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="VD: 0901xxx, Hồng Bàng, Tạp hóa Hai..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {/* Kết quả */}
      {debounced.length >= 2 && (
        <div className="space-y-2">
          {searching ? (
            <p className="text-xs text-muted-foreground italic">Đang tìm...</p>
          ) : results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-sm">
              <p className="font-medium">Không tìm thấy khách hàng nào trùng.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bạn có thể tạo khách hàng mới với thông tin đầy đủ ở bên dưới.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Tìm thấy <span className="font-semibold text-foreground">{results.length}</span> khách hàng có thể trùng:
              </p>
              <div className="grid gap-2 max-h-96 overflow-y-auto">
                {results.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border bg-background p-3 space-y-2 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold truncate">{r.store_name}</h3>
                          {r.has_my_assignment && (
                            <Badge variant="success" className="gap-1 shrink-0">
                              <CheckCircle2 className="h-3 w-3" /> Trong DS của bạn
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <UserIcon className="h-3 w-3" /> {r.owner_name}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3" /> {r.phone}
                          </span>
                          {(r.address || r.ward) && (
                            <span className="flex items-center gap-1.5">
                              <MapPin className="h-3 w-3" />
                              {[r.address, r.ward].filter(Boolean).join(", ")}
                            </span>
                          )}
                          {r.primary_user_name && (
                            <span className="text-[11px]">
                              Phụ trách chính: <span className="font-medium text-foreground">{r.primary_user_name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        {isSales && !r.has_my_assignment && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleClaim(r)}
                            disabled={claimingId === r.id}
                          >
                            <UserPlus className="h-3.5 w-3.5 mr-1" />
                            {claimingId === r.id ? "Đang thêm..." : "Thêm vào DS của tôi"}
                          </Button>
                        )}
                        <Link
                          href={`/customers/${r.id}`}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
                        >
                          Xem chi tiết
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="border-t border-border/40 pt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Không thấy khách hàng phù hợp? Bấm bên phải để tạo mới.
        </p>
        <Button onClick={() => onConfirmCreateNew(query)} size="sm">
          <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Tạo khách hàng mới
        </Button>
      </div>
    </div>
  )
}
