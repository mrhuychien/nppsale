"use client"

/**
 * MÀN 5 — CÔNG NỢ (`/bao-cao/cong-no`). Spec mục 7, thiết kế 26/09/2026.
 * "Ai đang nợ, nợ bao lâu, nhân viên nào đang giữ nợ?" — số TẠI MỘT NGÀY ("Tính đến ngày").
 * Xem theo: Khách (→ sổ chi tiết) · Tuổi nợ (→ khách trong nhóm) · Nhân viên (→ khách) · Hoá đơn
 * (→ xem nhanh, có nút Thu tiền). Khoản âm hiện "Dư có", không bao giờ ép về 0.
 * NVBH: chỉ khách của mình (RLS), không có chế độ Nhân viên.
 */
import { useMemo, useRef, useState } from "react"
import { useBaoCao } from "@/hooks/use-bao-cao"
import { KhungBaoCao, type MatDao } from "./khung"
import { ThanhLoc } from "./thanh-loc"
import { HangKpi, HangChon, DangTai, LoiDocSo, ChuaDu, GhiChu, type TheKpi } from "./khoi"
import { BieuDoChong } from "./bieu-do"
import { BangBaoCao, type CotBang, type DongBang } from "./bang"
import { XemNhanhChungTu, type ChungTuMo } from "./xem-nhanh"
import { useNap, layDanhMuc, luaChonLoc, tenGiaTri, xuatExcel } from "./dung-chung"
import { createClient } from "@/lib/supabase/client"
import { ngayDu, ngayThang } from "@/lib/bao-cao/ky"
import { hieuLuc, MAC_DINH_MAN } from "@/lib/bao-cao/trang-thai"
import { quaLoc, type LoaiLoc } from "@/lib/bao-cao/cong"
import { soGon, soDu, phanTram } from "@/lib/bao-cao/so"
import { napCongNo, napSoChiTiet, NHOM_TUOI, type NoKhach, type PhieuNoTai } from "@/lib/bao-cao/nap-cong-no"
import { GIAI_THICH } from "@/lib/bao-cao/giai-thich"

const XEM = { customer: "Khách", aging: "Tuổi nợ", staff: "Nhân viên", inv: "Hoá đơn" } as const
const MAU_TUOI = ["bg-primary/40", "bg-amber-300", "bg-orange-400", "bg-red-500", "bg-red-700"]

const oNo = (v: number) => (v < 0 ? { t: `Dư có ${soDu(-v)}`, tone: "primary" as const } : { t: soDu(v) })

