"use client"

/**
 * CHI TIẾT PHIẾU CHI TRẢ NCC (mig 242) — tiền của phiếu đã trừ vào những khoản nợ nào, phần trả trước còn lại, và nút
 * Huỷ. Mọi thay đổi đi qua RPC (`huy_phieu_chi_ncc`); màn này chỉ đọc và hiện kết quả.
 */

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "@/components/ui/link"
import { Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import {
  docMotPhieuChiNcc, docPhanTruPhieuChi, huyPhieuChiNcc, duocChiTraNcc, nhanHinhThucChiNcc,
  type PhieuChiNcc, type PhanTruPhieuChi,
} from "@/lib/payables/phieu-chi-ncc"

export default function PhieuChiNccPage() {
  const { id } = useParams<{ id: string }>()
  // Cùng quyền với màn Chi phí (NAV_TIEN_TO: /finance/phieu-chi-ncc/ → /finance/expenses).
  const { user, loading: authLoading } = useRoleGuard("settings")
  const supabase = createClient()
  const { toast } = useToast()
  const [phieu, setPhieu] = useState<PhieuChiNcc | null>(null)
  const [phan, setPhan] = useState<PhanTruPhieuChi[]>([])
  const [loi, setLoi] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoiHuy, setHoiHuy] = useState(false)
  const [lyDo, setLyDo] = useState("")
  const [dangHuy, setDangHuy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await docMotPhieuChiNcc(supabase, id)
    setPhieu(r.phieu)
    setLoi(r.loi)
    if (r.phieu) {
      try {
        setPhan(await docPhanTruPhieuChi(supabase, r.phieu))
      } catch (e) {
        setPhan([])
        setLoi(errorMessage(e, "Không đọc được phần đã trừ của phiếu chi"))
      }
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const huy = async () => {
    if (!phieu) return
    setDangHuy(true)
    try {
      await huyPhieuChiNcc(supabase, phieu.id, lyDo)
      toast({ title: `Đã huỷ phiếu chi ${phieu.code}`, description: "Các khoản nợ NCC đã về đúng số trước khi chi." })
      setHoiHuy(false)
      await load()
    } catch (e) {
      toast({ title: "Không huỷ được phiếu chi", description: errorMessage(e), variant: "destructive" })
    } finally {
      setDangHuy(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (!phieu) {
    return (
      <div className="space-y-4">
        <PageHeader title="Phiếu chi trả NCC" backHref="/finance/expenses" />
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {loi || "Không tìm thấy phiếu chi này, hoặc bạn không có quyền xem nó."}
        </div>
        <Link href="/finance/expenses" className="text-sm text-primary hover:underline">Tới danh sách phiếu chi →</Link>
      </div>
    )
  }

  const daHuy = phieu.status === "cancelled"
  const daTru = phan.filter((p) => p.loai !== "tra-truoc")
  const traTruoc = phan.filter((p) => p.loai === "tra-truoc").reduce((s, p) => s + p.tien, 0)

  return (
    <div className="space-y-4">
      <PageHeader title={`Phiếu chi ${phieu.code}`} description={phieu.supplier?.name || undefined} backHref="/finance/expenses">
        {daHuy ? <Badge variant="secondary">Đã huỷ</Badge> : <Badge variant="success">Đã chi</Badge>}
      </PageHeader>

      {daHuy && (
        <div className="rounded-xl border border-outline-variant bg-muted/40 px-3.5 py-3 text-sm">
          <span className="font-semibold">Phiếu đã huỷ</span>
          {phieu.cancelled_at ? ` lúc ${formatDate(phieu.cancelled_at)}` : ""}. {phieu.cancel_reason || "Không ghi lý do."} Tiền
          của phiếu đã gỡ khỏi các khoản nợ NCC.
        </div>
      )}
      {loi && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{loi}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Thông tin phiếu chi</CardTitle></CardHeader>
          <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Dong label="Nhà cung cấp">
              <Link href={`/suppliers/${phieu.supplier_id}?tab=debt`} className="font-semibold text-primary hover:underline">
                {phieu.supplier?.name || "—"}
              </Link>
            </Dong>
            <Dong label="Ngày chi">{formatDate(phieu.paid_date)}</Dong>
            <Dong label="Hình thức">{nhanHinhThucChiNcc(phieu.method)}</Dong>
            <Dong label="Số tham chiếu">{phieu.reference_code || "—"}</Dong>
            {phieu.notes && <Dong label="Ghi chú">{phieu.notes}</Dong>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Số tiền</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between text-base font-extrabold">
              <span>Đã chi</span>
              <span className="tabular-nums">{formatCurrency(phieu.amount)}</span>
            </div>
            {!daHuy && traTruoc > 0 && (
              <div className="flex justify-between text-[#067647]">
                <span>Còn là tiền trả trước</span>
                <span className="tabular-nums">{formatCurrency(traTruoc)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!daHuy && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Đã trừ vào các khoản nợ ({daTru.length})</CardTitle></CardHeader>
          <CardContent className="p-0 sm:px-6 sm:pb-6">
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm" data-testid="pc-da-tru">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Khoản nợ</th>
                    <th className="px-3 py-2 text-right">Đã trừ</th>
                  </tr>
                </thead>
                <tbody>
                  {daTru.length === 0 ? (
                    <tr className="border-t">
                      <td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">
                        Chưa trừ vào khoản nợ nào — cả phiếu đang là tiền trả trước, sẽ tự trừ vào phiếu nhập sau.
                      </td>
                    </tr>
                  ) : daTru.map((p) => (
                    <tr key={p.payableId} className="border-t">
                      <td className="px-3 py-2">
                        <Link href={p.href} className="font-mono text-xs font-bold text-primary hover:underline">{p.ma}</Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.tien)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!daHuy && duocChiTraNcc(user?.role) && (
        <div className="flex justify-end">
          <Button variant="outline" className="text-destructive" onClick={() => { setLyDo(""); setHoiHuy(true) }} disabled={dangHuy}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Huỷ phiếu chi
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={hoiHuy}
        onOpenChange={setHoiHuy}
        title={`Huỷ phiếu chi ${phieu.code}?`}
        description="Tiền của phiếu được gỡ khỏi các khoản nợ NCC đã trừ — các khoản ấy về đúng số trước khi chi. Phiếu ở trạng thái Đã huỷ."
        variant="destructive"
        confirmLabel="Huỷ phiếu chi"
        cancelLabel="Không"
        loading={dangHuy}
        onConfirm={huy}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ly-do-huy" className="text-xs uppercase tracking-wider text-muted-foreground">Lý do huỷ</Label>
          <Input id="ly-do-huy" value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="VD: chi nhầm NCC" />
        </div>
      </ConfirmDialog>
    </div>
  )
}

function Dong({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 last:border-0 sm:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}
