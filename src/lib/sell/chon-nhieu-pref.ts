/**
 * NHỚ CHẾ ĐỘ "CHỌN NHIỀU" CỦA MÀN /sell — tới khi người dùng TỰ TẮT.
 *
 * ⚠ CHỦ NHÀ YÊU CẦU 24/09/2026: "người dùng đã bấm nút chọn nhiều sản phẩm
 *   thì phải luôn lưu trạng thái đến khi người dùng tự tắt. Hiện tại vào đơn
 *   xong quay lại lại mất". Trạng thái cũ là `useState` của trang: sang giỏ
 *   rồi quay lại là trang dựng lại, và bấm "Thêm vào đơn" cũng tắt luôn.
 *
 * ⚠ HAI CÔNG TẮC RIÊNG: đặt hàng và chọn hàng trả. Bật ở việc này không kéo
 *   việc kia theo — hai màn nhìn giống nhau mà hai chiều tiền ngược nhau.
 *
 * ⚠ CHỈ NHỚ CÔNG TẮC, KHÔNG NHỚ SỐ ĐANG GÕ DỞ. Số gõ dở là của một lượt
 *   chọn; mang nó qua lần mở sau là thêm vào đơn những món khách không gọi.
 *
 * Bộ nhớ trình duyệt có thể hỏng / bị chặn (chế độ riêng tư) — mọi lần
 * đọc ghi đều bọc try/catch, hỏng thì coi như chưa bật.
 */
export type CheDoSell = "dat" | "tra"

const khoa = (m: CheDoSell) => `npp.sell.chonNhieu.${m}`

export function docChonNhieu(m: CheDoSell, kho: Pick<Storage, "getItem"> | null = khoMacDinh()): boolean {
  try {
    return kho?.getItem(khoa(m)) === "1"
  } catch {
    return false
  }
}

export function ghiChonNhieu(m: CheDoSell, bat: boolean, kho: Pick<Storage, "setItem" | "removeItem"> | null = khoMacDinh()): void {
  try {
    if (bat) kho?.setItem(khoa(m), "1")
    else kho?.removeItem(khoa(m))
  } catch {
    /* Quota / riêng tư — bỏ qua, chế độ vẫn chạy trong phiên này. */
  }
}

function khoMacDinh(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
