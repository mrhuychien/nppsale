/**
 * XUẤT EXCEL MỘT PHIẾU — nút ở TRANG CHI TIẾT của 8 loại chứng từ (chủ nhà 05/10/2026: "xuất excel cho chi tiết 8
 * loại phiếu").
 *
 * Cùng tệp hai sheet "Phiếu" + "Chi tiết dòng" và CÙNG CỘT với nút xuất ở danh sách (`./cac-man.ts`) — chỉ khác là
 * đọc đúng một phiếu theo id. Một phiếu xuất từ danh sách và từ trang chi tiết phải ra cùng số.
 *
 * ⚠ ĐỌC ĐỦ HOẶC NÉM: phiếu không đọc được / không thấy thì ném (nút báo đỏ), không ra tệp rỗng.
 * ⚠ Hóa đơn bán: tiền là SỐ CÒN LẠI sau hàng trả (`traTheoHoaDon`), như danh sách. Phiếu kho: giá vốn chỉ khi
 *   người xem được giá vốn.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { traTheoHoaDon } from "@/lib/analytics/net-revenue"
import { docMaPhieuTra } from "@/lib/returns/ma-phieu"
import { napDong, napTenNguoi } from "./nap"
import {
  CHON_PHIEU_TRA_KHACH, DONG_DON, DONG_HOA_DON, DONG_KHO, DONG_NHAP, DONG_THU, DONG_TRA_KHACH, DONG_TRA_NCC,
  xuatChiPhi, xuatDonHang, xuatHoaDon, xuatPhieuKho, xuatPhieuNhap, xuatPhieuThu, xuatTraHangKhach, xuatTraHangNcc,
  type DonXuat, type DongDon, type DongHoaDon, type DongKho, type DongNhap, type DongThu, type DongTraKhach,
  type DongTraNcc, type HoaDonXuat, type PhieuChiXuat, type PhieuKhoXuat, type PhieuNhap, type PhieuThuXuat,
  type PhieuTraKhach, type PhieuTraNcc,
} from "./cac-man"
import type { SheetXuat } from "./phieu"

export type LoaiPhieuXuat = "tra-ncc" | "nhap" | "tra-khach" | "thu" | "chi" | "kho" | "don" | "hoa-don"

const KHACH = "customer:customers(store_name, phone, address)"

/** Câu chọn đầu phiếu — đủ cột mà hàm xuất của danh sách dùng. */
export const CHON_MOT_PHIEU: Record<LoaiPhieuXuat, { bang: string; chon: string; ten: string }> = {
  "tra-ncc": {
    bang: "supplier_returns",
    chon: "id, return_code, return_date, warehouse_zone, subtotal, vat, discount, total, status, reason, notes, created_by, supplier:suppliers(name, code)",
    ten: "phiếu trả NCC",
  },
  nhap: {
    bang: "purchase_invoices",
    chon: "id, receipt_code, invoice_number, invoice_date, status, total, warehouse_zone, subtotal, vat, vat_override, discount, notes, created_by, supplier:suppliers(name, code)",
    ten: "phiếu nhập",
  },
  "tra-khach": { bang: "returns", chon: CHON_PHIEU_TRA_KHACH, ten: "phiếu trả hàng" },
  thu: {
    bang: "cash_receipts",
    chon:
      "id, receipt_code, receipt_date, status, source_type, expected_amount, submitted_amount, notes, " +
      "collector:users!cash_receipts_collected_by_fkey(full_name), creator:users!cash_receipts_created_by_fkey(full_name), " +
      "receiver:users!cash_receipts_received_by_fkey(full_name)",
    ten: "phiếu thu",
  },
  chi: {
    bang: "expenses",
    chon: "id, expense_date, amount, description, reference_code, source_type, is_paid, payment_method, created_by, category:expense_categories(name, bucket)",
    ten: "khoản chi",
  },
  kho: {
    bang: "stock_entries",
    chon: "id, entry_code, type, status, notes, created_at, posted_at, issue_reason, warehouse_zone, dest_warehouse_zone, creator:users!stock_entries_created_by_fkey(full_name)",
    ten: "phiếu kho",
  },
  don: {
    bang: "sales_orders",
    chon: `id, order_code, order_date, status, payment_terms, subtotal, discount, vat, total, notes, ${KHACH}, sales_user:users!sales_orders_sales_user_id_fkey(full_name), creator:users!sales_orders_created_by_fkey(full_name)`,
    ten: "đơn hàng",
  },
  "hoa-don": {
    bang: "sales_invoices",
    chon: `id, invoice_code, invoice_date, status, payment_terms, subtotal, vat, total, notes, replaced_from, replaced_by, ${KHACH}, sales_user:users!sales_invoices_sales_user_id_fkey(full_name), creator:users!sales_invoices_posted_by_fkey(full_name), order:sales_orders(order_code)`,
    ten: "hóa đơn",
  },
}

