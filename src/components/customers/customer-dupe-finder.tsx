"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { useDoTrungKhach } from "@/hooks/use-do-trung-khach"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, UserPlus, CheckCircle2, MapPin, Phone, User as UserIcon } from "lucide-react"
import Link from "@/components/ui/link"
import { errorMessage } from "@/lib/errors"
import { cauNhanKhach, dinhDangSdt, nhanKhachVeDanhSach, type KhachTrung } from "@/lib/customers/tao-khach"

interface CustomerDupeFinderProps {
  /** Gọi khi user khẳng định không trùng — tiếp tục tạo mới. */
  onConfirmCreateNew: (initialQuery: string) => void
}

/** Máy tính: tìm khách đã có trước khi tạo. Điện thoại: `TimKhachTruocKhiTao` — cùng `useDoTrungKhach`. */
export function CustomerDupeFinder({ onConfirmCreateNew }: CustomerDupeFinderProps) {
  const { user } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()

  const [query, setQuery] = useState("")
  const { tim: debounced, ketQua: results, dangTim: searching, loi, daNhan, chuaDuSo } = useDoTrungKhach(query)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const isSales = user?.role === "sales"

  useEffect(() => {
    if (loi) toast({ title: "Lỗi tìm kiếm", description: loi, variant: "destructive" })
  }, [loi]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaim = async (row: KhachTrung) => {
    setClaimingId(row.id)
    try {
      toast({ title: cauNhanKhach(await nhanKhachVeDanhSach(supabase, row.id)) })
      daNhan(row.id)
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-bold">Tìm khách hàng đã có</h2>
        {/* Chủ nhà 15/10/2026: "chỉ cho tìm kiếm chính xác, nghĩa là nhập đúng số điện thoại của khách thì khách mới hiện ra". */}
        <p className="text-sm text-muted-foreground mt-1">
          Trước khi thêm mới, hãy kiểm tra xem khách hàng đã tồn tại trong hệ thống chưa. Nhập
          <span className="font-semibold"> đúng số điện thoại</span> của khách để tìm.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          type="tel"
          inputMode="tel"
          placeholder="VD: 0901 234 567"
          aria-label="Số điện thoại khách"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      {chuaDuSo && (
        <p className="text-xs text-muted-foreground" data-testid="dupe-chua-du-so">
          Nhập đủ số điện thoại (10 số) — tên, địa chỉ hay số chưa đủ sẽ không tìm.
        </p>
      )}

      {/* Kết quả */}
      {!!debounced && (
        <div className="space-y-2">
          {searching ? (
            <p className="text-xs text-muted-foreground italic">Đang tìm...</p>
          ) : results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-sm">
              <p className="font-medium">Chưa có khách hàng nào dùng số {dinhDangSdt(debounced)}.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bạn có thể tạo khách hàng mới với thông tin đầy đủ ở bên dưới.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Đã có <span className="font-semibold text-foreground">{results.length}</span> khách hàng dùng số này:
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
