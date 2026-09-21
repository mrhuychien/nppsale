"use client"

/**
 * "DANH MỤC ĐỌC CHƯA HẾT" — một câu, một chỗ.
 *
 * ⚠ VÌ SAO LÀ MỘT COMPONENT CHỨ KHÔNG PHẢI MỘT DÒNG JSX CHÉP RA. Chín
 * màn nạp danh mục hàng qua `loadCatalogue`, và cả chín đều phải nói
 * cùng một câu khi cờ `truncated` bật. Chép ra chín bản là chín lần
 * phải nhớ sửa, và màn nào quên thì lại im lặng — đúng thứ lỗi mà cờ
 * `truncated` sinh ra để chặn.
 *
 * ⚠ CÂU NÀY PHẢI CHỈ ĐƯỢC LỐI THOÁT. "Có lỗi xảy ra" không giúp gì cho
 * người đang nhập dở một phiếu ba mươi dòng. Nói rõ KẾT QUẢ ĐANG THIẾU
 * và việc cần làm là tải lại — nếu không họ sẽ kết luận danh mục thiếu
 * mã rồi đi tạo một mã trùng.
 */

import { AlertTriangle } from "lucide-react"

export function CatalogueShortNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-[#b54708]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {children ?? "Danh mục đọc chưa hết — kết quả tìm đang thiếu. Tải lại trang."}
      </span>
    </p>
  )
}
