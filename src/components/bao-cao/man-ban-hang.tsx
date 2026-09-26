"use client"

/**
 * MÀN 2 — BÁN HÀNG (`/bao-cao/ban-hang`). Spec mục 4, thiết kế 26/09/2026.
 * "Bán được gì, cho ai, ai bán, đơn đặt ra sao?"
 * - Nguồn [Hoá đơn] (doanh thu thật) · [Đơn đặt] (số hoạt động — băng hổ phách).
 * - Xem theo: Thời gian · Mặt hàng · Nhóm hàng · Thương hiệu · Khách · Nhóm khách · Kênh · Tỉnh ·
 *   Nhân viên. Bấm dòng / cột / thanh = đào sâu; điểm cuối là chứng từ.
 * - NVBH: lọc nhân viên khoá vào chính mình, không có chế độ Nhân viên, không có cột lãi.
 */
import { useMemo, useRef, useState } from "react"
import { useBaoCao } from "@/hooks/use-bao-cao"
import { KhungBaoCao, type MatDao } from "./khung"
import { ThanhLoc } from "./thanh-loc"
import { HangKpi, HangChon, CongTacDoan, BangHoPhach, KhoiGap, DangTai, KhongCoSo, LoiDocSo, ChuaDu, type TheKpi } from "./khoi"
import { BieuDoCot, BieuDoNgang, type CotBD } from "./bieu-do"
import { BangBaoCao, type CotBang, type DongBang } from "./bang"
import { XemNhanhChungTu, type ChungTuMo } from "./xem-nhanh"
import { useNap, layDanhMuc, luaChonLoc, tenGiaTri, xuatExcel } from "./dung-chung"
import { createClient } from "@/lib/supabase/client"
import { kyTheoMa, congNgay, soNgay, doHat, chiaThoiGian, khoaThoiGian, nhanKhoang, tenKy, type Ky } from "@/lib/bao-cao/ky"
import { hieuLuc, MAC_DINH_MAN, type BuocDao } from "@/lib/bao-cao/trang-thai"
import { congBan, gomBan, congDat, gomDat, quaLoc, hienSoLuong, CHUA_CO, type DanhMucBC, type DongBan, type DongDat, type LoaiLoc, type NhomBan, type NhomDat } from "@/lib/bao-cao/cong"
import { soGon, phanTram, soSanh, duongXuHuong, soDu } from "@/lib/bao-cao/so"
import { napSoBan } from "@/lib/bao-cao/nap-ban-hang"
import { napDonDat } from "@/lib/bao-cao/nap-don-dat"
import { loadDebtByCustomer } from "@/lib/sell/debt"
import { GIAI_THICH } from "@/lib/bao-cao/giai-thich"

type Xem = "time" | "prod" | "pgroup" | "brand" | "cust" | "cgroup" | "channel" | "province" | "staff" | "docs"

const CHIEU: Record<Exclude<Xem, "docs">, { label: string; loc?: LoaiLoc; tiep: Xem }> = {
  time: { label: "Thời gian", tiep: "cust" },
  prod: { label: "Mặt hàng", loc: "prod", tiep: "cust" },
  pgroup: { label: "Nhóm hàng", loc: "pgroup", tiep: "prod" },
  brand: { label: "Thương hiệu", loc: "brand", tiep: "prod" },
  cust: { label: "Khách", loc: "cust", tiep: "prod" },
  cgroup: { label: "Nhóm khách", loc: "cgroup", tiep: "cust" },
  channel: { label: "Kênh", loc: "channel", tiep: "cust" },
  province: { label: "Tỉnh", loc: "province", tiep: "cust" },
  staff: { label: "Nhân viên", loc: "staff", tiep: "cust" },
}
const DS_XEM = Object.keys(CHIEU) as Exclude<Xem, "docs">[]

function khoaChieu(xem: Exclude<Xem, "docs" | "time">, dm: DanhMucBC) {
  return (l: { kh: string; nv: string; sp: string }) => {
    switch (xem) {
      case "prod": return l.sp
      case "cust": return l.kh
      case "staff": return l.nv
      case "pgroup": return dm.sp.get(l.sp)?.nhom || CHUA_CO
      case "brand": return dm.sp.get(l.sp)?.thuongHieu || CHUA_CO
      case "cgroup": return dm.khach.get(l.kh)?.nhom || CHUA_CO
      case "channel": return dm.khach.get(l.kh)?.kenh || CHUA_CO
      case "province": return dm.khach.get(l.kh)?.tinh || CHUA_CO
    }
  }
}

