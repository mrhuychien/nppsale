/**
 * TẠO NHANH Ở MÀN BÁN HÀNG ĐIỆN THOẠI (/sell) — chủ nhà 03/10/2026, Update 3.10 mục 5: "Update ngược cơ chế
 * tương tự cho sell bán hàng trên mobile" (mục 4: "Đang làm đơn -> thêm khách hàng -> thêm xong quay về phần
 * đơn đang làm, add luôn khách vừa thêm vào khách. Tương tự sản phẩm cũng vậy").
 *
 * ⚠ BIỂU MẪU TRẢ VỀ ÍT HƠN THỨ MÀN BÁN CẦN. `ProductForm` trả dòng `products` trần — không có bảng giá, không
 *   có đơn vị quy đổi; `TaoNhanhKhach` trả `KhachVuaTao` — không có nhóm khách / điều khoản / hạn mức. Mà giá
 *   trên thẻ (`unitPriceFor`), nút đơn vị (`sellableUnits`), bảng giá theo nhóm và điều khoản mặc định của đơn
 *   đều đọc từ đó. Nên: ĐỌC LẠI đúng một dòng từ máy chủ theo cột của danh mục bán (`loadOneSell*`); đọc hỏng
 *   thì vẫn dùng bản biểu mẫu trả (giá cơ sở = `sell_price`, chưa có đơn vị phụ) — thà thiếu thùng còn hơn
 *   bắt nhân viên tải lại cả danh mục giữa lúc đứng ở quầy khách.
 */
import type { KhachVuaTao } from "@/lib/customers/tao-khach"
import type { Customer, Product } from "@/types"
import type { SellProduct } from "@/lib/sell/ref-data"

/**
 * Sản phẩm vừa tạo → dạng danh mục bán. Có bản đọc lại từ máy chủ thì lấy bản đó (đủ bảng giá + đơn vị);
 * không thì bản biểu mẫu với `price_lists` / `units` RỖNG — `unitPriceFor` khi đó rơi về `sell_price`.
 */
export function sanPhamBanTuMoiTao(saved: Product, docLai: SellProduct | null | undefined): SellProduct {
  if (docLai && docLai.id === saved.id) {
    return { ...docLai, price_lists: docLai.price_lists ?? [], units: docLai.units ?? [] }
  }
  return { ...saved, price_lists: [], units: [] }
}

/** Khách vừa tạo → dạng danh mục bán. Đọc lại hỏng thì ghép từ `KhachVuaTao` (chưa có nhóm → bảng giá chung). */
export function khachBanTuMoiTao(k: KhachVuaTao, docLai: Customer | null | undefined): Customer {
  if (docLai && docLai.id === k.id) return docLai
  return {
    id: k.id,
    store_name: k.store_name,
    owner_name: k.owner_name ?? "",
    phone: k.phone ?? "",
    address: k.address ?? "",
    channel: k.channel,
    group_id: null,
    credit_limit: 0,
    payment_terms: "",
    status: "active",
  } as unknown as Customer
}

/** Đọc lại một dòng; lỗi mạng / RLS thì `null` (không ném — nơi gọi đã có bản dự phòng). */
export async function docLaiKhongNem<T>(doc: () => Promise<T | null>): Promise<T | null> {
  try {
    return await doc()
  } catch {
    return null
  }
}
