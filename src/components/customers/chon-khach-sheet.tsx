"use client"

/**
 * HỘP CHỌN KHÁCH TRÊN ĐIỆN THOẠI — một bản cho phiếu trả hàng (`PhieuTraKhachMobile`) và Sửa hoá đơn (`InvoiceEditor`).
 * Chủ nhà 09/11/2026: chọn khách trong danh sách thì hiện thêm địa chỉ (nhiều cửa hàng trùng tên / chung chủ); tìm được
 * theo tên cửa hàng, tên chủ, số điện thoại, địa chỉ.
 */
import { useMemo, useState } from "react"
import { MapPin } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { viMatchAllWords } from "@/lib/search"
import { fullCustomerAddress, type CustomerAddressParts } from "@/lib/customers/address"

const RENDER_CAP = 60

export interface KhachChon extends CustomerAddressParts {
  id: string
  store_name: string
  owner_name?: string | null
  phone?: string | null
}

export function ChonKhachSheet({
  open, onClose, customers, onPick, onTao, title = "Chọn khách hàng", testIdDong = "dong-chon-khach-tra", loading, loi,
}: {
  open: boolean
  onClose: () => void
  customers: KhachChon[]
  onPick: (id: string) => void
  onTao?: (chu: string) => void
  title?: string
  /** `data-testid` của mỗi dòng khách (phiếu trả giữ tên cũ cho bài e2e của nó). */
  testIdDong?: string
  /** Sổ khách đang tải (màn tải lúc mở hộp). */
  loading?: boolean
  /** Tải sổ khách hỏng — nói ra, không hiện "không tìm thấy". */
  loi?: string | null
}) {
  const [q, setQ] = useState("")
  /* Địa chỉ ghép một lần cho cả sổ khách (không ghép lại mỗi lần gõ) — hiện dưới tên và tìm được theo tên đường / phường. */
  const coDiaChi = useMemo(() => customers.map((c) => ({ c, diaChi: fullCustomerAddress(c) })), [customers])
  const ds = useMemo(
    () => coDiaChi.filter(({ c, diaChi }) => viMatchAllWords(q, c.store_name, c.owner_name, c.phone, diaChi)).slice(0, RENDER_CAP),
    [coDiaChi, q]
  )
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-3 rounded-t-2xl p-4">
        <p className="text-[16px] font-bold">{title}</p>
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tên cửa hàng, tên chủ, số điện thoại, địa chỉ…"
          aria-label="Tìm khách hàng"
          className="h-11 rounded-xl border border-border px-3 text-[15px] outline-none focus:border-primary"
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {loi ? (
            <p className="py-6 text-center text-sm text-destructive">{loi}</p>
          ) : loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Đang tải danh sách khách…</p>
          ) : (
            <>
              {ds.map(({ c, diaChi }) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c.id)}
                  data-testid={testIdDong}
                  className="flex flex-col gap-0.5 border-b border-border/60 py-2.5 text-left"
                >
                  <span className="text-[14px] font-semibold">{c.store_name}</span>
                  {(c.owner_name || c.phone) && (
                    <span className="text-[12px] text-muted-foreground">{[c.owner_name, c.phone].filter(Boolean).join(" · ")}</span>
                  )}
                  {diaChi && (
                    <span className="flex items-start gap-1 text-[12px] text-muted-foreground" data-testid="dia-chi-khach">
                      <MapPin className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
                      <span>{diaChi}</span>
                    </span>
                  )}
                </button>
              ))}
              {ds.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy khách nào khớp.</p>}
            </>
          )}
        </div>
        {onTao && (
          <button type="button" onClick={() => { onTao(q.trim()); onClose() }} className="h-11 rounded-xl border border-primary font-semibold text-primary">
            + Tạo khách mới{q.trim() ? ` “${q.trim()}”` : ""}
          </button>
        )}
      </SheetContent>
    </Sheet>
  )
}
