/**
 * MÃ QR CHUYỂN KHOẢN (VietQR — chuẩn NAPAS trên khung EMVCo) cho tờ in hoá đơn — chủ nhà 10/11/2026: "em thêm cho a mã QR
 * thanh toán số tiền trên hóa đơn, nội dung Thanh toán đến tài khoản. mã để cạnh khu vực ký (song song)".
 *
 * Chuỗi dựng TẠI CHỖ (không gọi dịch vụ ngoài như img.vietqr.io — số tiền / tài khoản không rời máy, in được khi mất mạng).
 * Cấu trúc đối chiếu với đặc tả NAPAS + gói `vietnam-qr-pay` (chỉ đọc mã nguồn, KHÔNG thêm vào dự án):
 *   00 "01" · 01 "12" (có số tiền) / "11" (không) · 38 [00 "A000000727" · 01 [00 BIN ngân hàng · 01 số tài khoản] ·
 *   02 "QRIBFTTA" (chuyển tới SỐ TÀI KHOẢN)] · 53 "704" (VND) · 54 số tiền · 58 "VN" · 62 [08 nội dung chuyển khoản] ·
 *   63 CRC-16/CCITT-FALSE của cả chuỗi tính tới hết "6304".
 * ⚠ CHỈ KÝ TỰ ASCII: độ dài trường đếm theo ký tự — chữ có dấu (UTF-8 nhiều byte) là app ngân hàng đọc lệch / báo mã hỏng.
 *   Nội dung bỏ dấu, ≤ 25 ký tự (trần NAPAS của "mục đích giao dịch").
 * ⚠ Tài khoản là CÀI ĐẶT CỦA NPP (`organizations.settings.bank_bin` / `bank_account_no`, Cấu hình tổ chức) — không ghi cứng
 *   vào mã (kho dựng cho nhiều NPP, xem `src/lib/printing/luu-y-in.ts`).
 */

/** Tài khoản nhận tiền của NPP — đủ để dựng mã (tên chủ tài khoản do app ngân hàng tự tra khi quét). */
export interface TaiKhoanNhan {
  /** Mã BIN ngân hàng của NAPAS, 6 số (Techcombank 970407). */
  bin: string
  soTaiKhoan: string
  /** Tên chủ tài khoản (tuỳ chọn) — KHÔNG nằm trong mã, chỉ in trong câu "Lưu ý" mặc định (`cauLuuYMacDinh`). */
  tenChuTk?: string
}

/** Nội dung chuyển khoản trên mã của hoá đơn — đúng lời chủ nhà "Thanh toán đến tài khoản", đã bỏ dấu. */
export const NOI_DUNG_QR_HOA_DON = "Thanh toan den tai khoan"

/**
 * Ngân hàng nhận được chuyển khoản VietQR (BIN theo NAPAS — đối chiếu danh sách của gói `vietnam-qr-pay` 1.5.1, bỏ ví điện tử
 * và ngân hàng chưa hỗ trợ). Xếp theo tên ngắn.
 */
