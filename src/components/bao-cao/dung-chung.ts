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
import { downloadXlsx } from "@/components/analytics/report-frame"

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
 */
export function useNap<T>(chay: (() => Promise<T>) | null, khoa: string): Nap<T> {
  const [data, setData] = useState<T | null>(null)
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
        setData(x)
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
    setLan((n) => n + 1)
  }, [])
  return { data, loi, dangTai, capNhat, taiLai }
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

const theoTen = (a: readonly [string, string], b: readonly [string, string]) => a[1].localeCompare(b[1], "vi")
const giaTriRieng = (xs: Iterable<string>): [string, string][] =>
  Array.from(new Set(Array.from(xs).map((x) => x || CHUA_CO))).map((x): [string, string] => [x, x]).sort(theoTen)

/** Lựa chọn của từng loại lọc, dựng từ danh mục. */
export function luaChonLoc(dm: DanhMucBC | null, k: LoaiLoc): [string, string][] {
  if (!dm) return []
  switch (k) {
    case "cust":
      return Array.from(dm.khach.entries()).map(([id, c]): [string, string] => [id, c.ten]).sort(theoTen)
    case "cgroup":
      return [...Array.from(dm.nhomKhach.entries()).map(([id, t]): [string, string] => [id, t]).sort(theoTen), [CHUA_CO, CHUA_CO]]
    case "channel":
      return giaTriRieng(Array.from(dm.khach.values()).map((c) => c.kenh))
    case "province":
      return giaTriRieng(Array.from(dm.khach.values()).map((c) => c.tinh))
    case "staff":
    case "creator":
      return Array.from(dm.nv.entries()).map(([id, t]): [string, string] => [id, t]).sort(theoTen)
    case "prod":
      return Array.from(dm.sp.entries()).map(([id, s]): [string, string] => [id, s.sku ? `${s.ten} · ${s.sku}` : s.ten]).sort(theoTen)
    case "pgroup":
      return giaTriRieng(Array.from(dm.sp.values()).map((s) => s.nhom))
    case "brand":
      return giaTriRieng(Array.from(dm.sp.values()).map((s) => s.thuongHieu))
    case "ncc":
      return [...Array.from(dm.ncc.entries()).map(([id, t]): [string, string] => [id, t]).sort(theoTen), [CHUA_CO, CHUA_CO]]
    case "ostatus":
      return ["Nháp", "Phiếu tạm", "Hoàn thành", "Đã đóng"].map((x): [string, string] => [x, x])
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
    case "cgroup":
      return (v && dm?.nhomKhach.get(v)) || CHUA_CO
    case "ncc":
      return (v && dm?.ncc.get(v)) || CHUA_CO
    default:
      return v || CHUA_CO
  }
}

/** Xuất Excel đúng thứ đang thấy (spec 2.2). */
export function xuatExcel(ten: string, rows: (string | number)[][] | null | undefined) {
  if (!rows || rows.length === 0) return
  const file = ten.replace(/[\\/:*?"<>|·]+/g, "-").replace(/\s+/g, " ").trim()
  void downloadXlsx(file, rows, "Bao cao")
}
