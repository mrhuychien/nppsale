"use client"

/**
 * NÚT "XUẤT EXCEL" CỦA DANH SÁCH CHỨNG TỪ — chủ nhà 05/10/2026: "Thêm phần xuất excel cho phiếu trả hàng ncc và
 * các phiếu khác tương tự".
 *
 * Xuất MỌI phiếu khớp bộ lọc / ô tìm / tab đang xem — không chỉ trang 20 dòng đang hiện — thành tệp hai sheet
 * "Phiếu" + "Chi tiết dòng" (`src/lib/xuat-excel/phieu.ts`). Trang chỉ đưa `chuanBi`: đọc đủ đầu phiếu bằng đúng
 * bộ lọc của danh sách, đọc dòng, dựng sheet (`src/lib/xuat-excel/cac-man.ts`).
 *
 * ⚠ THEO Ô "XUẤT FILE" CỦA MA TRẬN QUYỀN (`duocXuatFile`) — không có quyền thì không hiện nút.
 * ⚠ CHẠM TRẦN THÌ NÓI RA (`thieu`): tệp vẫn tải về nhưng thông báo đỏ "chưa đủ dòng" — không im lặng.
 * ⚠ LỖI ĐỌC THÌ KHÔNG TẢI TỆP NÀO: một tệp thiếu dòng trông y như tệp đủ.
 */
import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import { duocXuatFile, type Module } from "@/lib/permissions"
import { errorMessage } from "@/lib/errors"
import { truncationWarning } from "@/lib/supabase/aggregate"
import { tenTepMotPhieu, tenTepXuat, type SheetXuat } from "@/lib/xuat-excel/phieu"
import { downloadXlsxSheets } from "@/components/analytics/report-frame"
import { taiXlsxDinhDang, type SheetDinhDang } from "@/lib/xuat-excel/xlsx-dinh-dang"
import { cn } from "@/lib/utils"

export interface KetQuaXuat {
  /** Tệp dữ liệu (danh sách): mỗi sheet một bảng. */
  sheets?: SheetXuat[]
  /** Tệp "như mẫu in" (trang chi tiết) — có định dạng, ghi qua `taiXlsxDinhDang`. */
  dinhDang?: SheetDinhDang[]
  /** Số phiếu đã xuất — để báo lại. */
  soPhieu: number
  /** Chạm trần đọc (`truncated`) — tệp THIẾU, phải báo. */
  thieu?: boolean
  /** Xuất MỘT phiếu (trang chi tiết): mã phiếu cho tên tệp `tienTo_MA_ngày.xlsx` và câu báo. */
  ma?: string
}

export function XuatExcelButton({
  module,
  tenTep,
  chuanBi,
  disabled,
  className,
  title = "Xuất mọi phiếu khớp bộ lọc đang xem (không chỉ trang này) — kèm chi tiết từng dòng",
}: {
  /** Mô-đun của ma trận quyền mà ô "Xuất file" quyết định nút này. */
  module: Module
  /** Tiền tố tên tệp — `tra-hang-ncc` → `tra-hang-ncc_2026-10-05.xlsx`. */
  tenTep: string
  chuanBi: () => Promise<KetQuaXuat>
  disabled?: boolean
  className?: string
  title?: string
}) {
  const { user } = useAuth()
  const [dang, setDang] = useState(false)
  if (!duocXuatFile(user?.role, module)) return null

  const xuat = async () => {
    if (dang) return
    setDang(true)
    try {
      const kq = await chuanBi()
      const motPhieu = kq.ma !== undefined
      const ten = motPhieu ? tenTepMotPhieu(tenTep, kq.ma) : tenTepXuat(tenTep)
      if (kq.dinhDang) await taiXlsxDinhDang(ten, kq.dinhDang)
      else await downloadXlsxSheets(ten, kq.sheets ?? [])
      toast({
        title: kq.thieu
          ? `Đã xuất ${kq.soPhieu} phiếu — CHƯA ĐỦ`
          : motPhieu
            ? `Đã xuất phiếu ${kq.ma || "này"} ra Excel`
            : `Đã xuất ${kq.soPhieu} phiếu ra Excel`,
        description: kq.thieu ? truncationWarning() : undefined,
        variant: kq.thieu ? "destructive" : undefined,
      })
    } catch (e) {
      console.error("[xuat-excel] không xuất được:", e)
      toast({ title: "Không xuất được Excel", description: errorMessage(e), variant: "destructive" })
    } finally {
      setDang(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={xuat}
      disabled={disabled || dang}
      aria-busy={dang}
      data-testid="xuat-excel"
      title={title}
    >
      {dang ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      <span>{dang ? "Đang xuất…" : "Xuất Excel"}</span>
    </Button>
  )
}