function tenDong(xem: Exclude<Xem, "docs" | "time">, k: string, dm: DanhMucBC): { n: string; s: string } {
  if (xem === "prod") {
    const p = dm.sp.get(k)
    return { n: p?.ten || "Không rõ mặt hàng", s: [p?.sku, p?.nhom].filter(Boolean).join(" · ") }
  }
  if (xem === "cust") {
    const c = dm.khach.get(k)
    return { n: c?.ten || "Khách đã xoá", s: [c?.kenh, c?.tinh].filter(Boolean).join(" · ") }
  }
  if (xem === "staff") return { n: dm.nv.get(k) || "Chưa gán nhân viên", s: "" }
  if (xem === "cgroup") return { n: dm.nhomKhach.get(k) || CHUA_CO, s: "" }
  return { n: k || CHUA_CO, s: "" }
}

interface DuLieu {
  dm: DanhMucBC
  ban: DongBan[]
  dat: DongDat[]
  hoaDon: Awaited<ReturnType<typeof napSoBan>>["hoaDon"]
  phieuTra: Awaited<ReturnType<typeof napSoBan>>["phieuTra"]
  don: Awaited<ReturnType<typeof napDonDat>>["don"]
  no: Record<string, number> | null
  thieu: boolean
}

type NhomBC = DongBang & Partial<NhomBan> & Partial<NhomDat> & { k?: string; r?: [string, string] }

