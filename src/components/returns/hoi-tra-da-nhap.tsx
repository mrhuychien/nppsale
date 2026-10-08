"use client"

/** Hộp hỏi khi sửa hóa đơn có phiếu trả đã nhập kho (chủ nhà 28/09/2026, mig 210). */

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { CheDoTraDaNhap } from "@/lib/returns/tra-da-nhap"

export function HoiTraDaNhap({
  open,
  maPhieu,
  coQuyenDuyet,
  onChon,
  onDong,
}: {
  open: boolean
  /** Nhãn các phiếu trả tự sinh đã nhập kho của tờ này (số PT- hoặc "Phiếu trả"). */
  maPhieu: string[]
  /** `returns.approve` — `cancel_return` / `complete_return` đòi quyền này. */
  coQuyenDuyet: boolean
  onChon: (c: CheDoTraDaNhap) => void
  onDong: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDong() }}>
      <DialogContent className="sm:max-w-md" data-testid="hoi-tra-da-nhap">
        <DialogHeader>
          <DialogTitle>Cần huỷ phiếu nhập trước?</DialogTitle>
          <DialogDescription>
            {maPhieu.join(", ")} của hoá đơn này đã nhập kho.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          <li className="rounded-lg border p-3">
            <b>Có</b> — huỷ phiếu nhập để sửa được cả hàng trả. Bấm cập nhật thì hoá đơn, công nợ và phiếu trả
            cập nhật theo số mới; phiếu trả về <b>Chờ xử lý</b> để nhập kho lại (chọn kho, ngày nhập) như lúc
            tạo hoá đơn.
          </li>
          <li className="rounded-lg border p-3">
            <b>Không</b> — giữ nguyên phiếu nhập (không sửa dòng hàng trả của phiếu đó), phiếu gắn sang hoá đơn mới.
          </li>
        </ul>
        {!coQuyenDuyet && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Huỷ phiếu nhập cần quyền duyệt trả hàng — nhờ quản lý / thủ kho, hoặc chọn Không.
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onChon("giu")}>
            Không
          </Button>
          <Button onClick={() => onChon("lam_lai")} disabled={!coQuyenDuyet} title={coQuyenDuyet ? undefined : "Cần quyền duyệt trả hàng"}>
            Có, huỷ phiếu nhập
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
