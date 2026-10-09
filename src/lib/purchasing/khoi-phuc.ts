import type { SupabaseClient } from "@supabase/supabase-js"
import { friendlyReturnError } from "@/lib/purchasing/return-form"

/**
 * KHÔI PHỤC PHIẾU NHẬP HÀNG / PHIẾU TRẢ NCC ĐÃ HUỶ — RPC mig 241 (chủ nhà 09/10/2026: "Phiếu nhập hàng, phiếu trả NCC
 * hủy xong phải có đường khôi phục").
 *
 * ⚠ Phiếu về ĐÚNG trạng thái trước khi huỷ, và máy chủ quyết đó là trạng thái nào: phiếu nhập đã hoàn thành → nhập lại
 *   đúng các lô cũ + ghi lại công nợ NCC; phiếu trả đã gửi → gửi lại (xuất kho FIFO, giảm công nợ), kho không đủ thì
 *   dừng ở Nháp kèm lý do; phiếu tạm / nháp → về tạm / nháp. Màn hình chỉ gọi và báo đúng kết quả máy chủ trả.
 */
export type LoaiPhieuNcc = "nhap" | "tra"

export interface KetQuaKhoiPhuc {
  id: string
  trang_thai: string
  /** false = phiếu đã không còn 'cancelled' (bấm hai lần / người khác vừa khôi phục) — máy chủ đứng yên. */
  da_khoi_phuc: boolean
  so_lo?: number
  /** Phiếu trả gửi lại không được (kho không đủ…) → phiếu dừng ở Nháp, đây là câu lỗi của lần gửi lại. */
  ly_do?: string | null
}

const RPC: Record<LoaiPhieuNcc, { ten: string; thamSo: string }> = {
  nhap: { ten: "khoi_phuc_phieu_nhap", thamSo: "p_invoice_id" },
  tra: { ten: "khoi_phuc_phieu_tra_ncc", thamSo: "p_return_id" },
}

/** Câu lỗi của RPC sang tiếng người: lỗi kho dịch như lúc gửi phiếu; còn lại cắt mã ở đầu ("FORBIDDEN: …"). */
export function loiKhoiPhuc(msg: string): string {
  if (msg.includes("INSUFFICIENT_STOCK")) return friendlyReturnError(msg)
  // `[\s\S]` chứ không phải cờ `s` (target chưa bật es2018) — câu lỗi của RPC có thể xuống dòng.
  const m = /^[A-Z_]+:\s*([\s\S]+)$/.exec(msg.trim())
  return m ? m[1] : msg
}

export async function khoiPhucPhieuNcc(sb: SupabaseClient, loai: LoaiPhieuNcc, id: string): Promise<KetQuaKhoiPhuc> {
  const r = RPC[loai]
  const { data, error } = await sb.rpc(r.ten, { [r.thamSo]: id })
  if (error) throw new Error(loiKhoiPhuc(error.message))
  return data as KetQuaKhoiPhuc
}

/** Câu báo sau khi khôi phục — theo trạng thái phiếu VỀ ĐƯỢC, không theo trạng thái người bấm mong đợi. */
export function thongBaoKhoiPhuc(loai: LoaiPhieuNcc, kq: KetQuaKhoiPhuc): { title: string; description?: string } {
  if (!kq.da_khoi_phuc) return { title: "Phiếu đã không còn ở trạng thái Đã huỷ — không có gì để khôi phục" }
  if (loai === "nhap") {
    return kq.trang_thai === "completed"
      ? { title: "Đã khôi phục — phiếu Hoàn thành, kho và công nợ NCC đã ghi lại" }
      : { title: "Đã khôi phục về Phiếu tạm", description: "Phiếu bị huỷ lúc còn là phiếu tạm — chưa nhập kho, chưa ghi công nợ NCC." }
  }
  if (kq.trang_thai === "completed") return { title: "Đã khôi phục — phiếu đã gửi lại: xuất kho và giảm công nợ NCC" }
  if (kq.ly_do) return { title: "Đã khôi phục về Nháp — chưa gửi lại được", description: loiKhoiPhuc(kq.ly_do) }
  return { title: "Đã khôi phục về Nháp" }
}