export function ManCongNo() {
  const bc = useBaoCao("receivables", MAC_DINH_MAN["/bao-cao/cong-no"])
  const { st, dat, daoThem, veBuoc, doiXem, homNay, khoaNV, xemGiaVon, orgId } = bc
  const X = st.den || homNay
  // NVBH: RLS đã chỉ trả nợ khách của họ — không lọc thêm theo người phụ trách (sẽ giấu nhầm).
  const E = hieuLuc(st, st.xem || "customer", null)
  const view = E.xem
  const [ct, setCt] = useState<ChungTuMo | null>(null)
  const xuatRef = useRef<(() => (string | number)[][]) | null>(null)

  const nap = useNap(
    orgId
      ? async () => {
          const { dm, thieu } = await layDanhMuc(orgId)
          const so = await napCongNo(createClient(), orgId, X, dm)
          return { dm, ...so, thieu: thieu || so.thieu }
        }
      : null,
    `${orgId}|${X}`
  )
  const dm = nap.data?.dm || null
  const khSo = view === "ledger" && typeof E.loc.cust?.[0] === "string" ? E.loc.cust[0] : null
  const noKhSo = khSo ? nap.data?.khach.find((k) => k.kh === khSo)?.no ?? 0 : 0
  const so = useNap(khSo && nap.data ? () => napSoChiTiet(createClient(), khSo, X, noKhSo) : null, `${khSo}|${X}|${noKhSo}`)

  const vm = useMemo(() => {
    const d = nap.data
    if (!d || !dm) return null
    const tt = st.loc.dstatus || []
    const locKh = { ...E.loc }
    delete locKh.dstatus
    let khach = d.khach.filter((k) => quaLoc({ kh: k.kh, nv: k.nv }, locKh, dm) && (!tt.length || k.tinhTrang.some((x) => tt.includes(x))))
    if (typeof E.co.nhom === "string") khach = khach.filter((k) => k.tuoi[Number(E.co.nhom)] > 0)
    const phaiThu = khach.reduce((s, k) => s + Math.max(0, k.no), 0)
    const qua = khach.reduce((s, k) => s + k.qua, 0)
    const duCo = khach.reduce((s, k) => s + Math.max(0, -k.no), 0)
    const tuoi = [0, 1, 2, 3, 4].map((i) => khach.reduce((s, k) => s + k.tuoi[i], 0))
    const kpis: TheKpi[] = [
      { id: "debt", label: "Tổng phải thu", value: soGon(phaiThu), info: GIAI_THICH.debt, onClick: () => doiXem("customer") },
      { id: "over", label: "Quá hạn", value: soGon(qua), info: GIAI_THICH.over, sub: `${phanTram(phaiThu ? qua / phaiThu : 0)} tổng phải thu`, tone: "danger", onClick: () => doiXem("aging") },
      { id: "nd", label: "Số khách đang nợ", value: soDu(khach.filter((k) => k.no > 0).length), onClick: () => doiXem("customer") },
      { id: "limit", label: "Khách vượt hạn mức", value: soDu(khach.filter((k) => k.tinhTrang.includes("Vượt hạn mức")).length), info: GIAI_THICH.limit, tone: "warning", onClick: () => dat({ loc: { ...st.loc, dstatus: ["Vượt hạn mức"] }, xem: "customer", dao: [] }) },
      { id: "credit", label: "Dư có", value: soGon(duCo), info: GIAI_THICH.credit, tone: duCo ? "primary" : undefined },
    ]
    const soSo = (k: NoKhach) => () => daoThem({ l: tenGiaTri(dm, "cust", k.kh), v: "ledger", f: { cust: k.kh } })
    let bang: React.ReactNode = null
    let tenXuat = XEM[view as keyof typeof XEM] || "Sổ chi tiết"
    if (view === "customer") {
      type D = DongBang & NoKhach
      const ds: D[] = khach.map((k) => {
        const c = dm.khach.get(k.kh)
        return { ...k, _n: c?.ten || "Khách đã xoá", _sub: [c?.kenh, c?.tinh].filter(Boolean).join(" · ") }
      })
      const cot: CotBang<D>[] = [
        { k: "nv", label: "NV phụ trách", f: "text", v: (x) => tenGiaTri(dm, "staff", x.nv) },
        { k: "no", label: "Công nợ", f: "money", v: (x) => x.no, bold: true, render: (x) => oNo(x.no) },
        { k: "qua", label: "Quá hạn", f: "money", v: (x) => x.qua, tone: (x) => (x.qua > 0 ? "danger" : "muted") },
        { k: "hanMuc", label: "Hạn mức", f: "money", v: (x) => x.hanMuc || null, noTot: true, tone: (x) => (x.tinhTrang.includes("Vượt hạn mức") ? "warning" : undefined) },
        { k: "lauNhat", label: "Quá hạn lâu nhất", f: "days", v: (x) => x.lauNhat || null, noTot: true, tone: (x) => (x.lauNhat ? "danger" : undefined) },
        { k: "thuCuoi", label: "Lần thu cuối", f: "date", v: (x) => x.thuCuoi || null },
      ]
      bang = (
        <BangBaoCao<D>
          khoa={`no:cust:${String(E.co.nhom ?? "")}`}
          tieuDe={typeof E.co.nhom === "string" ? `Khách có nợ nhóm ${NHOM_TUOI[Number(E.co.nhom)]}` : "Theo khách"}
          phu={`${ds.length} khách · tính đến ${ngayDu(X)}`}
          cotDau="Khách"
          cot={cot}
          dong={ds}
          tong={{ _n: "Tổng", no: khach.reduce((s, k) => s + k.no, 0), qua } as D}
          sapMacDinh={{ k: "no", dir: -1 }}
          chinh="no"
          onDong={soSo}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else if (view === "aging") {
      type D = DongBang & { i: number; n: number; tien: number }
      const ds: D[] = NHOM_TUOI.map((l, i) => ({ _n: l, _s: i, i, n: khach.filter((k) => k.tuoi[i] > 0).length, tien: tuoi[i] }))
      const tong = tuoi.reduce((s, v) => s + v, 0)
      bang = (
        <BangBaoCao<D>
          khoa="no:aging"
          tieuDe="Tuổi nợ"
          phu={`Tính đến ${ngayDu(X)}`}
          cotDau="Nhóm"
          cot={[
            { k: "n", label: "Số khách", f: "int", v: (x) => x.n },
            { k: "tien", label: "Số tiền", f: "money", v: (x) => x.tien, bold: true, tone: (x) => (x.i > 0 && x.tien > 0 ? "danger" : undefined) },
            { k: "share", label: "% tổng", f: "share", v: (x) => x.tien },
          ]}
          dong={ds}
          tong={{ _n: "Tổng", n: khach.filter((k) => k.no > 0).length, tien: tong } as D}
          coSo={tong || 1}
          khongSap
          chinh="tien"
          onDong={(x) => (x.tien > 0 ? () => daoThem({ l: `Nhóm ${x._n}`, v: "customer", f: { nhom: String(x.i) } }) : null)}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else if (view === "staff") {
      type D = DongBang & { k: string; no: number; qua: number; tile: number | null; dso: number | null }
      const m = new Map<string, NoKhach[]>()
      for (const k of khach) {
        const a = m.get(k.nv)
        if (a) a.push(k)
        else m.set(k.nv, [k])
      }
      const ds: D[] = Array.from(m.entries()).map(([nv, ks]) => {
        const no = ks.reduce((s, k) => s + k.no, 0)
        const thu = d.thuThang.get(nv) || 0
        const ban = d.ban90.get(nv) || 0
        return { _n: tenGiaTri(dm, "staff", nv), k: nv, no, qua: ks.reduce((s, k) => s + k.qua, 0), tile: thu + Math.max(0, no) > 0 ? thu / (thu + Math.max(0, no)) : null, dso: ban > 0 ? Math.round(no / (ban / 90)) : null }
      })
      bang = (
        <BangBaoCao<D>
          khoa="no:staff"
          tieuDe="Theo nhân viên"
          phu={`Tính đến ${ngayDu(X)} · tỉ lệ thu = đã thu trong tháng / (đã thu + còn nợ)`}
          cotDau="Nhân viên"
          cot={[
            { k: "no", label: "Công nợ", f: "money", v: (x) => x.no, bold: true, render: (x) => oNo(x.no) },
            { k: "qua", label: "Quá hạn", f: "money", v: (x) => x.qua, tone: (x) => (x.qua > 0 ? "danger" : undefined) },
            { k: "tile", label: "Tỷ lệ thu trong tháng", f: "pct", v: (x) => x.tile, noTot: true },
            { k: "dso", label: "Số ngày thu tiền TB", f: "days", v: (x) => x.dso, noTot: true },
          ]}
          dong={ds}
          tong={{ _n: "Tổng", no: ds.reduce((s, x) => s + x.no, 0), qua: ds.reduce((s, x) => s + x.qua, 0) } as D}
          sapMacDinh={{ k: "no", dir: -1 }}
          chinh="no"
          onDong={(x) => () => daoThem({ l: x._n, v: "customer", f: { staff: x.k } })}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else if (view === "inv") {
      type D = DongBang & PhieuNoTai
      const ds: D[] = khach.flatMap((k) => k.phieu.filter((p) => p.con > 0).map((p) => ({ ...p, _n: p.ma, _sub: tenGiaTri(dm, "cust", p.kh) })))
      bang = (
        <BangBaoCao<D>
          khoa="no:inv"
          tieuDe="Hoá đơn còn nợ"
          phu={`${ds.length} hoá đơn · tính đến ${ngayDu(X)}`}
          cotDau="Hoá đơn · khách"
          cot={[
            { k: "ngay", label: "Ngày", f: "date", v: (x) => x.ngay },
            { k: "han", label: "Hạn", f: "date", v: (x) => x.han },
            { k: "con", label: "Còn phải thu", f: "money", v: (x) => x.con, bold: true },
            { k: "qua", label: "Quá hạn", f: "days", v: (x) => (x.qua > 0 ? x.qua : null), noTot: true, tone: (x) => (x.qua > 0 ? "danger" : "muted") },
          ]}
          dong={ds}
          tong={{ _n: "Tổng", con: ds.reduce((s, x) => s + x.con, 0) } as D}
          sapMacDinh={{ k: "qua", dir: -1 }}
          chinh="con"
          onDong={(x) => (x.hd ? () => setCt({ loai: "hd", id: x.hd! }) : null)}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else if (view === "ledger" && khSo) {
      tenXuat = "Sổ chi tiết " + tenGiaTri(dm, "cust", khSo)
      if (so.dangTai && !so.data) bang = <DangTai soThe={0} />
      else if (so.loi) bang = <LoiDocSo text={`Đọc sổ chi tiết hỏng: ${so.loi}`} onThuLai={so.taiLai} />
      else if (so.data) {
        type D = DongBang & { ngay: string; dien: string; no: number; co: number; du: number; mo: ChungTuMo | null }
        const ds: D[] = so.data.ds
          .slice()
          .reverse()
          .map((e, i) => ({ _n: e.ma, _s: -i, ngay: e.ngay, dien: e.dien, no: e.no, co: e.co, du: e.du, mo: e.mo }))
        bang = (
          <BangBaoCao<D>
            khoa={`no:so:${khSo}`}
            tieuDe={`Sổ chi tiết · ${tenGiaTri(dm, "cust", khSo)}`}
            phu={`${ngayThang(so.data.tu)} – ${ngayThang(X)} · ${ds.length} chứng từ`}
            cotDau="Chứng từ"
            cot={[
              { k: "ngay", label: "Ngày", f: "date", v: (x) => x.ngay },
              { k: "dien", label: "Diễn giải", f: "text", v: (x) => x.dien },
              { k: "no", label: "Nợ", f: "money", v: (x) => x.no || null },
              { k: "co", label: "Có", f: "money", v: (x) => x.co || null },
              { k: "du", label: "Số dư", f: "money", v: (x) => x.du, bold: true, noTot: true, render: (x) => oNo(x.du) },
            ]}
            dong={ds}
            tong={{ _n: "", no: ds.reduce((s, x) => s + x.no, 0), co: ds.reduce((s, x) => s + x.co, 0) } as D}
            nhanTong={`Số dư đến ${ngayThang(X)}: ${noKhSo < 0 ? "dư có " + soDu(-noKhSo) : soDu(noKhSo)}`}
            phuTong={`Đầu kỳ ${ngayThang(so.data.tu)}: ${soDu(so.data.dau)}`}
            khongSap
            chinh="du"
            onDong={(x) => (x.mo ? () => setCt(x.mo) : null)}
            xemGiaVon={xemGiaVon}
            xuatRef={xuatRef}
          />
        )
      }
    }
    const tongTuoi = tuoi.reduce((s, v) => s + v, 0)
    return {
      kpis,
      bang,
      tenXuat,
      bieuDo:
        view === "ledger" || view === "staff" || tongTuoi === 0 ? null : (
          <BieuDoChong
            tieuDe="Công nợ theo tuổi nợ"
            ds={NHOM_TUOI.map((l, i) => ({ label: l, v: tuoi[i], mau: MAU_TUOI[i], onClick: tuoi[i] > 0 ? () => daoThem({ l: `Nhóm ${l}`, v: "customer", f: { nhom: String(i) } }) : undefined }))}
          />
        ),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nap.data, dm, JSON.stringify(E), JSON.stringify(st.loc), view, so.data, so.loi, so.dangTai, xemGiaVon, X])

  const goc = (st.xem || "customer") as keyof typeof XEM
  const dao: MatDao[] = [{ label: `Công nợ · Theo ${XEM[goc].toLowerCase()}`, onClick: () => veBuoc(0) }, ...st.dao.map((s, i) => ({ label: s.l, onClick: () => veBuoc(i + 1) }))]
  const loai: LoaiLoc[] = ["cust", ...(khoaNV ? [] : (["staff"] as LoaiLoc[])), "channel", "province", "dstatus"]
  return (
    <KhungBaoCao
      href="/bao-cao/cong-no"
      role={bc.user?.role}
      dao={dao}
      onBoDao={() => veBuoc(0)}
      onXuat={bc.xuatFile ? () => xuatExcel(`Công nợ · ${vm?.tenXuat || ""} · đến ${ngayDu(X)}`, xuatRef.current?.()) : null}
      thanhLoc={
        <ThanhLoc
          che="asof"
          homNay={homNay}
          ngay={X}
          onNgay={(d) => dat({ den: d === homNay ? null : d, dao: [] })}
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
      {bc.loading || (nap.dangTai && !vm) ? (
        <DangTai soThe={5} />
      ) : nap.loi ? (
        <LoiDocSo text={`Đọc công nợ hỏng: ${nap.loi}. Màn này không hiện số 0 thay cho phần lỗi.`} onThuLai={nap.taiLai} />
      ) : vm ? (
        <>
          {nap.data?.thieu && <ChuaDu text="Số liệu quá lớn, đang hiện 20.000 dòng đầu — thêm lọc để thu hẹp." />}
          <HangKpi kpis={vm.kpis} />
          {khoaNV && <GhiChu text="Chỉ hiện khách bạn phụ trách." />}
          <HangChon
            nhan="Xem theo"
            ds={(Object.keys(XEM) as (keyof typeof XEM)[]).filter((v) => !(khoaNV && v === "staff")).map((v) => ({ k: v, label: XEM[v], on: v === goc && !st.dao.length, onClick: () => doiXem(v) }))}
          />
          {vm.bieuDo}
          {vm.bang}
        </>
      ) : null}
      <XemNhanhChungTu ct={ct} onDong={() => setCt(null)} />
    </KhungBaoCao>
  )
}

