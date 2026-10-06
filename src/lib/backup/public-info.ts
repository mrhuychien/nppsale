export const backupInfo = {
  updated: "06/10/2026",
  introduction: [
    "Công cụ nội bộ hỗ trợ sao lưu cơ sở dữ liệu nppsale từ Supabase sang Google Drive. Hệ thống đang được cấu hình cho lịch 02:00 hằng ngày theo giờ Việt Nam; chưa xác minh được bản sao lưu thực tế từ cấu hình này.",
  ],
  privacy: [
    {
      title: "2. Dữ liệu được xử lý",
      paragraphs: [
        "Bản sao gồm cấu trúc và dữ liệu database, có thể chứa thông tin khách hàng, nhân viên, đơn hàng, công nợ, tài khoản và metadata tệp. Dữ liệu chỉ được xử lý để sao lưu và hỗ trợ phục hồi, không dùng cho quảng cáo hoặc bán dữ liệu. Nội dung ảnh và tệp trong Supabase Storage không thuộc bản sao này.",
      ],
    },
    {
      title: "3. Quyền Google Drive",
      paragraphs: [
        "Công cụ sử dụng quyền drive.file để tạo và truy cập các tệp do ứng dụng tạo hoặc được người dùng cấp quyền, không truy cập toàn bộ Drive. Quyền truy cập ngoại tuyến giúp lịch sao lưu hoạt động khi người dùng không mở trình duyệt. Người dùng có thể thu hồi quyền trong tài khoản Google.",
      ],
    },
    {
      title: "4. Xử lý và lưu trữ",
      paragraphs: [
        "GitHub Actions xuất database, thử khôi phục trong môi trường tạm, rồi mã hoá bằng age trước khi tải lên Drive. GitHub cũng giữ artifact mã hoá theo cấu hình 90 ngày, tuỳ giới hạn nền tảng. Khoá giải mã riêng do người quản lý giữ ngoài GitHub Actions.",
        "Repo hiện công khai nên log vận hành có thể công khai, và người có quyền đọc repo có thể tải artifact mã hoá. Log có thể chứa số lượng bảng, số bản ghi và metadata lỗi. Người quản lý cần kiểm soát quyền truy cập và rà soát log.",
      ],
    },
    {
      title: "5. Lưu giữ và xoá",
      paragraphs: [
        "Mặc định không tự xoá bản sao trên Drive. Người quản lý theo dõi dung lượng và quyết định thời gian lưu giữ. Thu hồi quyền hoặc tắt workflow sẽ dừng các lượt sao lưu tiếp theo nhưng không tự xoá bản sao đã lưu tại Drive và GitHub.",
      ],
    },
  ],
  terms: [
    "Chỉ người có quyền quản lý dữ liệu nguồn và nơi lưu trữ được cấu hình công cụ. Người quản lý chịu trách nhiệm bảo quản khoá giải mã; mất khoá có thể khiến bản sao không sử dụng được. Kiểm tra restore tự động có phạm vi hạn chế, chưa chứng minh toàn bộ ứng dụng phục hồi được. Cần thử giải mã và khôi phục trên database tạm trước khi sử dụng cho sự cố thực tế. Công cụ chưa có cam kết về thời gian chạy hoặc khả năng phục hồi đầy đủ.",
  ],
  contact: "mrhuychien@gmail.com",
} as const
