/**
 * MỞ LINK ĐĂNG NHẬP QR BẰNG TRÌNH DUYỆT RIÊNG TRÊN iPHONE — chủ nhà 30/09/2026: "vậy chỉ cần thêm link
 * mở tab chrome hoặc safari độc lập là được vì npp dùng iphone".
 *
 * App thêm ra màn hình chính trên iPhone có kho đăng nhập RIÊNG (tách khỏi Safari / Chrome). Mở link
 * nhân viên bằng Safari / Chrome thì trình duyệt đó đăng nhập thành nhân viên, còn phiên của chủ NPP
 * trong app ở màn hình chính giữ nguyên.
 *   - Safari: `x-safari-https://…` — iPhone mở thẳng Safari (kể cả khi đang ở app khác).
 *   - Chrome: `googlechromes://…` (link https) / `googlechrome://…` (http) — mở ứng dụng Chrome.
 */

export interface LinkTrinhDuyet {
  safari: string
  chrome: string
}

export function linkTrinhDuyetRieng(url: string): LinkTrinhDuyet | null {
  const m = /^(https?):\/\/(.+)$/i.exec(url.trim())
  if (!m) return null
  const https = m[1].toLowerCase() === "https"
  return {
    safari: `x-safari-${m[1].toLowerCase()}://${m[2]}`,
    chrome: `${https ? "googlechromes" : "googlechrome"}://${m[2]}`,
  }
}

/** iPhone / iPad (iPadOS báo là Mac nhưng có màn cảm ứng). */
export function laThietBiApple(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return /Macintosh/i.test(ua) && maxTouchPoints > 1
}
