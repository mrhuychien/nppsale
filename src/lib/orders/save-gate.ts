/**
 * Chặn hay cho qua khi lưu đơn — một bộ luật cho CẢ HAI nút.
 *
 * VÌ SAO GOM LẠI
 *   Màn tạo đơn nay có hai nút: "Lưu nháp" và "Tạo đơn hàng". Nếu mỗi nút
 *   tự kiểm lấy thì nút nháp sẽ thành đường vòng: cái gì nút kia chặn, cứ
 *   bấm nút này là lọt. Gom về một hàm thì khác biệt giữa hai nút là DỮ
 *   LIỆU (`asDraft`), nhìn thấy được và kiểm chứng được.
 *
 * HAI LUẬT KHÁC NHAU GIỮA NHÁP VÀ GỬI ĐI — CÓ LÝ DO
 *
 *   · TỒN KHO: nháp chỉ CẢNH BÁO. Đơn nháp không ra kho hôm nay, mà tồn
 *     kho thì đổi từng giờ — chặn một bản nháp vì tồn của lúc này là chặn
 *     nhầm. Đơn thật vẫn chặn như cũ.
 *
 *   · GIÁ SÀN: nháp vẫn CHẶN y như đơn thật. Thẩm quyền của một NVBH
 *     không đổi theo thời gian, nên nếu nháp cho qua thì "Lưu nháp" trở
 *     thành cách bán dưới giá sàn: lưu nháp giá thấp, rồi nhờ duyệt —
 *     mà bước duyệt KHÔNG kiểm lại giá sàn.
 *
 *   · SẢN PHẨM: nháp cho phép chưa có dòng hàng nào. Đó chính là lúc cần
 *     lưu nháp nhất — đang đứng ở quầy, ghi được tên khách thì khách bận.
 */

export interface SaveMessage {
  title: string
  description?: string
}

export interface SaveGateResult {
  /** Có thì KHÔNG lưu, hiện câu này. */
  block: SaveMessage | null
  /** Có thì vẫn lưu, nhưng nói cho người dùng biết. */
  warn: SaveMessage | null
}

export interface SaveGateInput {
  /** true = bấm "Lưu nháp"; false = bấm "Tạo đơn hàng". */
  asDraft: boolean
  hasCustomer: boolean
  lineCount: number
  /** Mỗi phần tử là một câu mô tả một mặt hàng vượt tồn. */
  overstock: string[]
  /** NPP đã bật cho phép bán vượt tồn. */
  allowOversell: boolean
  /** Mỗi phần tử là một câu mô tả một dòng bán dưới giá sàn. */
  priceViolations: string[]
}

export function gateForSave(i: SaveGateInput): SaveGateResult {
  if (!i.hasCustomer) {
    return {
      block: {
        title: i.asDraft
          ? "Chọn khách hàng trước đã"
          : "Vui lòng chọn khách hàng và thêm sản phẩm",
        description: i.asDraft ? "Bản nháp cần biết là nháp cho khách nào." : undefined,
      },
      warn: null,
    }
  }

  // Đơn thật phải có hàng; bản nháp thì chưa cần.
  if (!i.asDraft && i.lineCount === 0) {
    return { block: { title: "Vui lòng chọn khách hàng và thêm sản phẩm" }, warn: null }
  }

  // ⚠ Giá sàn chặn ở CẢ HAI nút — xem phần đầu file.
  if (i.priceViolations.length > 0) {
    return {
      block: {
        title: "Giá ngoài giới hạn cho phép",
        description: i.priceViolations.join(" • "),
      },
      warn: null,
    }
  }

  if (i.overstock.length > 0) {
    const description = i.overstock.join(" • ")
    if (i.asDraft) {
      return { block: null, warn: { title: "Lưu nháp — có mặt hàng vượt tồn", description } }
    }
    if (i.allowOversell) {
      return { block: null, warn: { title: "Cảnh báo: bán vượt tồn", description } }
    }
    return { block: { title: "Số lượng vượt tồn kho", description }, warn: null }
  }

  return { block: null, warn: null }
}

/**
 * Ghi vào `approval_reason` của đơn lưu nháp.
 *
 * ⚠ KHÔNG để trống. Cột đó trống nghĩa là "đã duyệt, không có gì vướng";
 * đơn nháp chưa ai xem nên phải nói rõ vì sao nó còn nằm đó.
 */
export const DRAFT_APPROVAL_REASON = "Lưu nháp — chưa gửi duyệt"
