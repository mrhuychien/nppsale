"use client"

/**
 * THÊM KHÁCH TRÊN ĐIỆN THOẠI — BƯỚC 1: TÌM KHÁCH ĐÃ CÓ.
 *
 * ⚠ CHỦ NHÀ 14/10/2026: "phần tạo khách hàng mới trên điện thoại của nhân viên mất phần tìm khách hàng đã có trước
 *   khi tạo rồi" — bản 01/10/2026 đi thẳng vào form. Luật gốc 06/06/2026: khách đã có (kể cả NV khác phụ trách) thì NV
 *   "thêm vào danh sách của tôi" thay vì tạo trùng. Ô tìm ở danh sách khách không thay được: RLS chỉ cho NVBH thấy
 *   khách của mình.
 * ⚠ CHỦ NHÀ 15/10/2026: "chỉ cho tìm kiếm chính xác, nghĩa là nhập đúng số điện thoại của khách thì khách mới hiện ra"
 *   — gõ tên / địa chỉ / số dở không ra gì (`useDoTrungKhach`, mig 245), như bản máy tính.
 *
 * Nhập đủ số → thẻ khách (Thêm vào DS của tôi / Xem khách) → nút đáy "Tạo khách hàng mới" mang số sang form.
 */
import { useMemo, useState } from "react"
import { Search, UserPlus, CheckCircle2 } from "lucide-react"
import Link from "@/components/ui/link"
import { Badge } from "@/components/ui/badge"
import { DauTrangTrang } from "@/components/mobile/dau-trang"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { useDoTrungKhach } from "@/hooks/use-do-trung-khach"
import { errorMessage } from "@/lib/errors"
import { cauNhanKhach, dinhDangSdt, nhanKhachVeDanhSach, type KhachTrung } from "@/lib/customers/tao-khach"

export function TimKhachTruocKhiTao({
  chu,
  onChu,
  onTaoMoi,
  backHref,
}: {
  /** Chữ đang gõ — nằm ở màn cha để bấm lùi từ form về vẫn còn. */
  chu: string
  onChu: (v: string) => void
  /** Không thấy khách phù hợp → sang form tạo mới, mang chữ đang gõ. */
  onTaoMoi: (chu: string) => void
  backHref: string
}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const supabase = useMemo(() => createClient(), [])
  const { tim, ketQua, dangTim, loi, daNhan, chuaDuSo } = useDoTrungKhach(chu)
  const [dangNhan, setDangNhan] = useState<string | null>(null)
  const laNv = user?.role === "sales"

  const nhan = async (k: KhachTrung) => {
    setDangNhan(k.id)
    try {
      toast({ title: cauNhanKhach(await nhanKhachVeDanhSach(supabase, k.id)) })
      daNhan(k.id)
    } catch (e) {
      toast({ title: "Không thêm được vào danh sách", description: errorMessage(e), variant: "destructive" })
    } finally {
      setDangNhan(null)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-surface-container-low">
      <DauTrangTrang title="Thêm khách hàng" subtitle="Tìm khách đã có trước khi tạo" backHref={backHref} />
      <div className="flex flex-col gap-3.5 p-3.5 pb-32">
        <section className="flex flex-col gap-2.5 rounded-2xl border border-outline-variant/60 bg-card p-3.5">
          <h2 className="text-[15px] font-bold text-on-surface">Tìm khách hàng đã có</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Nhập <span className="font-semibold text-on-surface">đúng số điện thoại</span> của khách để xem khách đã có trong
            hệ thống chưa — kể cả khách nhân viên khác đang phụ trách.
          </p>
          <label className="flex h-11 items-center gap-2 rounded-xl border border-outline-variant/60 bg-card px-3 focus-within:border-primary">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <input
              data-testid="tk-tim"
              type="tel"
              inputMode="tel"
              autoFocus
              value={chu}
              onChange={(e) => onChu(e.target.value)}
              placeholder="VD: 0901 234 567"
              aria-label="Số điện thoại khách"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-on-surface outline-none"
            />
          </label>
          {chuaDuSo && (
            <p className="text-xs text-muted-foreground" data-testid="tk-chua-du-so">
              Nhập đủ số điện thoại (10 số) — tên, địa chỉ hay số chưa đủ sẽ không tìm.
            </p>
          )}
        </section>

        {!!tim &&
          (dangTim ? (
            <p className="px-1 text-[13px] italic text-muted-foreground">Đang tìm…</p>
          ) : loi ? (
            <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3.5 text-[13px] text-destructive" data-testid="tk-tim-loi">
              Không tìm được — {loi}. Kiểm tra mạng rồi gõ lại.
            </p>
          ) : ketQua.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-outline-variant bg-card p-3.5 text-[13px]" data-testid="tk-khong-trung">
              <p className="font-semibold text-on-surface">Chưa có khách nào dùng số {dinhDangSdt(tim)}.</p>
              <p className="mt-0.5 text-muted-foreground">Bấm Tạo khách hàng mới ở dưới.</p>
            </div>
          ) : (
            <section className="flex flex-col gap-2.5">
              <h2 className="px-1 text-[13px] text-muted-foreground">
                Đã có <span className="font-semibold text-on-surface">{ketQua.length}</span> khách dùng số này
              </h2>
              {ketQua.map((k) => {
                const cuaToi = !!k.has_my_assignment
                const diaChi = [k.address, k.ward].filter(Boolean).join(", ")
                return (
                  <div key={k.id} data-testid="tk-trung" className="flex flex-col gap-1 rounded-2xl border border-outline-variant/60 bg-card p-3.5">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-on-surface">{k.store_name}</p>
                      {cuaToi && (
                        <Badge variant="success" className="shrink-0 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Trong DS của bạn
                        </Badge>
                      )}
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      {[k.owner_name, k.phone ? dinhDangSdt(k.phone) : null].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {diaChi && <p className="text-[13px] text-muted-foreground">{diaChi}</p>}
                    {k.primary_user_name && (
                      <p className="text-xs text-muted-foreground">
                        Phụ trách chính: <span className="font-semibold text-on-surface">{k.primary_user_name}</span>
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      {laNv && !cuaToi && (
                        <button
                          type="button"
                          data-testid="tk-nhan"
                          onClick={() => nhan(k)}
                          disabled={dangNhan === k.id}
                          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary/10 text-sm font-semibold text-primary disabled:opacity-60"
                        >
                          <UserPlus className="h-4 w-4" />
                          {dangNhan === k.id ? "Đang thêm…" : "Thêm vào DS của tôi"}
                        </button>
                      )}
                      {/* NVBH chỉ mở được khách của mình (RLS) — chưa nhận thì không đưa link dẫn tới trang trống. */}
                      {(cuaToi || !laNv) && (
                        <Link
                          href={`/customers/${k.id}`}
                          data-testid="tk-xem"
                          className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-outline-variant/60 text-sm font-semibold text-on-surface"
                        >
                          Xem khách
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant/60 bg-card px-3.5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2.5">
        <p className="pb-2 text-center text-xs text-muted-foreground">Không thấy khách phù hợp?</p>
        <button
          type="button"
          data-testid="tk-tao-moi"
          onClick={() => onTaoMoi(chu)}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[15px] font-semibold text-primary-foreground"
        >
          <UserPlus className="h-[18px] w-[18px]" /> Tạo khách hàng mới
        </button>
      </div>
    </div>
  )
}
