"use client"

/**
 * PHIẾU CHI TRẢ NCC — các ô nhập + hộp lập phiếu (mig 242). Dùng ở màn Chi phí (loại phiếu "Trả NCC") và màn chi tiết
 * NCC (nút "Chi trả NCC"). Chủ nhà 09/10/2026: "chọn NCC là xong … có thể chi trả ncc 1 cục 200 triệu, nhiều hóa đơn
 * nợ" — không chọn hoá đơn: máy chủ tự trừ vào các khoản nợ cũ nhất.
 */

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { loadSupplierDebt } from "@/lib/pos/load"
import { homNayVNKey } from "@/lib/analytics/period"
import {
  HINH_THUC_CHI_NCC, giaTriChiNccMoi, kiemPhieuChiNcc, lapPhieuChiNcc, thongBaoChiNcc,
  type GiaTriChiNcc, type HinhThucChiNcc, type KetQuaChiNcc,
} from "@/lib/payables/phieu-chi-ncc"
import { SearchSelect } from "@/components/ui/search-select"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"

export function PhieuChiNccFields({
  value,
  onChange,
  suppliers,
  coDinh,
}: {
  value: GiaTriChiNcc
  onChange: (v: GiaTriChiNcc) => void
  suppliers: ReadonlyArray<{ id: string; name: string; code?: string | null }>
  /** NCC đã chọn sẵn (màn chi tiết NCC) — không cho đổi. */
  coDinh?: { id: string; name: string } | null
}) {
  const supabase = createClient()
  const [no, setNo] = useState<number | null>(null)
  const homNay = homNayVNKey()

  // Còn nợ NCC — để người chi biết trả bao nhiêu là hết; đọc hỏng thì chỉ không hiện.
  useEffect(() => {
    let huy = false
    setNo(null)
    if (!value.supplierId) return
    loadSupplierDebt(supabase, value.supplierId).then((n) => { if (!huy) setNo(n) }).catch(() => undefined)
    return () => { huy = true }
  }, [value.supplierId]) // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(
    () => suppliers.map((s) => ({ id: s.id, label: s.name, hint: s.code || null, keywords: s.code || null })),
    [suppliers]
  )

  return (
    <div className="space-y-3" data-testid="phieu-chi-ncc">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nhà cung cấp *</Label>
        {coDinh ? (
          <p className="font-semibold">{coDinh.name}</p>
        ) : (
          <SearchSelect
            id="pc-ncc"
            options={options}
            valueId={value.supplierId}
            onPick={(o) => onChange({ ...value, supplierId: o?.id ?? "" })}
            placeholder="Gõ tên hoặc mã NCC…"
            emptyHint="Không có NCC khớp"
          />
        )}
        {value.supplierId && (
          <p className="text-xs text-muted-foreground" data-testid="pc-no-ncc">
            Còn phải trả NCC: <b className="tabular-nums text-foreground">{no == null ? "…" : formatCurrency(no)}</b>
            {no != null && no > 0 && (
              <button
                type="button"
                className="ml-2 font-semibold text-primary hover:underline"
                onClick={() => onChange({ ...value, amount: no })}
              >
                Trả hết
              </button>
            )}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="pc-ngay" className="text-xs uppercase tracking-wider text-muted-foreground">Ngày chi *</Label>
          <Input id="pc-ngay" type="date" max={homNay} value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-tien" className="text-xs uppercase tracking-wider text-muted-foreground">Số tiền *</Label>
          <MoneyInput id="pc-tien" value={value.amount || ""} onChange={(n) => onChange({ ...value, amount: n })} placeholder="0" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hình thức</Label>
          <Select value={value.method} onValueChange={(m) => onChange({ ...value, method: m as HinhThucChiNcc })}>
            <SelectTrigger aria-label="Hình thức chi"><SelectValue /></SelectTrigger>
            <SelectContent>
              {HINH_THUC_CHI_NCC.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-tham-chieu" className="text-xs uppercase tracking-wider text-muted-foreground">Số tham chiếu</Label>
          <Input id="pc-tham-chieu" value={value.reference} onChange={(e) => onChange({ ...value, reference: e.target.value })} placeholder="Số UNC, số chứng từ…" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pc-ghi-chu" className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
        <Textarea id="pc-ghi-chu" rows={2} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </div>
      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Không cần chọn hoá đơn: tiền tự trừ vào các khoản nợ cũ nhất của NCC (nợ đầu kỳ trước). Trả dư thì phần dư thành
        tiền trả trước, tự trừ vào phiếu nhập sau.
      </p>
    </div>
  )
}

/** Hộp lập phiếu chi trả NCC (NCC chọn sẵn hoặc chọn trong danh sách). */
export function PhieuChiNccDialog({
  open,
  onOpenChange,
  suppliers = [],
  coDinh,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suppliers?: ReadonlyArray<{ id: string; name: string; code?: string | null }>
  coDinh?: { id: string; name: string } | null
  onSaved?: (k: KetQuaChiNcc) => void
}) {
  const supabase = createClient()
  const { toast } = useToast()
  const [v, setV] = useState<GiaTriChiNcc>(() => giaTriChiNccMoi(coDinh?.id))
  const [luu, setLuu] = useState(false)

  useEffect(() => {
    if (open) setV(giaTriChiNccMoi(coDinh?.id))
  }, [open, coDinh?.id])

  const gui = async () => {
    const loi = kiemPhieuChiNcc(v)
    if (loi) {
      toast({ title: loi, variant: "destructive" })
      return
    }
    setLuu(true)
    try {
      const k = await lapPhieuChiNcc(supabase, { supplierId: v.supplierId, amount: v.amount, paidDate: v.date, method: v.method, notes: v.notes, reference: v.reference })
      toast(thongBaoChiNcc(k))
      onOpenChange(false)
      onSaved?.(k)
    } catch (e) {
      toast({ title: "Không lập được phiếu chi", description: errorMessage(e), variant: "destructive" })
    } finally {
      setLuu(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Phiếu chi trả NCC</DialogTitle>
          <DialogDescription>Chi trả nhà cung cấp một khoản — tự trừ vào các khoản nợ cũ nhất.</DialogDescription>
        </DialogHeader>
        <PhieuChiNccFields value={v} onChange={setV} suppliers={suppliers} coDinh={coDinh} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={luu}>Huỷ</Button>
          <Button onClick={gui} disabled={luu}>{luu ? "Đang lưu..." : "Lưu phiếu chi"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
