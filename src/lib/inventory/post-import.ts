import { dongDau, type CoRpc } from "@/lib/db/co-rpc"

/**
 * Ghi một phiếu nhập kho (kể cả tồn đầu kỳ) qua RPC `post_stock_import`.
 *
 * ⚠ MỘT GIAO DỊCH (mig 168). Bản cũ ghi phiếu → lô → dòng → công nợ NCC
 *   bằng bốn lệnh rời từ trình duyệt: hỏng giữa chừng là phiếu `posted`
 *   rỗng hoặc lô có tồn mà thẻ kho không có dòng; và lệnh công nợ bị RLS
 *   chặn với thủ kho rồi bị NUỐT — hàng vào kho, khoản phải trả biến mất.
 *
 * Trình duyệt vẫn tính quy đổi và giá vốn theo đơn vị gốc; máy chủ kiểm
 * sản phẩm / NCC thuộc NPP mình và số lượng > 0.
 */
export interface DongNhapKho {
  product_id: string
  batch_code?: string | null
  manufactured_at?: string | null
  expires_at?: string | null
  location?: string | null
  unit_name: string
  /** Số lượng theo đơn vị giao dịch (thùng). */
  qty_tx: number
  /** Hệ số quy đổi về đơn vị gốc. */
  conv: number
  /** Số lượng theo đơn vị gốc (hộp) — cái lô và thẻ kho ghi. */
  base_qty: number
  /** Giá vốn một đơn vị gốc. */
  base_cost: number
}

export interface PhieuNhapKho {
  entry_code: string
  posted_at: string
  notes?: string | null
  supplier_id?: string | null
  /** Có NCC và số tiền > 0 thì máy chủ ghi công nợ NCC cùng giao dịch. */
  payable?: { amount: number; invoice_number?: string | null } | null
  lines: DongNhapKho[]
}

export interface KetQuaNhapKho {
  entryId: string
  entryCode: string
  payableId: string | null
}

export async function ghiPhieuNhapKho(supabase: CoRpc, p: PhieuNhapKho): Promise<KetQuaNhapKho> {
  const { data, error } = await supabase.rpc("post_stock_import", { p })
  if (error) throw error
  const row = dongDau<{ entry_id: string; entry_code: string; payable_id: string | null; lines_written: number }>(data)
  if (!row?.entry_id) {
    throw new Error("Máy chủ không trả về phiếu vừa ghi — tải lại danh sách phiếu kho để xem đã ghi chưa.")
  }
  // ⚠ Đếm lại số dòng: im lặng ghi thiếu dòng chính là lỗi đang vá.
  if (Number(row.lines_written) !== p.lines.length) {
    throw new Error(
      `Phiếu ${row.entry_code} chỉ ghi được ${row.lines_written}/${p.lines.length} dòng — mở phiếu để kiểm tra.`
    )
  }
  return { entryId: row.entry_id, entryCode: row.entry_code, payableId: row.payable_id ?? null }
}
