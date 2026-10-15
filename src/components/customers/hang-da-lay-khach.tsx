"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChonMocThoiGian } from "@/components/customers/chon-moc-thoi-gian"
import { errorMessage } from "@/lib/errors"
import { ngayVN } from "@/lib/xuat-excel/phieu"
import { vnDateKey } from "@/lib/orders/status-tone"
import {
  MOC_MAC_DINH, MOC_THOI_GIAN, hangTheoKhach, napHangDaLay, slHienThi, tuNgayTheoMoc,
  type HangDaLay, type MocThoiGian,
} from "@/lib/customers/ban-giao"

/**
 * "HÀNG ĐÃ LẤY" Ở CHI TIẾT KHÁCH — chủ nhà 15/10/2026: "thể hiện luôn trên máy của nv. Khi họ muốn kiểm tra điểm bán sẽ
 * có luôn … đã lấy hàng gì, số lượng, hàng cty nào mà nv đó làm". Số từ `hang_khach_da_lay` (mig 246): đơn vị cơ sở,
 * hoá đơn ghi sổ − hàng trả đã trừ; NVBH chỉ thấy hàng công ty mình làm. Sổ chưa chạy 246 → hiện `fallback` (khối cũ).
 */
export function HangDaLayKhach({ customerId, laNv, fallback }: { customerId: string; laNv: boolean; fallback?: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [moc, setMoc] = useState<MocThoiGian>(MOC_MAC_DINH)
  const [homNay, setHomNay] = useState("")
  /** undefined = đang đọc; null = máy chủ chưa có hàm. */
  const [d, setD] = useState<HangDaLay | null | undefined>(undefined)
  const [loi, setLoi] = useState<string | null>(null)
  const [lan, setLan] = useState(0)

  useEffect(() => setHomNay(vnDateKey(new Date())), [])

  useEffect(() => {
    if (!homNay) return
    let huy = false
    setD(undefined)
    setLoi(null)
    napHangDaLay(supabase, { khach: [customerId], tu: tuNgayTheoMoc(moc, homNay) })
      .then((x) => { if (!huy) setD(x) })
      .catch((e) => { if (!huy) setLoi(errorMessage(e)) })
    return () => { huy = true }
  }, [customerId, moc, homNay, supabase, lan])

  if (d === null) return <>{fallback}</>

  const dong = d ? hangTheoKhach(d).get(customerId) ?? [] : []
  const ngoaiDs = !!d && d.khach.length === 0
  const nhanMoc = MOC_THOI_GIAN.find((m) => m.key === moc)?.nhan.toLowerCase() ?? ""
  const congTy = d?.nv ? d.ncc.map((n) => n.name).join(", ") : ""

  return (
    <Card data-testid="hang-da-lay-khach">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Hàng đã lấy</CardTitle>
          <ChonMocThoiGian value={moc} onChange={setMoc} />
        </div>
        {laNv && d && !ngoaiDs && (
          <p className="text-xs text-muted-foreground">
            {congTy ? `Hàng các công ty bạn làm: ${congTy}` : "Bạn chưa được gán công ty nào — chỉ hiện hàng chưa gán công ty"}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {loi ? (
          <div className="space-y-2 py-2 text-center text-sm">
            <p className="text-destructive">Không đọc được hàng đã lấy: {loi}</p>
            <Button variant="outline" size="sm" onClick={() => setLan((x) => x + 1)}>Thử lại</Button>
          </div>
        ) : d === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : ngoaiDs ? (
          <p className="py-3 text-center text-sm text-muted-foreground" data-testid="hang-ngoai-ds">
            Khách chưa trong danh sách của bạn — nhận khách về danh sách để xem hàng đã lấy.
          </p>
        ) : dong.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground" data-testid="hang-trong">
            {moc === "tat-ca" ? "Khách chưa lấy hàng nào" : `Khách chưa lấy hàng trong ${nhanMoc} qua`}
          </p>
        ) : (
          <ul className="divide-y" data-testid="hang-ds">
            {dong.map((h) => (
              <li key={h.productId} className="flex items-start gap-3 py-2" data-testid="hang-dong">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{h.ten}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {h.congTy} · {h.lan} lần{h.cuoi ? ` · lần cuối ${ngayVN(h.cuoi)}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums" data-testid="hang-sl">{slHienThi(h.sl, h.donVi)}</p>
                  {h.tra > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">trả {slHienThi(h.tra, h.donVi)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
