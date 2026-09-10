import QRCode from "qrcode"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Mở cửa sổ in phiếu mã QR đăng nhập cho 1 nhân viên. Dùng chung cho
 * trang tạo NV quét QR và hộp thoại QR trong danh sách nhân viên.
 * Tên nhân viên được escape để tránh chèn HTML.
 */
export async function printQrLoginCard(userName: string, loginUrl: string) {
  const svg = await QRCode.toString(loginUrl, {
    type: "svg",
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
  })
  const w = window.open("", "_blank", "width=520,height=680")
  if (!w) return
  const name = escapeHtml(userName)
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8" />
    <title>QR đăng nhập — ${name}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;text-align:center;padding:32px;color:#111}
      .name{font-size:20px;font-weight:700;margin:8px 0 2px}
      .role{font-size:13px;color:#555;margin-bottom:16px}
      .qr{display:inline-block;padding:12px;border:1px solid #ddd;border-radius:12px}
      .hint{font-size:12px;color:#666;margin-top:16px;max-width:340px;margin-left:auto;margin-right:auto;line-height:1.5}
      .brand{font-size:15px;font-weight:700;color:#2563eb;margin-bottom:4px}
    </style></head><body>
    <div class="brand">npp.sale</div>
    <div class="name">${name}</div>
    <div class="role">Mã QR đăng nhập nhanh</div>
    <div class="qr">${svg}</div>
    <div class="hint">Dùng camera điện thoại quét mã QR để đăng nhập vào app.
    Giữ mã QR ở nơi an toàn — bất kỳ ai quét được cũng vào được tài khoản này.</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
    </body></html>`)
  w.document.close()
}

/**
 * Tải mã QR đăng nhập về máy dưới dạng PNG, để gửi cho nhân viên qua Zalo
 * / tin nhắn.
 *
 * VÌ SAO CẦN, TRONG KHI ĐÃ CÓ "IN"
 *   In cần máy in. Phần lớn NPP gửi mã cho nhân viên qua điện thoại, nên
 *   thứ họ cần là một tấm ảnh gửi được — không phải một trang để in.
 *
 * PNG chứ không phải SVG: Zalo và các ứng dụng nhắn tin phổ biến không
 * hiện trước SVG, người nhận thấy một file lạ không mở được.
 *
 * Dựng hoàn toàn phía trình duyệt — token đăng nhập không đi qua dịch vụ
 * ngoài nào.
 */
export async function downloadQrLoginPng(name: string, loginUrl: string): Promise<void> {
  const QRCode = (await import("qrcode")).default
  const dataUrl = await QRCode.toDataURL(loginUrl, {
    margin: 2,
    width: 720, // đủ nét khi người nhận phóng to trên điện thoại
    errorCorrectionLevel: "M",
    color: { dark: "#0b1220", light: "#ffffff" },
  })
  const a = document.createElement("a")
  a.href = dataUrl
  // Bỏ dấu và ký tự lạ khỏi tên file — Windows không nhận / \ : * ? " < > |
  const safe =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "nhan-vien"
  a.download = `qr-dang-nhap-${safe}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
}
