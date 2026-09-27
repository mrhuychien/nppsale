"use client"

/**
 * NGĂN PHIẾU TRẢ TRÊN ĐIỆN THOẠI — theo mẫu chủ nhà 27/09/2026: bấm một phiếu là ngăn trượt lên
 * (mã, khách, trạng thái, Credit note, các dòng thông tin), phiếu chờ thì chọn kho nhận rồi
 * "Hoàn thành · nhập kho …" ngay tại chỗ.
 *
 * ⚠ Nút theo LUẬT PHIẾU TRẢ (`hanhDongPhieuTra`, mig 191), không theo mẫu nguyên văn: phiếu tự sinh
 *   đang chờ KHÔNG huỷ được (sửa từ hóa đơn); phiếu tự lập đi Nháp → Hoàn thành (không có bước
 *   "Gửi phiếu"). Hoàn thành / huỷ đi qua RPC (`complete_return` / `cancel_return`), cần quyền
 *   `returns.approve` — thiếu quyền thì nói rõ ai bấm, không hiện nút để RPC ném lỗi.
 */

import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { nhanLyDoTra } from "@/lib/constants"
import { docMaPhieuTra, tenPhieuTra } from "@/lib/returns/ma-phieu"
import { duongSuaPhieuTra, hanhDongPhieuTra, laPhieuTuSinh } from "@/lib/returns/loai-phieu"
import { RETURN_ZONES, cancelReturn, completeReturn, type ReturnZone } from "@/lib/returns/complete-return"
import { khoGoiY, toneTra } from "@/lib/returns/mobile-list"

interface PhieuNgan {
  id: string
  status: string
  credit_with_invoice?: boolean | null
  invoice_id?: string | null
  order_id?: string | null
  reason: string | null
  credit_note_amount: number | null
  created_at: string
  destination_zone?: string | null
  customer?: { store_name?: string | null } | null
  seller?: { full_name?: string | null } | null
  order?: { order_code?: string | null } | null
  invoice?: { invoice_code?: string | null } | null
}

const COT =
  "id, status, credit_with_invoice, invoice_id, order_id, reason, credit_note_amount, created_at, destination_zone, " +
  "customer:customers(store_name), seller:users!returns_sales_user_id_fkey(full_name), " +
  "order:sales_orders(order_code), invoice:sales_invoices(invoice_code)"

const tenKho = (z: string | null | undefined) => RETURN_ZONES.find((k) => k.value === z)?.label ?? null

