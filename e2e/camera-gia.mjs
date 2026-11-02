/**
 * CAMERA GIẢ CHO BÀI QUÉT MÃ VẠCH — chủ nhà 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được".
 *
 * Bài e2e cũ đi đường "Nhập tay" (Chromium e2e không có camera) nên camera hỏng mà vẫn xanh. Tệp này vẽ khung hình
 * GIỐNG CAMERA ĐIỆN THOẠI THẬT — mã vạch nhỏ giữa khung (cầm cách ~12 cm), nền bao bì TỐI quanh nhãn trắng, mờ quang
 * học, nhiễu, rung tay — rồi ghi Y4M cho Chromium chiếu thay camera (`--use-file-for-fake-video-capture`). Kiểm thử đơn vị
 * của bản vá ZXing dùng cùng hàm vẽ (`veKhung`).
 */
import { existsSync, renameSync, writeFileSync } from "node:fs"

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
const CHAN_LE = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

/** Số kiểm EAN (13 hay 8 số): trọng số 3-1 tính từ phải sang. */
export function soKiemEan(dau) {
  let s = 0
  for (let i = 0; i < dau.length; i++) s += Number(dau[dau.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  return String((10 - (s % 10)) % 10)
}

/** EAN-13 → 95 mô-đun ("1" vạch đen, "0" khoảng trắng). */
export function modulEan13(ma) {
  if (!/^\d{13}$/.test(ma) || soKiemEan(ma.slice(0, 12)) !== ma[12]) throw new Error(`EAN-13 sai: ${ma}`)
  const d = ma.split("").map(Number)
  const p = CHAN_LE[d[0]]
  let m = "101"
  for (let i = 1; i <= 6; i++) m += (p[i - 1] === "L" ? L : G)[d[i]]
  m += "01010"
  for (let i = 7; i <= 12; i++) m += R[d[i]]
  return m + "101"
}

/** EAN-8 → 67 mô-đun. */
export function modulEan8(ma) {
  if (!/^\d{8}$/.test(ma) || soKiemEan(ma.slice(0, 7)) !== ma[7]) throw new Error(`EAN-8 sai: ${ma}`)
  const d = ma.split("").map(Number)
  let m = "101"
  for (let i = 0; i < 4; i++) m += L[d[i]]
  m += "01010"
  for (let i = 4; i < 8; i++) m += R[d[i]]
  return m + "101"
}

/** Dãy bề rộng vạch / khoảng (vạch trước) → chuỗi mô-đun — vd mẫu Code128 lấy từ bảng của chính ZXing. */
export function modulTuDoRong(rong) {
  let m = ""
  rong.forEach((n, i) => { m += (i % 2 === 0 ? "1" : "0").repeat(n) })
  return m
}

/**
 * Code128 bộ B (chữ + số) → chuỗi mô-đun. `bang` = bảng mẫu vạch của chính ZXing (`Code128Reader.CODE_PATTERNS`, 107 mẫu;
 * mẫu dừng 106 đã đủ 7 ô) — không chép tay bảng thứ hai.
 */
export function modulCode128B(chu, bang) {
  const ma = [104, ...chu.split("").map((c) => c.charCodeAt(0) - 32)]
  let tong = 104
  ma.slice(1).forEach((v, i) => { tong += v * (i + 1) })
  ma.push(tong % 103, 106)
  return ma.map((v) => modulTuDoRong(Array.from(bang[v]))).join("")
}

/** PRNG có hạt giống — khung hình y hệt nhau mỗi lần sinh. */
function prng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mo(src, w, h, sigma) {
  if (sigma <= 0) return src
  const r = Math.ceil(sigma * 3)
  const k = []
  let tong = 0
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); tong += v }
  for (let i = 0; i < k.length; i++) k[i] /= tong
  const tam = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += src[o + Math.min(w - 1, Math.max(0, x + i))] * k[i + r]
      tam[o + x] = s
    }
  }
  const ra = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += tam[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r]
      ra[y * w + x] = s
    }
  }
  return ra
}

/**
 * Một khung hình độ sáng (Y, 0..255): nhãn trắng có vùng lặng `lanh` mô-đun hai bên, giữa là mã `modul` rộng `tiLe` ×
 * bề ngang khung, xoay `goc` độ, dời (dx, dy) px; ngoài nhãn là nền bao bì tối (`nen`, gợn sáng tối như in màu).
 */
export function veKhung({ w, h, modul, tiLe, goc = 0, dx = 0, dy = 0, sigma = 1, nhieu = 6, seed = 1, nen = 95, lanh = 11 }) {
  const n = modul.length
  const rongMa = tiLe * w
  const mw = rongMa / n
  const caoVach = rongMa * 0.55
  const cx = w / 2 + dx
  const cy = h / 2 + dy
  const cos = Math.cos((goc * Math.PI) / 180)
  const sin = Math.sin((goc * Math.PI) / 180)
  const Y = new Float32Array(w * h)
  const MAU = 3 // lấy mẫu 3×3 mỗi điểm ảnh (khử răng cưa)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let sy = 0; sy < MAU; sy++) {
        for (let sx = 0; sx < MAU; sx++) {
          const px = x + (sx + 0.5) / MAU - cx
          const py = y + (sy + 0.5) / MAU - cy
          const u = px * cos + py * sin + rongMa / 2
          const v = -px * sin + py * cos + caoVach / 2
          let l
          if (u >= -lanh * mw && u < rongMa + lanh * mw && v >= -mw * 6 && v < caoVach + mw * 14) {
            l = 222
            if (u >= 0 && u < rongMa && v >= 0 && v < caoVach && modul[Math.floor(u / mw)] === "1") l = 32
          } else {
            l = nen + 40 * Math.sin(px / 210) * Math.cos(py / 330)
          }
          s += l
        }
      }
      Y[y * w + x] = s / (MAU * MAU)
    }
  }
  const M = mo(Y, w, h, sigma)
  const r = prng(seed)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(M[i] + (r() * 2 - 1) * nhieu)))
  return out
}

/** Ghi Y4M 4:2:0 xám (U = V = 128). Chromium chiếu lặp lại từ khung đầu khi hết tệp. */
export function ghiY4m(tep, { w, h, khung }) {
  const phan = [Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`, "ascii")]
  const uv = Buffer.alloc((w / 2) * (h / 2) * 2, 128)
  for (const y of khung) phan.push(Buffer.from("FRAME\n", "ascii"), Buffer.from(y.buffer, y.byteOffset, y.byteLength), uv)
  const tam = `${tep}.${process.pid}.tam`
  writeFileSync(tam, Buffer.concat(phan))
  renameSync(tam, tep)
}

/** Video `soKhung` khung (rung tay nhẹ giữa các khung). Tệp đã có thì để nguyên — Playwright nạp tệp bài hai lần. */
export function sinhVideoMaVach(tep, { w, h, modul, tiLe, sigma = 1.2, nhieu = 6, soKhung = 3 }) {
  if (existsSync(tep)) return tep
  const khung = []
  for (let i = 0; i < soKhung; i++) {
    const r = prng(100 + i)
    khung.push(
      veKhung({ w, h, modul, tiLe, sigma, nhieu, seed: 7 + i, goc: (r() * 2 - 1) * 2, dx: (r() * 2 - 1) * w * 0.01, dy: (r() * 2 - 1) * h * 0.01 })
    )
  }
  ghiY4m(tep, { w, h, khung })
  return tep
}
