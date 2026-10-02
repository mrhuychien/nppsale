"use client"

/**
 * NẠP + LƯU một LƯỢT SOẠN HÀNG (mig 225) — dùng chung cho màn máy tính và điện thoại.
 *
 * Chủ nhà 02/10/2026 chốt "Lưu trên máy chủ": tiến độ nhặt / chia ghi qua RPC `cap_nhat_luot_soan` (gộp từng
 * khoá — hai máy bấm hai mặt hàng khác nhau không đè nhau), đọc lại khi quay về màn / mỗi 20 giây.
 * Lượt được TẠO lúc bắt đầu nhặt (không tạo khi mới tích chọn hoá đơn, kẻo đầy lượt bỏ dở).
 * Sổ chưa chạy mig 225 → tiến độ chỉ giữ trên máy này (báo rõ), màn vẫn chạy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { ProductUnits } from "@/lib/orders/pick-list"
import {
  TIEN_DO_RONG, docTienDo, dungDongNhat, loiLuotSoan, TOI_DA_RO,
  type DongHdSoan, type HdSoan, type TienDo,
} from "@/lib/orders/luot-soan"
import { cotHoaDonSoan, LOC_SOAN_MAC_DINH, thieuCotSoan } from "@/lib/orders/soan-hang-loc"

export interface HoaDonSoan {
  id: string
  invoice_code: string
  invoice_date: string | null
  status: string
  total: number | null
  sales_user_id?: string | null
  soan_luc?: string | null
  soan_boi?: string | null
  customer?: { store_name?: string | null; phone?: string | null; channel?: string | null } | null
  order?: { order_code?: string | null } | null
}

export interface LuotSoanRow {
  id: string
  ma: string
  invoice_ids: string[]
  trang_thai: string
  tien_do: unknown
  created_at: string
  created_by?: string | null
  updated_at?: string
}

interface DongTho {
  invoice_id: string
  product_id: string
  unit_name: string
  quantity: number
  conversion_factor: number | null
  is_exchange: boolean | null
  product?: ({ name?: string | null; sku?: string | null; shelf_location?: string | null; primary_supplier_id?: string | null } & ProductUnits) | null
}

const COT_DONG =
  "invoice_id, product_id, unit_name, quantity, conversion_factor, is_exchange, product:products(name, sku, base_unit, shelf_location, primary_supplier_id, units:product_units(unit_name, conversion))"
const COT_LUOT = "id, ma, invoice_ids, trang_thai, tien_do, created_at, created_by, updated_at"

export function useLuotSoan(orgReady: boolean, tenTuyen: (channel: string | null | undefined) => string) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()

  const [coLuot, setCoLuot] = useState(true)
  const [dsLuot, setDsLuot] = useState<LuotSoanRow[]>([])
  const [luot, setLuot] = useState<LuotSoanRow | null>(null)
  const [chon, setChon] = useState<HoaDonSoan[]>([])
  const [dongTho, setDongTho] = useState<DongTho[]>([])
  const [ncc, setNcc] = useState<Map<string, string>>(new Map())
  const [tienDo, setTienDo] = useState<TienDo>(TIEN_DO_RONG)
  const [choDong, setChoDong] = useState(0)
  const [loiDong, setLoiDong] = useState<string | null>(null)
  const [dangGhi, setDangGhi] = useState(false)
  const daDoc = useRef<Set<string>>(new Set())
  const taoRef = useRef<Promise<string | null> | null>(null)
  const luotRef = useRef<LuotSoanRow | null>(null)
  luotRef.current = luot

  /* ---- nhà cung cấp (tên nhóm "Theo nhà cung cấp") ---- */
  useEffect(() => {
    if (!orgReady) return
    supabase.from("suppliers").select("id, name").then(({ data, error }) => {
      if (error) console.error("[soan-hang] đọc NCC lỗi:", error.message)
      setNcc(new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name])))
    })
  }, [orgReady, supabase])

  /* ---- lượt đang soạn ---- */
  const docDsLuot = useCallback(async () => {
    const { data, error } = await supabase.from("luot_soan").select(COT_LUOT).eq("trang_thai", "dang_soan").order("created_at", { ascending: false }).limit(30)
    if (error) {
      if (/luot_soan/.test(error.message)) setCoLuot(false)
      else console.error("[soan-hang] đọc lượt soạn lỗi:", error.message)
      return
    }
    setDsLuot((data as LuotSoanRow[]) ?? [])
  }, [supabase])
  useEffect(() => {
    if (orgReady) void docDsLuot()
  }, [orgReady, docDsLuot])

  /* ---- hoá đơn theo id (giữ thứ tự = rổ) ---- */
  const docHoaDon = useCallback(async (ids: string[]): Promise<HoaDonSoan[]> => {
    if (!ids.length) return []
    const doc = (co: boolean) => supabase.from("sales_invoices").select(cotHoaDonSoan(LOC_SOAN_MAC_DINH, co)).in("id", ids)
    let { data, error } = await doc(true)
    if (error && thieuCotSoan(error.message)) ({ data, error } = await doc(false))
    if (error) console.error("[soan-hang] đọc hóa đơn lỗi:", error.message)
    const theoId = new Map(((data as unknown as HoaDonSoan[]) ?? []).map((d) => [d.id, d]))
    return ids.map((id) => theoId.get(id)).filter((d): d is HoaDonSoan => !!d)
  }, [supabase])

  const apLuot = useCallback((r: LuotSoanRow) => {
    setLuot(r)
    setTienDo(docTienDo(r.tien_do))
  }, [])

  /** Mở một lượt đang soạn (từ danh sách / đường dẫn `?luot=`). */
  const moLuot = useCallback(async (id: string) => {
    const { data, error } = await supabase.from("luot_soan").select(COT_LUOT).eq("id", id).maybeSingle()
    if (error || !data) {
      toast({ title: "Không mở được lượt soạn", description: error ? loiLuotSoan(error.message) : "Lượt không còn", variant: "destructive" })
      return false
    }
    const r = data as LuotSoanRow
    apLuot(r)
    setChon(await docHoaDon(r.invoice_ids ?? []))
    return true
  }, [supabase, toast, apLuot, docHoaDon])

  /** Bỏ lượt đang mở khỏi màn (không huỷ trên máy chủ) — về chọn hoá đơn cho lượt mới. */
  const dongLuot = useCallback(() => {
    setLuot(null)
    setChon([])
    setDongTho([])
    daDoc.current = new Set()
    setTienDo(TIEN_DO_RONG)
    taoRef.current = null
  }, [])

  /* ---- dòng hoá đơn của hoá đơn mới chọn ---- */
  const ids = chon.map((d) => d.id)
  const khoa = ids.join(",")
  useEffect(() => {
    const can = ids.filter((id) => !daDoc.current.has(id))
    if (!can.length) return
    for (const id of can) daDoc.current.add(id)
    setChoDong((n) => n + 1)
    supabase.from("sales_invoice_lines").select(COT_DONG).in("invoice_id", can).then(({ data, error }) => {
      if (error) {
        setLoiDong(error.message)
        for (const id of can) daDoc.current.delete(id)
      } else {
        setLoiDong(null)
        setDongTho((s) => [...s.filter((l) => !can.includes(l.invoice_id)), ...((data as unknown as DongTho[]) ?? [])])
      }
      setChoDong((n) => n - 1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoa, supabase])

  /* ---- lượt đã có: đổi danh sách hoá đơn thì ghi lên máy chủ ---- */
  useEffect(() => {
    const l = luotRef.current
    if (!l || !coLuot || l.invoice_ids.join(",") === khoa) return
    supabase.rpc("cap_nhat_luot_soan", { p_id: l.id, p_invoice_ids: ids }).then(({ data, error }) => {
      if (error) toast({ title: "Chưa lưu được danh sách hoá đơn", description: loiLuotSoan(error.message), variant: "destructive" })
      else if (data) apLuot(data as LuotSoanRow)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoa])

  /* ---- đọc lại lượt (máy khác vừa nhặt / chia) ---- */
  const docLai = useCallback(async () => {
    const l = luotRef.current
    if (!l || !coLuot) return
    const { data } = await supabase.from("luot_soan").select(COT_LUOT).eq("id", l.id).maybeSingle()
    const r = data as LuotSoanRow | null
    if (!r || r.updated_at === luotRef.current?.updated_at) return
    if (r.trang_thai !== "dang_soan") {
      toast({ title: `Lượt ${r.ma} đã ${r.trang_thai === "xong" ? "hoàn tất" : "huỷ"} ở máy khác` })
      dongLuot()
      void docDsLuot()
      return
    }
    apLuot(r)
    if (r.invoice_ids.join(",") !== luotRef.current?.invoice_ids.join(",")) setChon(await docHoaDon(r.invoice_ids))
  }, [supabase, coLuot, toast, apLuot, docHoaDon, dongLuot, docDsLuot])
  useEffect(() => {
    if (!luot?.id) return
    const t = setInterval(() => document.visibilityState === "visible" && void docLai(), 20_000)
    const f = () => void docLai()
    window.addEventListener("focus", f)
    return () => {
      clearInterval(t)
      window.removeEventListener("focus", f)
    }
  }, [luot?.id, docLai])

  /** Tạo lượt (một lần) cho danh sách đang chọn. */
  const damBaoLuot = useCallback(async (): Promise<string | null> => {
    if (luotRef.current) return luotRef.current.id
    if (!coLuot || !ids.length) return null
    if (!taoRef.current) {
      taoRef.current = (async () => {
        const { data, error } = await supabase.rpc("tao_luot_soan", { p_invoice_ids: ids })
        if (error) {
          if (/tao_luot_soan/.test(error.message)) setCoLuot(false)
          else toast({ title: "Không tạo được lượt soạn", description: loiLuotSoan(error.message), variant: "destructive" })
          taoRef.current = null
          return null
        }
        const id = data as string
        const { data: r } = await supabase.from("luot_soan").select(COT_LUOT).eq("id", id).maybeSingle()
        if (r) apLuot(r as LuotSoanRow)
        void docDsLuot()
        return id
      })()
    }
    return taoRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coLuot, khoa, supabase, toast, apLuot, docDsLuot])

  /** Ghi tiến độ: cập nhật ngay trên màn, rồi gộp lên máy chủ (null = xoá khoá). */
  const ghi = useCallback(async (p: { nhat?: Record<string, number | null>; chia?: Record<string, boolean | null> }) => {
    setTienDo((t) => {
      const nhat = { ...t.nhat }
      const chia = { ...t.chia }
      for (const [k, v] of Object.entries(p.nhat ?? {})) if (v === null) delete nhat[k]; else nhat[k] = v
      for (const [k, v] of Object.entries(p.chia ?? {})) if (!v) delete chia[k]; else chia[k] = true
      return { nhat, chia }
    })
    const id = await damBaoLuot()
    if (!id) return
    const { data, error } = await supabase.rpc("cap_nhat_luot_soan", {
      p_id: id,
      p_nhat: p.nhat ?? null,
      p_chia: p.chia ? Object.fromEntries(Object.entries(p.chia).map(([k, v]) => [k, v ? true : null])) : null,
    })
    if (error) {
      toast({ title: "Chưa lưu được tiến độ", description: loiLuotSoan(error.message), variant: "destructive" })
      void docLai()
      return
    }
    if (data) apLuot(data as LuotSoanRow)
  }, [damBaoLuot, supabase, toast, apLuot, docLai])

  /** Hoàn tất: đóng lượt + đánh dấu hoá đơn đã soạn (không trừ kho). */
  const hoanTat = useCallback(async (): Promise<boolean> => {
    setDangGhi(true)
    try {
      const id = await damBaoLuot()
      if (!id) {
        // Sổ chưa có lượt (mig 225): vẫn đánh dấu đã soạn bằng RPC mig 224.
        const { error } = await supabase.rpc("danh_dau_soan_hang", { p_ids: ids, p_da: true })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc("hoan_tat_luot_soan", { p_id: id })
        if (error) throw error
      }
      toast({ title: `Đã hoàn tất soạn ${ids.length} hóa đơn` })
      dongLuot()
      void docDsLuot()
      return true
    } catch (e) {
      toast({ title: "Chưa hoàn tất được", description: loiLuotSoan((e as { message?: string })?.message), variant: "destructive" })
      return false
    } finally {
      setDangGhi(false)
    }
  }, [damBaoLuot, supabase, ids, toast, dongLuot, docDsLuot])

  const huy = useCallback(async () => {
    const l = luotRef.current
    if (!l) return dongLuot()
    const { error } = await supabase.rpc("huy_luot_soan", { p_id: l.id })
    if (error) return toast({ title: "Không huỷ được lượt", description: loiLuotSoan(error.message), variant: "destructive" })
    toast({ title: `Đã huỷ lượt ${l.ma}` })
    dongLuot()
    void docDsLuot()
  }, [supabase, toast, dongLuot, docDsLuot])

  /* ---- chọn hoá đơn ---- */
  const them = useCallback((d: HoaDonSoan | HoaDonSoan[]) => {
    const ds = Array.isArray(d) ? d : [d]
    setChon((s) => {
      const out = [...s]
      for (const x of ds) if (!out.some((y) => y.id === x.id) && out.length < TOI_DA_RO) out.push(x)
      return out
    })
  }, [])
  const bo = useCallback((id: string) => {
    setChon((s) => s.filter((x) => x.id !== id))
    setDongTho((s) => s.filter((l) => l.invoice_id !== id))
    daDoc.current.delete(id)
  }, [])
  const boHet = useCallback(() => {
    setChon([])
    setDongTho([])
    daDoc.current = new Set()
  }, [])

  /* ---- dòng nhặt ---- */
  const hd: HdSoan[] = useMemo(
    () => chon.map((d) => ({ id: d.id, ma: d.invoice_code, khach: d.customer?.store_name || "Khách lẻ", tuyen: tenTuyen(d.customer?.channel), tong: Number(d.total) || 0 })),
    [chon, tenTuyen]
  )
  const rows = useMemo(() => {
    const sp: Record<string, ProductUnits> = {}
    const ds: DongHdSoan[] = dongTho.map((l) => {
      if (l.product) sp[l.product_id] = { base_unit: l.product.base_unit, units: l.product.units }
      return {
        invoiceId: l.invoice_id, productId: l.product_id, ten: l.product?.name || "Sản phẩm đã xoá", sku: l.product?.sku ?? null,
        viTri: l.product?.shelf_location ?? null, ncc: (l.product?.primary_supplier_id && ncc.get(l.product.primary_supplier_id)) || null,
        donVi: l.unit_name, heSo: Number(l.conversion_factor) || 1, sl: Number(l.quantity) || 0, doi: l.is_exchange === true,
      }
    })
    return dungDongNhat(hd, ds, sp)
  }, [dongTho, hd, ncc])
  const soMatCuaHd = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) for (const p of r.phan) m.set(p.invoiceId, (m.get(p.invoiceId) ?? 0) + 1)
    return m
  }, [rows])

  return {
    coLuot, dsLuot, luot, moLuot, dongLuot, docDsLuot, huy, hoanTat, dangGhi,
    chon, them, bo, boHet, hd, rows, soMatCuaHd, dangNapDong: choDong > 0, loiDong,
    tienDo, ghi, damBaoLuot,
  }
}

export type LuotSoan = ReturnType<typeof useLuotSoan>