export function ManBanHang() {
  const bc = useBaoCao("reports", MAC_DINH_MAN["/bao-cao/ban-hang"])
  const { st, dat, daoThem, veBuoc, doiXem, homNay, khoaNV, xemGiaVon, orgId } = bc
  const nguon = st.nguon
  const E = hieuLuc(st, st.xem || "time", khoaNV)
  const ky: Ky = kyTheoMa(st.ky, homNay, st.ca, st.cb)
  const [a, b] = E.khoang || [ky.a, ky.b]
  const len = soNgay(a, b) + 1
  const cmp = E.khoang ? ([congNgay(a, -len), congNgay(a, -1)] as const) : ky.cmp
  const tu = cmp && st.soSanh ? cmp[0] : a

  const nap = useNap<DuLieu>(
    orgId
      ? async () => {
          const sb = createClient()
          const { dm, thieu } = await layDanhMuc(orgId)
          const [sb1, sd, no] = await Promise.all([
            nguon === "inv" ? napSoBan(sb, orgId, tu, b, dm) : null,
            nguon === "ord" ? napDonDat(sb, orgId, tu, b) : null,
            nguon === "inv" ? loadDebtByCustomer().catch(() => null) : null,
          ])
          return {
            dm,
            ban: sb1?.dong || [],
            hoaDon: sb1?.hoaDon || new Map(),
            phieuTra: sb1?.phieuTra || [],
            dat: sd?.dong || [],
            don: sd?.don || new Map(),
            no,
            thieu: thieu || !!sb1?.thieu || !!sd?.thieu,
          }
        }
      : null,
    `${orgId}|${nguon}|${tu}|${b}`
  )
  const dm = nap.data?.dm || null
  const [ct, setCt] = useState<ChungTuMo | null>(null)
  const [batThem, setBatThem] = useState<string[]>([])
  const xuatRef = useRef<(() => (string | number)[][]) | null>(null)

  const view = (E.xem as Xem) || "time"
  const coChieu = (x: string): x is Exclude<Xem, "docs"> => x in CHIEU
  const cacXem = DS_XEM.filter((v) => !(khoaNV && v === "staff"))

  const vm = useMemo(() => {
    if (!nap.data || !dm) return null
    const d = nap.data
    const trong = <T extends { ngay: string }>(x: T, p: string, q: string) => x.ngay >= p && x.ngay <= q
    const loc = E.loc
    const qua = (x: { kh: string; nv: string; sp: string; trangThai?: string; nguoiTao?: string }) => quaLoc(x, loc, dm)
    const g = doHat(a, b)
    const dsThoiGian = chiaThoiGian(a, b, g)
    const onDong = (x: NhomBC) => () => {
      if (view === "time") daoThem({ l: x._n, v: CHIEU.time.tiep, f: { range: x.r! } })
      else if (coChieu(view)) {
        const c = CHIEU[view]
        const locTiep = c.tiep !== "time" && c.tiep !== "docs" ? CHIEU[c.tiep].loc : undefined
        const tiep = locTiep && loc[locTiep]?.length === 1 ? "docs" : c.tiep
        daoThem({ l: x._n, v: tiep, f: { [c.loc!]: x.k! } })
      }
    }
    if (nguon === "inv") {
      const cur = d.ban.filter((l) => trong(l, a, b) && qua(l))
      const prev = cmp && st.soSanh ? d.ban.filter((l) => trong(l, cmp[0], cmp[1]) && qua(l)) : null
      const T = congBan(cur)
      const TP = prev ? congBan(prev) : null
      const theoNgay = (f: (l: DongBan) => number) => {
        const v = new Array(len).fill(0)
        for (const l of cur) v[soNgay(a, l.ngay)] += f(l)
        return duongXuHuong(v)
      }
      const kpis: TheKpi[] = [
        { id: "net", label: "Doanh thu thuần", value: soGon(T.net), info: GIAI_THICH.net, delta: soSanh(T.net, TP?.net, true), spark: theoNgay((l) => (l.loai > 0 ? l.tien : -l.tien)), onClick: () => doiXem("time") },
        { id: "ret", label: "Hàng trả", value: soGon(T.ret), info: GIAI_THICH.ret, delta: soSanh(T.ret, TP?.ret, false), spark: theoNgay((l) => (l.loai < 0 ? l.tien : 0)), onClick: () => doiXem("time") },
        ...(xemGiaVon
          ? [{ id: "gp", label: "Lãi gộp", value: soGon(T.gp), info: GIAI_THICH.gp, sub: `Biên ${phanTram(T.net ? T.gp / T.net : 0)}`, delta: soSanh(T.gp, TP?.gp, true), spark: theoNgay((l) => l.loai * (l.tien - l.giaVon)), onClick: () => (setBatThem(["gp", "margin"]), doiXem("time")) } satisfies TheKpi]
          : []),
        { id: "nInv", label: "Số hoá đơn", value: soDu(T.nInv), info: GIAI_THICH.nInv, delta: soSanh(T.nInv, TP?.nInv, true), onClick: () => daoThem({ l: "Hoá đơn", v: "docs" }) },
        { id: "avg", label: "TB / hoá đơn", value: soGon(T.avg), info: GIAI_THICH.avg, delta: soSanh(T.avg, TP?.avg, true), onClick: () => (setBatThem(["avg"]), doiXem("time")) },
      ]
      let bang: React.ReactNode = null
      let bieuDo: React.ReactNode = null
      let tenXuat = ""
      if (view === "docs") {
        const m = new Map<string, number>()
        for (const l of cur) if (l.loai > 0) m.set(l.hd, (m.get(l.hd) || 0) + l.tien)
        const ds = Array.from(m.entries()).map(([id, tien]) => {
          const h = d.hoaDon.get(id)!
          return { _n: h.ma, _sub: tenGiaTri(dm, "cust", h.kh), id, ngay: h.ngay, nv: tenGiaTri(dm, "staff", h.nv), tien, _s: h.ngay }
        })
        type D = (typeof ds)[number]
        const cot: CotBang<D>[] = [
          { k: "ngay", label: "Ngày", f: "date", v: (x) => x.ngay },
          { k: "nv", label: "Nhân viên", f: "text", v: (x) => x.nv },
          { k: "tien", label: "DT thuần", f: "money", v: (x) => x.tien, bold: true },
        ]
        tenXuat = "Hoá đơn"
        bang = (
          <BangBaoCao<D>
            khoa={`ban:docs:inv`}
            tieuDe="Hoá đơn"
            phu={`${ds.length} chứng từ`}
            cotDau="Chứng từ"
            cot={cot}
            dong={ds}
            tong={{ _n: "Tổng", tien: ds.reduce((s, x) => s + x.tien, 0) } as D}
            sapMacDinh={{ k: "ngay", dir: -1 }}
            chinh="tien"
            onDong={(x) => () => setCt({ loai: "hd", id: x.id })}
            xemGiaVon={xemGiaVon}
            xuatRef={xuatRef}
          />
        )
      } else {
        const kf = view === "time" ? (l: DongBan) => khoaThoiGian(g, l.ngay) : khoaChieu(view as Exclude<Xem, "docs" | "time">, dm)
        const m = gomBan(cur, kf)
        const rong = (): NhomBan => ({ k: "", rev: 0, ret: 0, net: 0, cost: 0, gp: 0, nInv: 0, nCust: 0, avg: 0, nProd: 0, qty: 0, rqty: 0, last: "" })
        const nhom: NhomBC[] =
          view === "time"
            ? dsThoiGian.map((t, i) => ({ ...(m.get(t.k) || rong()), k: t.k, _n: t.label, _sub: t.sub, _s: i, r: t.r }))
            : Array.from(m.values()).map((x) => {
                const n = tenDong(view as Exclude<Xem, "docs" | "time">, x.k, dm)
                return { ...x, _n: n.n, _sub: n.s }
              })
        const tong: NhomBC = { _n: "Tổng", ...T, nProd: new Set(cur.filter((l) => l.loai > 0 && l.sp).map((l) => l.sp)).size, qty: 0, rqty: 0, last: "" }
        const M = {
          rev: { k: "rev", label: "Doanh thu", f: "money", v: (x: NhomBC) => x.rev } as CotBang<NhomBC>,
          ret: { k: "ret", label: "Hàng trả", f: "money", v: (x: NhomBC) => x.ret } as CotBang<NhomBC>,
          net: { k: "net", label: "DT thuần", f: "money", v: (x: NhomBC) => x.net, bold: true } as CotBang<NhomBC>,
          nInv: { k: "nInv", label: "Số HĐ", f: "int", v: (x: NhomBC) => x.nInv } as CotBang<NhomBC>,
          gp: { k: "gp", label: "Lãi gộp", f: "money", v: (x: NhomBC) => x.gp, cost: true, opt: true } as CotBang<NhomBC>,
          margin: { k: "margin", label: "Biên %", f: "pct", v: (x: NhomBC) => (x.net ? (x.gp || 0) / x.net : null), cost: true, opt: true } as CotBang<NhomBC>,
          nCust: { k: "nCust", label: "Khách mua", f: "int", v: (x: NhomBC) => x.nCust } as CotBang<NhomBC>,
          avg: { k: "avg", label: "TB / HĐ", f: "money", v: (x: NhomBC) => (x.nInv ? (x.net || 0) / x.nInv : 0) } as CotBang<NhomBC>,
          share: { k: "share", label: "% tổng", f: "share", v: (x: NhomBC) => x.net } as CotBang<NhomBC>,
          nProd: { k: "nProd", label: "Số mặt hàng", f: "int", v: (x: NhomBC) => x.nProd } as CotBang<NhomBC>,
          last: { k: "last", label: "Lần mua cuối", f: "date", v: (x: NhomBC) => x.last || null } as CotBang<NhomBC>,
          perCust: { k: "perCust", label: "TB / khách", f: "money", v: (x: NhomBC) => (x.nCust ? (x.net || 0) / x.nCust : 0) } as CotBang<NhomBC>,
        }
        const phu = (c: CotBang<NhomBC>) => ({ ...c, opt: true })
        let cot: CotBang<NhomBC>[]
        switch (view) {
          case "time":
            cot = [M.rev, M.ret, M.net, M.nInv, M.gp, M.margin, phu(M.nCust), phu(M.avg)]
            break
          case "prod":
            cot = [
              { k: "qty", label: "Số lượng", f: "qty", v: (x) => hienSoLuong(dm.sp.get(x.k || ""), x.qty || 0), noTot: true },
              M.net,
              M.share,
              phu(M.ret),
              { k: "rqty", label: "SL trả", f: "qty", v: (x) => hienSoLuong(dm.sp.get(x.k || ""), x.rqty || 0), noTot: true, opt: true },
              M.gp,
              M.margin,
              { k: "ap", label: "Giá bán TB", f: "money", v: (x) => (x.qty ? (x.rev || 0) / x.qty : 0), noTot: true, opt: true },
              phu(M.nCust),
            ]
            break
          case "pgroup":
          case "brand":
            cot = [M.net, M.share, M.nProd, M.gp, M.margin]
            break
          case "cust":
            cot = [
              M.net,
              M.nInv,
              M.last,
              phu(M.share),
              phu(M.ret),
              M.gp,
              { k: "debt", label: "Công nợ hiện tại", f: "money", v: (x) => (x.k ? d.no?.[x.k] ?? null : d.no ? Object.values(d.no).reduce((s, v) => s + v, 0) : null), opt: true },
              { k: "owner", label: "NV phụ trách", f: "text", v: (x) => (x.k ? tenGiaTri(dm, "staff", dm.khach.get(x.k)?.nv || "") : ""), opt: true },
            ]
            break
          case "staff":
            cot = [M.net, M.nInv, M.nCust, phu(M.share), phu(M.ret), M.gp]
            break
          default:
            cot = [M.net, M.nCust, M.perCust, phu(M.share), M.gp]
        }
        const c = CHIEU[view as Exclude<Xem, "docs">]
        tenXuat = "Theo " + c.label.toLowerCase()
        bang = (
          <BangBaoCao<NhomBC>
            khoa={`ban:${view}:inv`}
            tieuDe={"Theo " + c.label.toLowerCase()}
            cotDau={view === "time" ? (g === "day" ? "Ngày" : g === "week" ? "Tuần" : "Tháng") : c.label}
            cot={cot}
            dong={nhom}
            tong={tong}
            coSo={T.net}
            sapMacDinh={view === "time" ? { k: "_n", dir: 1 } : { k: "net", dir: -1 }}
            chinh="net"
            onDong={onDong}
            xemGiaVon={xemGiaVon}
            batThem={view === "time" ? batThem : undefined}
            xuatRef={xuatRef}
          />
        )
        if (view === "time") {
          let cv: number[] | null = null
          if (prev && cmp) {
            const mc = gomBan(prev, (l) => khoaThoiGian(g, l.ngay))
            cv = chiaThoiGian(cmp[0], cmp[1], g).map((t) => mc.get(t.k)?.net || 0)
          }
          const cotBD: CotBD[] = nhom.map((x) => ({ label: x._n.replace("Tuần ", "").replace("Tháng ", "Th"), v: x.net || 0, title: `${x._n}: ${soDu(x.net || 0)}`, onClick: onDong(x) }))
          bieuDo = (
            <BieuDoCot
              tieuDe={`Doanh thu thuần theo ${g === "day" ? "ngày" : g === "week" ? "tuần" : "tháng"}`}
              chuGiai={[{ label: "Kỳ này", kieu: "cot" }, ...(cv ? [{ label: "Kỳ trước", kieu: "duong" as const }] : [])]}
              cot={cotBD}
              soSanh={cv}
            />
          )
        } else {
          const xep = nhom.slice().sort((x, y) => (y.net || 0) - (x.net || 0))
          const khac = xep.slice(10).reduce((s, x) => s + (x.net || 0), 0)
          bieuDo = (
            <BieuDoNgang
              tieuDe={`Top 10 ${c.label.toLowerCase()} theo doanh thu thuần`}
              ds={[...xep.slice(0, 10).map((x) => ({ label: x._n, v: x.net || 0, onClick: onDong(x) })), ...(khac > 0 ? [{ label: `Khác (${xep.length - 10})`, v: khac, khac: true }] : [])]}
            />
          )
        }
      }
      // Khối phụ: hàng trả + giảm giá trên hoá đơn.
      const tra = d.phieuTra.filter((r) => r.ngay >= a && r.ngay <= b && quaLoc({ kh: r.kh, nv: r.nv }, loc, dm)).sort((x, y) => y.ngay.localeCompare(x.ngay))
      const hdKy = new Set(cur.filter((l) => l.loai > 0).map((l) => l.hd))
      const giam = new Map<string, { n: number; v: number }>()
      let tongGiam = 0
      for (const id of Array.from(hdKy)) {
        const h = d.hoaDon.get(id)
        if (!h || !h.giam) continue
        tongGiam += h.giam
        const e = giam.get(h.nv) || { n: 0, v: 0 }
        e.n++
        e.v += h.giam
        giam.set(h.nv, e)
      }
      return {
        kpis,
        bang,
        bieuDo: view === "docs" ? null : bieuDo,
        tenXuat,
        rong: !cur.some((l) => l.loai > 0),
        phu:
          view === "docs" ? null : (
            <>
              <KhoiGap
                tieuDe="Hàng trả trong kỳ"
                phai={`${tra.length} phiếu · ${soGon(tra.reduce((s, r) => s + r.tien, 0))}`}
                testId="bc-khoi-tra"
                dong={tra.map((r) => ({ label: `${r.ma} · ${tenGiaTri(dm, "cust", r.kh)}`, sub: [nhanKhoang(r.ngay, r.ngay), r.lyDo, r.loai].filter(Boolean).join(" · "), value: soDu(r.tien), onClick: () => setCt({ loai: "tra", id: r.id }) }))}
              />
              <KhoiGap
                tieuDe="Giảm giá trên hoá đơn"
                phai={soGon(tongGiam)}
                dong={Array.from(giam.entries())
                  .sort((x, y) => y[1].v - x[1].v)
                  .map(([nv, x]) => ({ label: tenGiaTri(dm, "staff", nv), sub: `${x.n} hoá đơn có giảm giá`, value: soDu(x.v) }))}
              />
            </>
          ),
      }
    }
    // ---------------- Đơn đặt
    const cur = d.dat.filter((l) => trong(l, a, b) && qua(l))
    const prev = cmp && st.soSanh ? d.dat.filter((l) => trong(l, cmp[0], cmp[1]) && qua(l)) : null
    const T = congDat(cur)
    const TP = prev ? congDat(prev) : null
    const v = new Array(len).fill(0)
    for (const l of cur) v[soNgay(a, l.ngay)] += l.tien
    const kpis: TheKpi[] = [
      { id: "on", label: "Số đơn", value: soDu(T.n), info: GIAI_THICH.order, delta: soSanh(T.n, TP?.n, true), onClick: () => daoThem({ l: "Đơn đặt", v: "docs" }) },
      { id: "ov", label: "Giá trị đặt", value: soGon(T.val), info: GIAI_THICH.order, delta: soSanh(T.val, TP?.val, true), spark: duongXuHuong(v), onClick: () => doiXem("time") },
      { id: "od", label: "Đã xuất hoá đơn", value: soGon(T.done), info: GIAI_THICH.order, onClick: () => daoThem({ l: "Đã xuất HĐ", v: "docs", f: { daXuat: true } }) },
      { id: "onx", label: "Chưa xuất", value: soGon(T.not), info: GIAI_THICH.order, tone: T.not > 0 ? "warning" : undefined, onClick: () => daoThem({ l: "Chưa xuất HĐ", v: "docs", f: { chuaXuat: true } }) },
      { id: "or", label: "Tỷ lệ xuất", value: phanTram(T.rate), info: GIAI_THICH.order },
    ]
    let bang: React.ReactNode
    let bieuDo: React.ReactNode = null
    let tenXuat = ""
    if (view === "docs") {
      const m = new Map<string, { tien: number; xuat: number }>()
      for (const l of cur) {
        const e = m.get(l.don) || { tien: 0, xuat: 0 }
        e.tien += l.tien
        e.xuat += l.daXuat
        m.set(l.don, e)
      }
      const ds = Array.from(m.entries())
        .filter(([, e]) => (E.co.chuaXuat ? e.tien - e.xuat > 0 : E.co.daXuat ? e.xuat > 0 : true))
        .map(([id, e]) => {
          const o = d.don.get(id)!
          return { _n: o.ma, _sub: tenGiaTri(dm, "cust", o.kh), id, ngay: o.ngay, tt: o.trangThai, tien: e.tien, chua: e.tien - e.xuat, _s: o.ngay }
        })
      type D = (typeof ds)[number]
      tenXuat = "Đơn đặt"
      bang = (
        <BangBaoCao<D>
          khoa="ban:docs:ord"
          tieuDe="Đơn đặt"
          phu={`${ds.length} chứng từ`}
          cotDau="Chứng từ"
          cot={[
            { k: "ngay", label: "Ngày", f: "date", v: (x) => x.ngay },
            { k: "tt", label: "Trạng thái", f: "text", v: (x) => x.tt },
            { k: "tien", label: "Giá trị đặt", f: "money", v: (x) => x.tien, bold: true },
            { k: "chua", label: "Chưa xuất", f: "money", v: (x) => x.chua, tone: (x) => (x.chua > 0 ? "warning" : undefined) },
          ]}
          dong={ds}
          tong={{ _n: "Tổng", tien: ds.reduce((s, x) => s + x.tien, 0), chua: ds.reduce((s, x) => s + x.chua, 0) } as D}
          sapMacDinh={{ k: "ngay", dir: -1 }}
          chinh="tien"
          onDong={(x) => () => setCt({ loai: "don", id: x.id })}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else {
      const kf = view === "time" ? (l: DongDat) => khoaThoiGian(g, l.ngay) : khoaChieu(view as Exclude<Xem, "docs" | "time">, dm)
      const m = gomDat(cur, kf)
      const rong = (): NhomDat => ({ k: "", n: 0, val: 0, done: 0, not: 0, rate: 0, nCust: 0 })
      const nhom: NhomBC[] =
        view === "time"
          ? dsThoiGian.map((t, i) => ({ ...(m.get(t.k) || rong()), k: t.k, _n: t.label, _sub: t.sub, _s: i, r: t.r }))
          : Array.from(m.values()).map((x) => {
              const n = tenDong(view as Exclude<Xem, "docs" | "time">, x.k, dm)
              return { ...x, _n: n.n, _sub: n.s }
            })
      const c = CHIEU[view as Exclude<Xem, "docs">]
      tenXuat = "Theo " + c.label.toLowerCase()
      bang = (
        <BangBaoCao<NhomBC>
          khoa={`ban:${view}:ord`}
          tieuDe={"Theo " + c.label.toLowerCase()}
          cotDau={view === "time" ? (g === "day" ? "Ngày" : g === "week" ? "Tuần" : "Tháng") : c.label}
          cot={[
            { k: "n", label: "Số đơn", f: "int", v: (x) => x.n },
            { k: "val", label: "Giá trị đặt", f: "money", v: (x) => x.val, bold: true },
            { k: "done", label: "Đã xuất", f: "money", v: (x) => x.done },
            { k: "not", label: "Chưa xuất", f: "money", v: (x) => x.not, tone: (x) => ((x.not || 0) > 0 ? "warning" : undefined) },
            { k: "share", label: "% tổng", f: "share", v: (x) => x.val, opt: true },
          ]}
          dong={nhom}
          tong={{ _n: "Tổng", ...T }}
          coSo={T.val}
          sapMacDinh={view === "time" ? { k: "_n", dir: 1 } : { k: "val", dir: -1 }}
          chinh="val"
          onDong={onDong}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
      if (view === "time") {
        let cv: number[] | null = null
        if (prev && cmp) {
          const mc = gomDat(prev, (l) => khoaThoiGian(g, l.ngay))
          cv = chiaThoiGian(cmp[0], cmp[1], g).map((t) => mc.get(t.k)?.val || 0)
        }
        bieuDo = (
          <BieuDoCot
            tieuDe={`Giá trị đặt theo ${g === "day" ? "ngày" : g === "week" ? "tuần" : "tháng"}`}
            chuGiai={[{ label: "Kỳ này", kieu: "cot" }, ...(cv ? [{ label: "Kỳ trước", kieu: "duong" as const }] : [])]}
            cot={nhom.map((x) => ({ label: x._n.replace("Tuần ", "").replace("Tháng ", "Th"), v: x.val || 0, title: `${x._n}: ${soDu(x.val || 0)}`, onClick: onDong(x) }))}
            soSanh={cv}
          />
        )
      } else {
        const xep = nhom.slice().sort((x, y) => (y.val || 0) - (x.val || 0))
        const khac = xep.slice(10).reduce((s, x) => s + (x.val || 0), 0)
        bieuDo = (
          <BieuDoNgang
            tieuDe={`Top 10 ${c.label.toLowerCase()} theo giá trị đặt`}
            ds={[...xep.slice(0, 10).map((x) => ({ label: x._n, v: x.val || 0, onClick: onDong(x) })), ...(khac > 0 ? [{ label: `Khác (${xep.length - 10})`, v: khac, khac: true }] : [])]}
          />
        )
      }
    }
    return { kpis, bang, bieuDo: view === "docs" ? null : bieuDo, tenXuat, rong: cur.length === 0, phu: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nap.data, dm, a, b, cmp?.[0], cmp?.[1], st.soSanh, JSON.stringify(E), view, nguon, xemGiaVon, batThem])

  // Đường đào sâu
  const tenGoc = `Bán hàng · Theo ${CHIEU[(coChieu(st.xem) ? st.xem : "time") as Exclude<Xem, "docs">].label.toLowerCase()}`
  const dao: MatDao[] = [{ label: tenGoc, onClick: () => veBuoc(0) }, ...st.dao.map((s: BuocDao, i: number) => ({ label: s.l, onClick: () => veBuoc(i + 1) }))]
  const loai: LoaiLoc[] = ["cust", "cgroup", "channel", "province", ...(khoaNV ? [] : (["staff"] as LoaiLoc[])), "prod", "pgroup", "brand", "ncc", ...(nguon === "ord" ? (["ostatus"] as LoaiLoc[]) : [])]
  const nhanKy = `${tenKy(st.ky)} · ${nhanKhoang(ky.a, ky.b)}`

  return (
    <KhungBaoCao
      href="/bao-cao/ban-hang"
      role={bc.user?.role}
      dao={dao}
      onBoDao={() => veBuoc(0)}
      onXuat={bc.xuatFile ? () => xuatExcel(`Bán hàng · ${nguon === "inv" ? "Hoá đơn" : "Đơn đặt"} · ${vm?.tenXuat || ""} · ${nhanKy}`, xuatRef.current?.()) : null}
      thanhLoc={
        <ThanhLoc
          che="range"
          homNay={homNay}
          maKy={st.ky}
          ca={st.ca}
          cb={st.cb}
          onKy={(ky, ca, cb) => dat({ ky, ca: ca ?? null, cb: cb ?? null, dao: [] })}
          soSanh={{ bat: st.soSanh, nhan: "So với kỳ trước", onDoi: () => dat({ soSanh: !st.soSanh }) }}
          loai={loai}
          loc={st.loc}
          luaChon={(k) => luaChonLoc(dm, k)}
          onLoc={(k, vals) => dat({ loc: { ...st.loc, [k]: vals } })}
          onBoHet={() => dat({ loc: {} })}
          khoaNV={khoaNV ? bc.user?.full_name || "Tôi" : null}
          capNhat={nap.capNhat}
          onTaiLai={nap.taiLai}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <CongTacDoan
          className="w-full lg:w-[220px]"
          ds={[
            { value: "inv", label: "Hoá đơn" },
            { value: "ord", label: "Đơn đặt" },
          ]}
          value={nguon}
          onChange={(v) => dat({ nguon: v as "inv" | "ord", dao: [] })}
        />
      </div>
      {nguon === "ord" && <BangHoPhach>Đây là số đơn đặt — không phải doanh thu</BangHoPhach>}
      {bc.loading || (nap.dangTai && !vm) ? (
        <DangTai soThe={5} />
      ) : nap.loi ? (
        <LoiDocSo text={`Đọc số bán hàng hỏng: ${nap.loi}. Màn này không hiện số 0 thay cho phần lỗi.`} onThuLai={nap.taiLai} />
      ) : vm ? (
        <>
          {nap.data?.thieu && <ChuaDu text="Số liệu quá lớn, đang hiện 20.000 dòng đầu — thu hẹp kỳ hoặc thêm lọc." />}
          <HangKpi kpis={vm.kpis} />
          {vm.rong && !st.dao.length ? (
            <KhongCoSo
              text={`${tenKy(st.ky)} chưa có ${nguon === "inv" ? "hoá đơn" : "đơn đặt"} nào${Object.keys(st.loc).length ? " khớp lọc" : ""} — đổi kỳ sang Tháng trước?`}
              nut={{ label: "Xem tháng trước", onClick: () => dat({ ky: "lastmonth", dao: [] }) }}
            />
          ) : (
            <>
              <HangChon nhan="Xem theo" ds={cacXem.map((v) => ({ k: v, label: CHIEU[v].label, on: v === (st.xem || "time") && !st.dao.length, onClick: () => doiXem(v) }))} />
              {vm.bieuDo}
              {vm.bang}
              {vm.phu}
            </>
          )}
        </>
      ) : null}
      <XemNhanhChungTu ct={ct} onDong={() => setCt(null)} />
    </KhungBaoCao>
  )
}