export const NGAN_HANG_VIETQR: ReadonlyArray<{ bin: string; ten: string; tenDayDu: string }> = [
  { bin: "970425", ten: "ABBANK", tenDayDu: "Ngân hàng TMCP An Bình" },
  { bin: "970416", ten: "ACB", tenDayDu: "Ngân hàng TMCP Á Châu" },
  { bin: "970405", ten: "Agribank", tenDayDu: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam" },
  { bin: "970409", ten: "Bac A Bank", tenDayDu: "Ngân hàng TMCP Bắc Á" },
  { bin: "970438", ten: "BaoViet Bank", tenDayDu: "Ngân hàng TMCP Bảo Việt" },
  { bin: "970418", ten: "BIDV", tenDayDu: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam" },
  { bin: "970454", ten: "BVBank", tenDayDu: "Ngân hàng TMCP Bản Việt" },
  { bin: "546034", ten: "CAKE by VPBank", tenDayDu: "Ngân hàng số CAKE by VPBank" },
  { bin: "970444", ten: "CB Bank", tenDayDu: "Ngân hàng Thương mại TNHH MTV Xây dựng Việt Nam" },
  { bin: "422589", ten: "CIMB", tenDayDu: "Ngân hàng TNHH MTV CIMB Việt Nam" },
  { bin: "970446", ten: "Co-op Bank", tenDayDu: "Ngân hàng Hợp tác xã Việt Nam" },
  { bin: "796500", ten: "DBS Bank", tenDayDu: "Ngân hàng TNHH MTV Phát triển Singapore - CN TP. Hồ Chí Minh" },
  { bin: "970431", ten: "Eximbank", tenDayDu: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam" },
  { bin: "970408", ten: "GPBank", tenDayDu: "Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu" },
  { bin: "970437", ten: "HDBank", tenDayDu: "Ngân hàng TMCP Phát triển TP. Hồ Chí Minh" },
  { bin: "970442", ten: "Hong Leong Bank", tenDayDu: "Ngân hàng TNHH MTV Hong Leong Việt Nam" },
  { bin: "458761", ten: "HSBC", tenDayDu: "Ngân hàng TNHH MTV HSBC (Việt Nam)" },
  { bin: "970456", ten: "IBK TP. HCM", tenDayDu: "Ngân hàng Công nghiệp Hàn Quốc - CN TP. Hồ Chí Minh" },
  { bin: "970455", ten: "IBK Hà Nội", tenDayDu: "Ngân hàng Công nghiệp Hàn Quốc - CN Hà Nội" },
  { bin: "970434", ten: "Indovina Bank", tenDayDu: "Ngân hàng TNHH Indovina" },
  { bin: "668888", ten: "KBank", tenDayDu: "Ngân hàng KASIKORNBANK - CN TP. Hồ Chí Minh" },
  { bin: "970452", ten: "KienlongBank", tenDayDu: "Ngân hàng TMCP Kiên Long" },
  { bin: "970463", ten: "Kookmin TP. HCM", tenDayDu: "Ngân hàng Kookmin - CN TP. Hồ Chí Minh" },
  { bin: "970462", ten: "Kookmin Hà Nội", tenDayDu: "Ngân hàng Kookmin - CN Hà Nội" },
  { bin: "963369", ten: "Liobank", tenDayDu: "Ngân hàng số Liobank - Ngân hàng TMCP Phương Đông" },
  { bin: "970449", ten: "LPBank (LienVietPostBank)", tenDayDu: "Ngân hàng TMCP Lộc Phát Việt Nam" },
  { bin: "970422", ten: "MB Bank", tenDayDu: "Ngân hàng TMCP Quân đội" },
  { bin: "970414", ten: "MBV (OceanBank)", tenDayDu: "Ngân hàng TNHH MTV Việt Nam Hiện Đại" },
  { bin: "970426", ten: "MSB", tenDayDu: "Ngân hàng TMCP Hàng Hải" },
  { bin: "970428", ten: "Nam A Bank", tenDayDu: "Ngân hàng TMCP Nam Á" },
  { bin: "970419", ten: "NCB", tenDayDu: "Ngân hàng TMCP Quốc Dân" },
  { bin: "801011", ten: "Nonghyup Hà Nội", tenDayDu: "Ngân hàng Nonghyup - CN Hà Nội" },
  { bin: "970448", ten: "OCB", tenDayDu: "Ngân hàng TMCP Phương Đông" },
  { bin: "970430", ten: "PG Bank", tenDayDu: "Ngân hàng TMCP Xăng dầu Petrolimex" },
  { bin: "970439", ten: "Public Bank", tenDayDu: "Ngân hàng TNHH MTV Public Việt Nam" },
  { bin: "970412", ten: "PVcomBank", tenDayDu: "Ngân hàng TMCP Đại Chúng Việt Nam" },
  { bin: "970403", ten: "Sacombank", tenDayDu: "Ngân hàng TMCP Sài Gòn Thương Tín" },
  { bin: "970400", ten: "SaigonBank", tenDayDu: "Ngân hàng TMCP Sài Gòn Công Thương" },
  { bin: "970429", ten: "SCB", tenDayDu: "Ngân hàng TMCP Sài Gòn" },
  { bin: "970440", ten: "SeABank", tenDayDu: "Ngân hàng TMCP Đông Nam Á" },
  { bin: "970443", ten: "SHB", tenDayDu: "Ngân hàng TMCP Sài Gòn - Hà Nội" },
  { bin: "970424", ten: "Shinhan Bank", tenDayDu: "Ngân hàng TNHH MTV Shinhan Việt Nam" },
  { bin: "970410", ten: "Standard Chartered", tenDayDu: "Ngân hàng TNHH MTV Standard Chartered Việt Nam" },
  { bin: "970407", ten: "Techcombank", tenDayDu: "Ngân hàng TMCP Kỹ thương Việt Nam" },
  { bin: "963388", ten: "Timo", tenDayDu: "Ngân hàng số Timo by Bản Việt" },
  { bin: "970423", ten: "TPBank", tenDayDu: "Ngân hàng TMCP Tiên Phong" },
  { bin: "546035", ten: "Ubank by VPBank", tenDayDu: "Ngân hàng số Ubank by VPBank" },
  { bin: "970458", ten: "UOB", tenDayDu: "Ngân hàng United Overseas Bank Việt Nam" },
  { bin: "970441", ten: "VIB", tenDayDu: "Ngân hàng TMCP Quốc tế Việt Nam" },
  { bin: "970427", ten: "VietABank", tenDayDu: "Ngân hàng TMCP Việt Á" },
  { bin: "970433", ten: "VietBank", tenDayDu: "Ngân hàng TMCP Việt Nam Thương Tín" },
  { bin: "970436", ten: "Vietcombank", tenDayDu: "Ngân hàng TMCP Ngoại Thương Việt Nam" },
  { bin: "970415", ten: "VietinBank", tenDayDu: "Ngân hàng TMCP Công thương Việt Nam" },
  { bin: "970406", ten: "Vikki Bank (DongA Bank)", tenDayDu: "Ngân hàng TNHH MTV Số Vikki" },
  { bin: "970432", ten: "VPBank", tenDayDu: "Ngân hàng TMCP Việt Nam Thịnh Vượng" },
  { bin: "970421", ten: "VRB", tenDayDu: "Ngân hàng Liên doanh Việt - Nga" },
  { bin: "970457", ten: "Woori Bank", tenDayDu: "Ngân hàng TNHH MTV Woori Việt Nam" },
]

export function nganHangTheoBin(bin: string | null | undefined) {
  return NGAN_HANG_VIETQR.find((b) => b.bin === bin) ?? null
}

/** Số tài khoản: bỏ khoảng trắng / dấu chấm / gạch người dùng gõ cho dễ đọc; hợp lệ = 1–19 chữ cái / số (NAPAS). */
export function chuanSoTaiKhoan(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/[\s.\-]/g, "")
  return /^[0-9A-Za-z]{1,19}$/.test(t) ? t : null
}

/** Tài khoản nhận tiền từ cài đặt: đủ BIN 6 số + số tài khoản hợp lệ, không thì null (tờ in không có mã). */
export function taiKhoanNhanTu(
  bin: string | null | undefined,
  soTaiKhoan: string | null | undefined,
  tenChuTk?: string | null
): TaiKhoanNhan | null {
  const b = (bin ?? "").trim()
  const tk = chuanSoTaiKhoan(soTaiKhoan)
  if (!/^\d{6}$/.test(b) || !tk) return null
  /* Tên gộp khoảng trắng, bỏ dấu chấm cuối (câu Lưu ý tự thêm dấu chấm). */
  const ten = (tenChuTk ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "")
  return ten ? { bin: b, soTaiKhoan: tk, tenChuTk: ten } : { bin: b, soTaiKhoan: tk }
}

/** Câu báo khi lưu cài đặt: đủ cả hai hoặc trống cả hai (không in mã); null = hợp lệ. */
export function loiTaiKhoanNhan(bin: string, soTaiKhoan: string): string | null {
  const coBin = bin.trim() !== ""
  const coTk = soTaiKhoan.trim() !== ""
  if (!coBin && !coTk) return null
  if (!coBin) return "Chọn ngân hàng của số tài khoản nhận tiền (hoặc xoá số tài khoản để không in mã QR)."
  if (!coTk) return "Nhập số tài khoản nhận tiền (hoặc chọn “Không in mã QR”)."
  if (!taiKhoanNhanTu(bin, soTaiKhoan)) return "Số tài khoản chỉ gồm chữ số / chữ cái, tối đa 19 ký tự."
  return null
}

/** Nội dung chuyển khoản: bỏ dấu, chỉ giữ chữ / số / khoảng trắng / gạch nối, ≤ 25 ký tự. */
export function noiDungChuyenKhoan(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9 \-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 25)
    .trim()
}

/** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi 0xFFFF) — 4 chữ hex hoa. Chuỗi đầu vào chỉ có ASCII. */
export function crc16Ccitt(s: string): string {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    crc ^= (s.charCodeAt(i) & 0xff) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

const truong = (id: string, v: string) => `${id}${String(v.length).padStart(2, "0")}${v}`

/**
 * Chuỗi VietQR chuyển tới số tài khoản. `soTien` (đồng, làm tròn) > 0 thì mã ghi sẵn số tiền ("12"), vắng thì để người
 * quét tự gõ ("11"). Tài khoản / số tiền không hợp lệ → null (không in mã sai).
 */
export function chuoiVietQr(p: TaiKhoanNhan & { soTien?: number | null; noiDung?: string | null }): string | null {
  const tk = taiKhoanNhanTu(p.bin, p.soTaiKhoan)
  if (!tk) return null
  const tien = p.soTien == null ? null : Math.round(Number(p.soTien))
  if (tien != null && !(Number.isFinite(tien) && tien > 0 && tien <= 9_999_999_999_999)) return null
  const nd = noiDungChuyenKhoan(p.noiDung)
  const thuHuong =
    truong("00", "A000000727") + truong("01", truong("00", tk.bin) + truong("01", tk.soTaiKhoan)) + truong("02", "QRIBFTTA")
  let s = truong("00", "01") + truong("01", tien ? "12" : "11") + truong("38", thuHuong) + truong("53", "704")
  if (tien) s += truong("54", String(tien))
  s += truong("58", "VN")
  if (nd) s += truong("62", truong("08", nd))
  s += "6304"
  return s + crc16Ccitt(s)
}
