/**
 * CÁC TRƯỜNG TÌM của từng danh sách chứng từ — cho `DocSearchBox`.
 *
 * ⚠ HẰNG Ở ĐẦU TỆP, KHÔNG DỰNG TRONG COMPONENT: `useFieldSearch` lấy nó làm
 *   khoá của effect; dựng lại mỗi lần vẽ là tra lại mỗi lần vẽ.
 *
 * ⚠ "SERIAL/IMEI" TRONG MẪU → "SỐ LÔ". Sổ không lưu serial; lô là thứ có
 *   thật, và chỉ HÓA ĐƠN mới nối được tới lô (qua phiếu xuất kho của nó).
 *   Đơn hàng chưa xuất kho nên không có lô; phiếu trả nhập lô lúc hoàn thành.
 */
import type { TruongTim, BuocTra } from "@/lib/search/field-search"

const SAN_PHAM: BuocTra = { bang: "products", cotTim: ["sku", "name", "barcode"], layCot: "id", coOrg: true }
const KHACH: BuocTra = { bang: "customers", cotTim: ["store_name", "owner_name", "phone", "tax_code"], layCot: "id", coOrg: true }

const theoHang = (bangDong: string, cotPhieu: string): TruongTim => ({
  key: "hang",
  nhan: "Theo mã, tên hàng",
  chuoi: [{ cotDich: "id", buoc: [SAN_PHAM, { bang: bangDong, theoCot: "product_id", layCot: cotPhieu }] }],
})
const THEO_KHACH: TruongTim = {
  key: "khach",
  nhan: "Theo tên, số điện thoại khách hàng",
  chuoi: [{ cotDich: "customer_id", buoc: [KHACH] }],
}

export const TRUONG_DON_HANG: readonly TruongTim[] = [
  { key: "ma", nhan: "Theo mã đơn hàng", cotRieng: ["order_code"] },
  theoHang("sales_order_lines", "order_id"),
  THEO_KHACH,
]

export const TRUONG_HOA_DON: readonly TruongTim[] = [
  {
    key: "ma",
    nhan: "Theo mã hóa đơn, mã đơn",
    cotRieng: ["invoice_code"],
    chuoi: [{ cotDich: "order_id", buoc: [{ bang: "sales_orders", cotTim: ["order_code"], layCot: "id", coOrg: true }] }],
  },
  theoHang("sales_invoice_lines", "invoice_id"),
  {
    key: "lo",
    nhan: "Theo số lô",
    chuoi: [{
      cotDich: "stock_entry_id",
      buoc: [
        { bang: "batches", cotTim: ["batch_code"], layCot: "id", coOrg: true },
        { bang: "stock_entry_lines", theoCot: "batch_id", layCot: "entry_id" },
      ],
    }],
  },
  THEO_KHACH,
]

/** Phiếu trả của khách KHÔNG có mã riêng — tìm theo mã đơn / mã hóa đơn gốc. */
export const TRUONG_TRA_HANG: readonly TruongTim[] = [
  {
    key: "ma",
    nhan: "Theo mã đơn, mã hóa đơn gốc",
    chuoi: [
      { cotDich: "order_id", buoc: [{ bang: "sales_orders", cotTim: ["order_code"], layCot: "id", coOrg: true }] },
      { cotDich: "invoice_id", buoc: [{ bang: "sales_invoices", cotTim: ["invoice_code"], layCot: "id", coOrg: true }] },
    ],
  },
  theoHang("return_lines", "return_id"),
  THEO_KHACH,
]
