/**
 * Thứ tự hiện sản phẩm lúc tạo đơn.
 *
 * MỘT chỗ duy nhất, dùng chung cho ô tìm trên máy tính và bộ chọn trên
 * điện thoại. Hai màn đó làm cùng một việc; để hai phép xếp riêng thì
 * NVBH thấy hai thứ tự khác nhau trên hai thiết bị mà không hiểu vì sao.
 */

export interface SortableProduct {
  id: string
  name: string
}

/**
 * Tồn kho NHIỀU TRƯỚC.
 *
 * Xếp theo tên thì mặt hàng hết sạch nằm lẫn với mặt hàng còn đầy kho, và
 * NVBH đứng ở quầy khách phải bấm từng cái để biết còn hàng không. Hàng
 * còn nhiều là hàng bán được — đưa lên đầu.
 *
 * ⚠ Hết hàng KHÔNG bị ẩn, chỉ xuống cuối. Khách vẫn hỏi, và nhân viên vẫn
 * cần tra được giá để trả lời.
 *
 * ⚠ Cùng mức tồn thì xếp theo TÊN. Thiếu vế này thì thứ tự do thuật toán
 * sắp xếp tự quyết, và hai lần gõ cùng một từ có thể ra hai thứ tự khác
 * nhau — danh sách nhảy dưới tay người đang bấm.
 */
export function compareByStockDesc(
  stockByProduct: Record<string, number>
): (a: SortableProduct, b: SortableProduct) => number {
  return (a, b) => {
    // Sản phẩm chưa có trong bản đồ tồn coi như 0 — chưa biết thì không
    // được ưu tiên như hàng còn đầy kho.
    const d = (stockByProduct[b.id] ?? 0) - (stockByProduct[a.id] ?? 0)
    return d !== 0 ? d : a.name.localeCompare(b.name, "vi")
  }
}