/** Mã hiện trên tên tệp. */
function maCua(loai: LoaiPhieuXuat, p: Record<string, unknown>, maTra?: string): string {
  const s = (v: unknown) => (typeof v === "string" && v ? v : "")
  switch (loai) {
    case "tra-ncc": return s(p.return_code)
    case "nhap": return s(p.receipt_code) || s(p.invoice_number)
    case "tra-khach": return maTra || ""
    case "thu": return s(p.receipt_code)
    case "chi": return s(p.reference_code) || s(p.expense_date)
    case "kho": return s(p.entry_code)
    case "don": return s(p.order_code)
    case "hoa-don": return s(p.invoice_code)
  }
}

export interface MotPhieuXuat {
  sheets: SheetXuat[]
  /** Mã phiếu (để đặt tên tệp / báo lại); rỗng khi phiếu chưa có mã. */
  ma: string
}

export async function xuatMotPhieu(
  supabase: SupabaseClient,
  loai: LoaiPhieuXuat,
  id: string,
  o: { giaVon?: boolean } = {}
): Promise<MotPhieuXuat> {
  const c = CHON_MOT_PHIEU[loai]
  const { data, error } = await supabase.from(c.bang).select(c.chon).eq("id", id).maybeSingle()
  if (error) throw new Error(`Không đọc được ${c.ten}: ${error.message}`)
  if (!data) throw new Error(`Không tìm thấy ${c.ten}`)
  const p = data as unknown as Record<string, unknown>
  const ids = [id]

  switch (loai) {
    case "tra-ncc": {
      const ph = p as unknown as PhieuTraNcc
      const [dong, ten] = await Promise.all([napDong<DongTraNcc>(supabase, DONG_TRA_NCC, ids), napTenNguoi(supabase, [ph.created_by])])
      return { sheets: xuatTraHangNcc([ph], dong, ten), ma: maCua(loai, p) }
    }
    case "nhap": {
      const ph = p as unknown as PhieuNhap
      const [dong, ten] = await Promise.all([napDong<DongNhap>(supabase, DONG_NHAP, ids), napTenNguoi(supabase, [ph.created_by])])
      return { sheets: xuatPhieuNhap([ph], dong, ten), ma: maCua(loai, p) }
    }
    case "tra-khach": {
      const [dong, ma] = await Promise.all([napDong<DongTraKhach>(supabase, DONG_TRA_KHACH, ids), docMaPhieuTra(supabase, ids)])
      return { sheets: xuatTraHangKhach([p as unknown as PhieuTraKhach], dong, ma), ma: maCua(loai, p, ma.get(id)) }
    }
    case "thu": {
      const dong = await napDong<DongThu>(supabase, DONG_THU, ids)
      return { sheets: xuatPhieuThu([p as unknown as PhieuThuXuat], dong), ma: maCua(loai, p) }
    }
    case "chi": {
      const ph = p as unknown as PhieuChiXuat
      const ten = await napTenNguoi(supabase, [ph.created_by])
      return { sheets: xuatChiPhi([ph], ten), ma: maCua(loai, p) }
    }
    case "kho": {
      const dong = await napDong<DongKho>(supabase, DONG_KHO, ids)
      return { sheets: xuatPhieuKho([p as unknown as PhieuKhoXuat], dong, !!o.giaVon), ma: maCua(loai, p) }
    }
    case "don": {
      const dong = await napDong<DongDon>(supabase, DONG_DON, ids)
      return { sheets: xuatDonHang([p as unknown as DonXuat], dong), ma: maCua(loai, p) }
    }
    case "hoa-don": {
      const [dong, tra] = await Promise.all([napDong<DongHoaDon>(supabase, DONG_HOA_DON, ids), traTheoHoaDon(supabase, ids)])
      return { sheets: xuatHoaDon([p as unknown as HoaDonXuat], dong, tra), ma: maCua(loai, p) }
    }
  }
}
