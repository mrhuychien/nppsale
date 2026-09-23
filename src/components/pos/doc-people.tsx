"use client"

/**
 * NGƯỜI TẠO · NGƯỜI ĐƯỢC GÁN — khối nhỏ ở cột phải của các màn chứng từ POS.
 *
 * ⚠ CHỦ NHÀ YÊU CẦU 23/09/2026: "Đơn hàng, Bán hàng, Trả lại: các phiếu có
 *   Người tạo, Người được gán (chỉ NPP có quyền gán)". Hai người khác nhau
 *   khi NPP lập hộ nhân viên — xem đầu tệp mig 178.
 *
 * ⚠ TÊN NGƯỜI TẠO TRA RIÊNG, KHÔNG LẤY TỪ DANH SÁCH NHÂN VIÊN BÁN. Người
 *   lập phiếu có thể là kế toán / thủ kho — không nằm trong `sellers`.
 *   Tra hỏng hoặc chưa rõ thì ghi "chưa rõ", không in một cái tên đoán.
 *
 * ⚠ Ô GÁN CHỈ HIỆN CHO CHỦ / QUẢN LÝ — đúng luật máy chủ (mig 153 cho đơn,
 *   `assign_doc_seller` mig 178 cho hóa đơn / phiếu trả). Người khác chỉ đọc.
 */

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { usePosRefData } from "@/store/pos/ref-data"
import { SellerPicker } from "@/components/pos/seller-picker"

/** Chủ / quản lý — ai được gán người phụ trách. */
export function coQuyenGan(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager"
}

export function DocPeople({
  createdById,
  assignedId,
  onAssign,
  busy = false,
  note,
}: {
  createdById: string | null | undefined
  assignedId: string | null | undefined
  /** Có thì chủ / quản lý đổi được người được gán; không có thì chỉ đọc. */
  onAssign?: (userId: string) => void
  busy?: boolean
  /** Một dòng giải thích dưới ô gán (vd "lưu khi bấm Lưu đơn"). */
  note?: string
}) {
  const { user } = useAuth()
  const { sellers } = usePosRefData()
  const [ten, setTen] = useState<Record<string, string>>({})

  const can = [createdById, assignedId].filter(
    (x): x is string => !!x && !sellers.some((s) => s.id === x) && !ten[x]
  )
  const canKey = can.join(",")
  useEffect(() => {
    if (!canKey) return
    let huy = false
    createClient()
      .from("users")
      .select("id, full_name")
      .in("id", canKey.split(","))
      .then(({ data }) => {
        if (huy || !data) return
        const moi: Record<string, string> = {}
        for (const u of data as Array<{ id: string; full_name: string | null }>) moi[u.id] = u.full_name || "—"
        setTen((t) => ({ ...t, ...moi }))
      })
    return () => { huy = true }
  }, [canKey])

  const tenCua = (id: string | null | undefined) =>
    !id ? null : sellers.find((s) => s.id === id)?.full_name ?? ten[id] ?? null

  const choGan = !!onAssign && coQuyenGan(user?.role)

  return (
    <div data-testid="doc-people" className="rounded-xl border border-[var(--pos-line)] bg-white px-3.5 py-2.5 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[var(--pos-muted)]">Người tạo</span>
        <span data-testid="nguoi-tao" className="truncate font-semibold text-[var(--pos-ink)]">
          {tenCua(createdById) ?? <span className="font-normal text-[var(--pos-dim)]">chưa rõ</span>}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="shrink-0 text-[var(--pos-muted)]">Người được gán</span>
        {choGan ? (
          <div className={`min-w-0 w-[210px] ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <SellerPicker
              value={assignedId ?? ""}
              onChange={(id) => { if (id && id !== assignedId) onAssign?.(id) }}
              sellers={sellers}
            />
          </div>
        ) : (
          <span data-testid="nguoi-duoc-gan" className="truncate font-semibold text-[var(--pos-ink)]">
            {tenCua(assignedId) ?? <span className="font-normal text-[var(--pos-dim)]">chưa gán</span>}
          </span>
        )}
      </div>
      {choGan && note && <p className="mt-1 text-[11px] text-[var(--pos-dim)]">{note}</p>}
    </div>
  )
}
