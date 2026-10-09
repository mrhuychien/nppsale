"use client"

/**
 * Dùng chung cho các màn Báo cáo tổng hợp: nạp số có trạng thái (đang tải / lỗi / giờ cập nhật),
 * danh mục có bộ nhớ đệm, danh sách lựa chọn của ô lọc, xuất Excel.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { napDanhMuc, type KetQuaDanhMuc } from "@/lib/bao-cao/nap-danh-muc"
import { CHUA_CO, type DanhMucBC, type LoaiLoc } from "@/lib/bao-cao/cong"
import { downloadXlsxSheets } from "@/components/analytics/report-frame"
import type { SheetXuat } from "@/lib/bao-cao/xuat-chi-tiet"

const gioPhut = () => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())

export interface Nap<T> {
  data: T | null
  loi: string | null
  dangTai: boolean
  capNhat: string
  taiLai: () => void
}

/**
 * Nạp số theo `khoa`. Đổi khoá → nạp lại; lượt cũ về muộn thì bỏ (không đè số mới).
 * ⚠ Lỗi thì GIỮ lỗi, không trả số 0 (spec 2.9: "Không hiện số 0 thay cho lỗi").
 * ⚠ SỐ CỦA KHOÁ CŨ KHÔNG TRẢ RA: đổi kỳ (khoá đổi) thì `data` = null tới khi số của kỳ mới về — màn hiện khung chờ.
 *   Bản cũ giữ số kỳ cũ rồi màn cộng lại theo kỳ mới: chuyển Tháng này → Năm nay, vài giây đầu thẻ chỉ cộng 2 tháng
 *   đã nạp, bấm Xuất lúc ấy ra file sai (rà báo cáo 09/10/2026). Tải lại (↻, cùng khoá) thì vẫn giữ số đang xem.
 */
export function useNap<T>(chay: (() => Promise<T>) | null, khoa: string): Nap<T> {
  const [kq, setKq] = useState<{ khoa: string; data: T } | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [capNhat, setCapNhat] = useState("")
  const [lan, setLan] = useState(0)
  const chayRef = useRef(chay)
  chayRef.current = chay
  const coChay = chay !== null
  useEffect(() => {
    const f = chayRef.current
    if (!f) return
    let huy = false
    setDangTai(true)
    setLoi(null)
    f()
      .then((x) => {
        if (huy) return
        setKq({ khoa, data: x })
        setCapNhat(gioPhut())
      })
      .catch((e) => {
        if (huy) return
        console.error("[bao-cao] đọc số hỏng:", e)
        setLoi(errorMessage(e))
      })
      .finally(() => !huy && setDangTai(false))
    return () => {
      huy = true
    }
  }, [khoa, lan, coChay])
  const taiLai = useCallback(() => {
    boNhoDanhMuc.clear()
    boNhoTam.clear()
    setLan((n) => n + 1)
  }, [])
  return { data: kq && kq.khoa === khoa ? kq.data : null, loi, dangTai, capNhat, taiLai }
}

const boNhoDanhMuc = new Map<string, { luc: number; p: Promise<KetQuaDanhMuc> }>()

/** Danh mục của NPP — đọc một lần, giữ 5 phút cho mọi màn. */
export function layDanhMuc(orgId: string): Promise<KetQuaDanhMuc> {
  const c = boNhoDanhMuc.get(orgId)
  if (c && Date.now() - c.luc < 5 * 60_000) return c.p
  const p = napDanhMuc(createClient(), orgId)
  p.catch(() => boNhoDanhMuc.delete(orgId))
  boNhoDanhMuc.set(orgId, { luc: Date.now(), p })
  return p
}

/**
 * NHỚ TẠM một lượt đọc số trong `NHO_TAM_MS` — chủ nhà 27/09/2026 "rà cách đọc dữ liệu cho nhanh
 * hơn". Tổng quan, Bán hàng, Cuối ngày, Kho, Công nợ đọc chung một số bộ số (số bán của cùng kỳ,
 * công nợ hôm nay, tồn kho hôm nay): chuyển màn trong 1 phút thì dùng lại, không đọc lại từ đầu.
 * Nút tải lại (↻) xoá bộ nhớ này. Lượt đọc hỏng thì bỏ khỏi bộ nhớ ngay (lần sau đọc lại).
 */