export function MobileReturnSheet({
  returnId,
  canApprove,
  onClose,
  onDone,
}: {
  returnId: string | null
  /** `returns.approve` — đúng quyền `complete_return` / `cancel_return` kiểm. */
  canApprove: boolean
  onClose: () => void
  /** Sau khi hoàn thành / huỷ: câu báo để nơi gọi hiện + tải lại danh sách. */
  onDone: (thongBao: string) => void
}) {
  const [r, setR] = useState<PhieuNgan | null>(null)
  const [ngay, setNgay] = useState<string | null>(null)
  const [ma, setMa] = useState<string | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [kho, setKho] = useState<ReturnZone>("sale")
  const [dangHuy, setDangHuy] = useState(false)
  const [lyDoHuy, setLyDoHuy] = useState("")
  const [dangLam, setDangLam] = useState(false)

  useEffect(() => {
    setR(null)
    setLoi(null)
    setNgay(null)
    setMa(null)
    setDangHuy(false)
    setLyDoHuy("")
    if (!returnId) return
    let huy = false
    ;(async () => {
      const sb = createClient()
      /* `return_date` (mig 188) đọc riêng — sổ chưa có cột thì không hỏng cả ngăn. */
      const [{ data, error }, n, m] = await Promise.all([
        sb.from("returns").select(COT).eq("id", returnId).maybeSingle(),
        sb.from("returns").select("return_date").eq("id", returnId).maybeSingle(),
        docMaPhieuTra(sb, [returnId]),
      ])
      if (huy) return
      if (error) return setLoi(errorMessage(error))
      if (!data) return setLoi("Không tìm thấy phiếu trả.")
      const p = data as unknown as PhieuNgan
      setR(p)
      setKho(khoGoiY(p.reason))
      setNgay(((n.data as unknown) as { return_date?: string | null } | null)?.return_date ?? null)
      setMa(m.get(returnId) ?? null)
    })()
    return () => {
      huy = true
    }
  }, [returnId])

  const hd = r ? hanhDongPhieuTra(r) : null
  const tuSinh = r ? laPhieuTuSinh(r) : false
  const st = r ? toneTra(r.status) : null
  const sua = r ? duongSuaPhieuTra(r) : null
  const tienTra = formatCurrency(Number(r?.credit_note_amount) || 0)
  const tenPhieu = tenPhieuTra(ma)

  const dong: Array<[string, string]> = r
    ? [
        ["Lý do", nhanLyDoTra(r.reason) || "—"],
        ["Đơn gốc", r.order?.order_code || "—"],
        ["Hóa đơn gốc", r.invoice?.invoice_code || "—"],
        ["Ngày tạo", formatDate(ngay || r.created_at)],
        ["Tính cho NV", r.seller?.full_name || "—"],
        ...(r.status === "completed" && tenKho(r.destination_zone) ? [["Kho nhận", tenKho(r.destination_zone)!] as [string, string]] : []),
      ]
    : []

  const hoanThanh = async () => {
    if (!r || dangLam) return
    setDangLam(true)
    try {
      await completeReturn(createClient(), r.id, kho)
      const k = (tenKho(kho) ?? "").toLowerCase()
      /* Tự sinh: công nợ đã trừ vào hóa đơn lúc xuất — hoàn thành chỉ còn nhập kho. */
      onDone(tuSinh ? `${tenPhieu} đã nhập ${k}` : `${tenPhieu} đã nhập ${k} · công nợ giảm ${tienTra}`)
    } catch (e) {
      setLoi(errorMessage(e))
    } finally {
      setDangLam(false)
    }
  }

  const huyPhieu = async () => {
    if (!r || dangLam) return
    const lyDo = lyDoHuy.trim()
    if (!lyDo) return setLoi("Phải ghi lý do huỷ.")
    setDangLam(true)
    try {
      await cancelReturn(createClient(), r.id, lyDo)
      onDone(`Đã huỷ ${tenPhieu}`)
    } catch (e) {
      setLoi(errorMessage(e))
    } finally {
      setDangLam(false)
    }
  }

  return (
    <Sheet open={!!returnId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[20px] px-4 pb-6 pt-3" data-testid="ngan-phieu-tra">
        <div className="grid gap-3.5">
          <div className="flex items-start gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs font-semibold text-primary">{r ? tenPhieu : "…"}</p>
              <SheetTitle className="mt-0.5 truncate text-lg font-bold">{r?.customer?.store_name || (r ? "—" : "Phiếu trả hàng")}</SheetTitle>
            </div>
            {st && <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", st.cls)}>{st.label}</span>}
          </div>

          {loi && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-destructive">{loi}</p>}

          {!r && !loi && (
            <div className="grid gap-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          )}

          {r && hd && (
            <>
              <div className="flex items-baseline justify-between rounded-xl bg-muted/40 px-3.5 py-3">
                <span className="text-[13px] text-muted-foreground">Credit note</span>
                <span className="text-[22px] font-bold tabular-nums" data-testid="tien-phieu-tra">{tienTra}</span>
              </div>

              <div className="divide-y rounded-2xl border">
                {dong.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-right font-semibold">{v}</span>
                  </div>
                ))}
              </div>

              {hd.lyDo && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-snug text-amber-700">{hd.lyDo}</p>}

              {hd.hoanThanh && canApprove && !dangHuy && (
                <div className="grid gap-2">
                  <p className="text-sm font-bold">Kho nhận</p>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kho nhận">
                    {RETURN_ZONES.map((z) => (
                      <button
                        key={z.value}
                        type="button"
                        role="radio"
                        aria-checked={kho === z.value}
                        onClick={() => setKho(z.value)}
                        className={cn(
                          "flex min-h-[52px] flex-col items-start justify-center rounded-xl px-3 py-1.5 text-left",
                          kho === z.value ? "border-2 border-primary bg-primary/5" : "border bg-card"
                        )}
                      >
                        <span className="text-sm font-semibold">{z.label}</span>
                        <span className="text-[11px] leading-tight text-muted-foreground">{z.hint}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={hoanThanh}
                    disabled={dangLam}
                    className="mt-1.5 h-14 rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
                  >
                    {dangLam ? "Đang xử lý…" : `Hoàn thành · nhập ${(tenKho(kho) ?? "").toLowerCase()}`}
                  </button>
                  {hd.huy === "huy" && (
                    <button type="button" onClick={() => setDangHuy(true)} className="h-11 text-sm font-semibold text-destructive">
                      Huỷ phiếu
                    </button>
                  )}
                </div>
              )}

              {dangHuy && (
                <div className="grid gap-2">
                  <label className="text-sm font-bold" htmlFor="ly-do-huy-tra">Lý do huỷ</label>
                  <textarea
                    id="ly-do-huy-tra"
                    value={lyDoHuy}
                    onChange={(e) => setLyDoHuy(e.target.value)}
                    rows={2}
                    placeholder="Vì sao huỷ phiếu này"
                    className="rounded-xl border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setDangHuy(false)} className="h-11 rounded-xl border bg-card text-sm font-semibold">
                      Thôi
                    </button>
                    <button
                      type="button"
                      onClick={huyPhieu}
                      disabled={dangLam || !lyDoHuy.trim()}
                      className="h-11 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-60"
                    >
                      {dangLam ? "Đang huỷ…" : "Xác nhận huỷ"}
                    </button>
                  </div>
                </div>
              )}

              {hd.hoanThanh && !canApprove && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-snug text-amber-700">
                  Hàng chưa vào kho{tuSinh ? "" : ", công nợ chưa giảm"}. Quản lý hoặc thủ kho sẽ chọn kho nhận và bấm Hoàn thành.
                </p>
              )}

              <div className="flex gap-2">
                {sua && (
                  <Link href={sua.href} className="flex h-11 flex-1 items-center justify-center rounded-xl border bg-card text-sm font-semibold">
                    {sua.nhan}
                  </Link>
                )}
                <Link href={`/returns/${r.id}`} className="flex h-11 flex-1 items-center justify-center rounded-xl border bg-card text-sm font-semibold">
                  Xem chi tiết
                </Link>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
