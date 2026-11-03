/**
 * BÁO THỜI GIAN NẠP MÀN POS VỀ MÁY CHỦ — chủ nhà 03/11/2026: "em rà soát kỹ phần load đơn vào pos vẫn có hiện tượng chậm
 * hoặc báo lỗi quá 10s".
 *
 * Máy đo không tái hiện được (2,1–2,4 giây ở CPU ×4, không câu nào tự chậm) — chậm / quá 10 giây là do câu phải chờ máy chủ
 * hoặc mạng NGOÀI THỰC TẾ. Mỗi lần màn POS nạp xong một chứng từ (Xuất hàng, sửa hoá đơn, sửa đơn), gửi một dòng tóm tắt
 * về `/api/do-nap` → nhật ký Vercel (`[pos-nap]`): tổng thời gian, mở trang mất bao lâu, 6 câu lâu nhất (đường dẫn, cách
 * gọi, ms, kết quả — KHÔNG tham số, không dữ liệu), mạng của máy. Lần sau chậm là biết đúng câu nào, chờ bao lâu.
 */
import { luotMangTu, type LuotMang } from "@/lib/supabase/do-mang"

export type ManPos = "xuat-hang" | "sua-hd" | "sua-don"
/** Màn báo cáo cũng báo (chủ nhà 03/11/2026: "Kiểm tra lại tại sao phần báo cáo lại load lâu thế") — nhật ký `[bao-cao-nap]`. */
export type ManBaoCao = "bc-nhan-vien" | "bc-hang-ban-nv"
export type ManDo = ManPos | ManBaoCao

/** Màn bắt đầu nạp trong ngần này ms kể từ lúc mở trang mới coi là "màn đầu của lượt tải trang". Báo cáo thường mở bằng
 *  chuyển trang trong app (không tải lại) — tính từ lúc mở trang thì gộp cả lúc người dùng ngồi ở màn trước. */
export const MO_TRANG_MS = 15_000

export interface BaoNap {
  man: ManDo
  /** ms: từ lúc MỞ TRANG nếu là màn đầu của trang (POS mở tab mới), không thì từ lúc mở màn. */
  ms: number
  tuMoTrang: boolean
  loi: string | null
  dong: number
  /** Lượt mở trang: chờ HTML (ttfb) / dựng xong khung (dcl), ms. */
  trang: { ttfb: number; dcl: number } | null
  soCau: number
  /** Câu lâu nhất trước, tối đa 6. */
  cham: Array<Pick<LuotMang, "p" | "m" | "ms" | "tt">>
  /** Mạng theo trình duyệt (Chrome): loại, RTT ms, Mbps. */
  mang: { loai?: string; rtt?: number; mbps?: number } | null
}

/** Bản tóm tắt — tách riêng để kiểm thử (không đụng `window`). */
export function dungBaoNap(o: {
  man: ManDo
  batDau: number
  xong: number
  tuMoTrang: boolean
  loi?: string | null
  dong?: number
  luot: LuotMang[]
  trang?: { ttfb: number; dcl: number } | null
  mang?: BaoNap["mang"]
}): BaoNap {
  const luot = o.luot.filter((l) => l.bd >= o.batDau && l.bd <= o.xong)
  return {
    man: o.man,
    ms: Math.max(0, Math.round(o.xong - (o.tuMoTrang ? 0 : o.batDau))),
    tuMoTrang: o.tuMoTrang,
    loi: o.loi ? String(o.loi).slice(0, 300) : null,
    dong: o.dong ?? 0,
    trang: o.tuMoTrang ? o.trang ?? null : null,
    soCau: luot.length,
    cham: [...luot].sort((a, b) => b.ms - a.ms).slice(0, 6).map(({ p, m, ms, tt }) => ({ p, m, ms, tt })),
    mang: o.mang ?? null,
  }
}

let daBaoTrangNay = false

/** Chỉ cho kiểm thử. */
export function datLaiBaoNap() {
  daBaoTrangNay = false
}

/**
 * Gửi bản tóm tắt (không chặn, không ném). Gọi khi màn nạp xong / hỏng, sau lượt vẽ. Màn ĐẦU của trang tính từ lúc mở
 * trang (POS mở tab mới = tải cứng); màn sau (mở thêm tab trong POS) tính từ lúc mở màn.
 */
export function baoNapPos(man: ManDo, batDau: number, kq: { loi?: string | null; dong?: number }) {
  if (typeof window === "undefined" || typeof performance === "undefined") return
  try {
    // Màn đầu của LƯỢT TẢI TRANG (POS mở tab mới; báo cáo mở bằng dấu trang / F5) — chuyển trang trong app thì tính từ lúc mở màn.
    const tuMoTrang = !daBaoTrangNay && batDau < MO_TRANG_MS
    daBaoTrangNay = true
    const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined
    const net = (navigator as Navigator & { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection
    const bao = dungBaoNap({
      man,
      batDau: tuMoTrang ? 0 : batDau,
      xong: performance.now(),
      tuMoTrang,
      loi: kq.loi,
      dong: kq.dong,
      luot: luotMangTu(tuMoTrang ? 0 : batDau),
      trang: nav ? { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd) } : null,
      mang: net ? { loai: net.effectiveType, rtt: net.rtt, mbps: net.downlink } : null,
    })
    const than = JSON.stringify(bao)
    const ok = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/do-nap", new Blob([than], { type: "application/json" }))
    if (!ok) void fetch("/api/do-nap", { method: "POST", body: than, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {})
  } catch {
    /* báo đo hỏng thì thôi — không được làm hỏng màn */
  }
}

/** Gọi sau lượt vẽ kế tiếp (để thời gian gồm cả lúc dựng bảng hàng). */
export function baoNapSauKhiVe(man: ManDo, batDau: number, kq: { loi?: string | null; dong?: number }) {
  if (typeof window === "undefined") return
  const raf = window.requestAnimationFrame ?? ((f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 16))
  raf(() => setTimeout(() => baoNapPos(man, batDau, kq), 0))
}