export const NHO_TAM_MS = 60_000
const boNhoTam = new Map<string, { luc: number; p: Promise<unknown> }>()
export function nhoTam<T>(khoa: string, doc: () => Promise<T>): Promise<T> {
  const c = boNhoTam.get(khoa)
  if (c && Date.now() - c.luc < NHO_TAM_MS) return c.p as Promise<T>
  const p = doc()
  p.catch(() => boNhoTam.get(khoa)?.p === p && boNhoTam.delete(khoa))
  boNhoTam.set(khoa, { luc: Date.now(), p })
  return p
}

const theoTen = (a: readonly [string, string], b: readonly [string, string]) => a[1].localeCompare(b[1], "vi")
const giaTriRieng = (xs: Iterable<string>): [string, string][] =>
  Array.from(new Set(Array.from(xs).map((x) => x || CHUA_CO))).map((x): [string, string] => [x, x]).sort(theoTen)

/** Lựa chọn của từng loại lọc, dựng từ danh mục. */
export function luaChonLoc(dm: DanhMucBC | null, k: LoaiLoc): [string, string][] {
  if (!dm) return []
  switch (k) {
    case "cust":
      return Array.from(dm.khach.entries()).map(([id, c]): [string, string] => [id, c.ten]).sort(theoTen)
    case "channel":
      return giaTriRieng(Array.from(dm.khach.values()).map((c) => c.kenh))
    case "staff":
    case "creator":
      return Array.from(dm.nv.entries()).map(([id, t]): [string, string] => [id, t]).sort(theoTen)
    case "prod":
      return Array.from(dm.sp.entries()).map(([id, s]): [string, string] => [id, s.sku ? `${s.ten} · ${s.sku}` : s.ten]).sort(theoTen)
    case "ncc":
      return [...Array.from(dm.ncc.entries()).map(([id, t]): [string, string] => [id, t]).sort(theoTen), [CHUA_CO, CHUA_CO]]
    case "ostatus":
      /* (mig 217) không còn "Đã đóng" */
      return ["Nháp", "Phiếu tạm", "Hoàn thành"].map((x): [string, string] => [x, x])
    case "pay":
      return [["Tiền mặt", "Tiền mặt"], ["Chuyển khoản", "Chuyển khoản"], ["Ví điện tử", "Ví điện tử"]]
    case "dstatus":
      return ["Quá hạn", "Vượt hạn mức", "Dư có"].map((x): [string, string] => [x, x])
    default:
      return []
  }
}

/** Tên hiển thị của một giá trị chiều (id → tên). */
export function tenGiaTri(dm: DanhMucBC | null, k: LoaiLoc, v: string): string {
  switch (k) {
    case "cust":
      return (v && dm?.khach.get(v)?.ten) || "Khách đã xoá"
    case "staff":
    case "creator":
      return (v && dm?.nv.get(v)) || "Chưa gán nhân viên"
    case "prod":
      return (v && dm?.sp.get(v)?.ten) || "Không rõ mặt hàng"
    case "ncc":
      return (v && dm?.ncc.get(v)) || CHUA_CO
    default:
      return v || CHUA_CO
  }
}

/**
 * Xuất Excel: sheet "Tổng hợp" đúng thứ đang thấy (spec 2.2) + các sheet chi tiết (`them`, vd "Chi tiết dòng"
 * — chủ nhà 02/10/2026 "xuất chi tiết các dòng hơn để xử lý thông tin").
 */
export function xuatExcel(ten: string, rows: (string | number)[][] | null | undefined, them: SheetXuat[] = []) {
  const sheets = [...(rows && rows.length ? [{ ten: "Tổng hợp", rows }] : []), ...them.filter((x) => x.rows.length > 1)]
  if (!sheets.length) return
  const file = ten.replace(/[\\/:*?"<>|·]+/g, "-").replace(/\s+/g, " ").trim()
  void downloadXlsxSheets(file, sheets)
}
