"use client"

/**
 * MÀN 4 — KHO (`/bao-cao/kho`). Spec mục 6, thiết kế 26/09/2026.
 * "Kho còn gì, trị giá bao nhiêu, hàng nào sắp hết hạn / nằm lâu?"
 * Tồn hiện tại / sắp hết hạn / tồn thấp / chậm bán / nhóm là số TẠI HÔM NAY (không theo kỳ);
 * Xuất – nhập – tồn theo kỳ (+ biểu đồ giá trị tồn theo ngày). Mặt hàng → các lô → thẻ kho.
 * Giá trị / giá vốn: chỉ người có quyền giá vốn mới thấy.
 */
import { useMemo, useRef } from "react"
import { useBaoCao } from "@/hooks/use-bao-cao"
import { KhungBaoCao, type MatDao } from "./khung"
import { ThanhLoc } from "./thanh-loc"
import { HangKpi, HangChon, DangTai, LoiDocSo, ChuaDu, GhiChu, type TheKpi } from "./khoi"
import { BieuDoCot } from "./bieu-do"
import { BangBaoCao, type CotBang, type DongBang } from "./bang"
import { useNap, layDanhMuc, luaChonLoc, tenGiaTri, xuatExcel } from "./dung-chung"
import { createClient } from "@/lib/supabase/client"
import { kyTheoMa, congNgay, soNgay, ngayDu, ngayThang, nhanKhoang, chiaThoiGian, tenKy } from "@/lib/bao-cao/ky"
import { hieuLuc, MAC_DINH_MAN } from "@/lib/bao-cao/trang-thai"
import { quaLoc, hienSoLuong, CHUA_CO, type LoaiLoc } from "@/lib/bao-cao/cong"
import { soGon, soDu } from "@/lib/bao-cao/so"
import { napTonKho, napBienDong, tinhXnt, NGUONG_KHO, type TonMatHang, type LoKho, type DongXnt } from "@/lib/bao-cao/nap-kho"
import { GIAI_THICH } from "@/lib/bao-cao/giai-thich"

const XEM = { current: "Tồn hiện tại", xnt: "Xuất – nhập – tồn", exp: "Sắp hết hạn", low: "Tồn thấp", slow: "Chậm bán", pgroup: "Nhóm hàng", brand: "Thương hiệu", ncc: "Nhà cung cấp" } as const
type XemGoc = keyof typeof XEM

export function ManKho() {
  const bc = useBaoCao("reports", MAC_DINH_MAN["/bao-cao/kho"])
  const { st, dat, daoThem, veBuoc, doiXem, homNay, xemGiaVon, orgId } = bc
  const E = hieuLuc(st, st.xem || "current", null)
  const view = E.xem
  const ky = kyTheoMa(st.ky, homNay, st.ca, st.cb)
  const [a, b] = E.khoang || [ky.a, ky.b]
  const theoKy = view === "xnt" || view === "card"
  const xuatRef = useRef<(() => (string | number)[][]) | null>(null)

  const nap = useNap(
    orgId
      ? async () => {
          const { dm, thieu } = await layDanhMuc(orgId)
          const t = await napTonKho(createClient(), orgId, homNay, dm)
          return { dm, ...t, thieu: thieu || t.thieu }
        }
      : null,
    `${orgId}|${homNay}`
  )
  const bd = useNap(theoKy && orgId ? () => napBienDong(createClient(), orgId, a) : null, `${orgId}|${a}|${theoKy}`)
  const dm = nap.data?.dm || null

  const vm = useMemo(() => {
    const d = nap.data
    if (!d || !dm) return null
    const qua = (sp: string) => quaLoc({ sp }, E.loc, dm)
    const ton = d.ton.filter((x) => qua(x.sp))
    const hanTu = congNgay(homNay, NGUONG_KHO.hetHan)
    const loHet = d.lo.filter((l) => qua(l.sp) && l.hsd && l.hsd <= hanTu)
    const kpis: TheKpi[] = [
      ...(xemGiaVon ? [{ id: "stockVal", label: "Giá trị tồn", value: soGon(ton.reduce((s, x) => s + x.giaTri, 0)), info: GIAI_THICH.stockVal, onClick: () => doiXem("current") } satisfies TheKpi] : []),
      { id: "inS", label: "Mặt hàng còn hàng", value: soDu(ton.length), onClick: () => doiXem("current") },
      { id: "exp", label: "Lô sắp hết hạn", value: soDu(loHet.length), info: GIAI_THICH.exp, sub: `HSD còn ≤ ${NGUONG_KHO.hetHan} ngày`, tone: loHet.length ? "warning" : undefined, onClick: () => doiXem("exp") },
      { id: "low", label: "Mặt hàng tồn thấp", value: soDu(ton.filter((x) => x.tonThap).length), info: GIAI_THICH.low, sub: `Đủ bán < ${NGUONG_KHO.tonThap} ngày`, tone: "warning", onClick: () => doiXem("low") },
      { id: "slow", label: "Hàng chậm bán", value: soDu(ton.filter((x) => x.chamBan).length), info: GIAI_THICH.slow, sub: `${NGUONG_KHO.khongBan} ngày không bán / > ${NGUONG_KHO.banHet} ngày`, onClick: () => doiXem("slow") },
    ]
    const tenSp = (sp: string) => {
      const p = dm.sp.get(sp)
      return { _n: p?.ten || "Không rõ mặt hàng", _sub: [p?.sku, p?.nhom].filter(Boolean).join(" · ") }
    }
    const giaTriCot = <T extends { giaTri: number }>(label = "Giá trị"): CotBang<DongBang & T> => ({ k: "giaTri", label, f: "money", v: (x) => x.giaTri, cost: true })
    const denLo = (sp: string) => () => daoThem({ l: tenGiaTri(dm, "prod", sp), v: "lots", f: { prod: sp } })
    let bang: React.ReactNode = null
    let bieuDo: React.ReactNode = null
    const ten = XEM[view as XemGoc] || (view === "lots" ? "Các lô" : "Thẻ kho")
    if (view === "current" || view === "low" || view === "slow") {
      type D = DongBang & TonMatHang
      let ds: D[] = ton.map((x) => ({ ...x, ...tenSp(x.sp) }))
      if (view === "low") ds = ds.filter((x) => x.tonThap)
      if (view === "slow") ds = ds.filter((x) => x.chamBan)
      const sl: CotBang<D> = { k: "sl", label: "Tồn", f: "qty", v: (x) => hienSoLuong(dm.sp.get(x.sp), x.sl), noTot: true }
      const cot: CotBang<D>[] =
        view === "current"
          ? [sl, giaTriCot<TonMatHang>(), { k: "nl", label: "Số lô", f: "int", v: (x) => x.lo.length, noTot: true }, { k: "hsd", label: "HSD gần nhất", f: "date", v: (x) => x.hsd, tone: (x) => (x.hsd && x.hsd <= hanTu ? "warning" : undefined) }]
          : view === "low"
            ? [sl, { k: "tb30", label: "Bán TB / ngày", f: "qty", v: (x) => hienSoLuong(dm.sp.get(x.sp), Math.round(x.tb30 * 10) / 10), noTot: true }, { k: "duBan", label: "Đủ bán", f: "days", v: (x) => Math.floor(x.duBan), noTot: true, tone: () => "warning" }]
            : [
                sl,
                { k: "banCuoi", label: "Ngày bán gần nhất", f: "text", v: (x) => (x.banCuoi ? ngayDu(x.banCuoi) : `Trên ${soNgay(congNgay(homNay, -89), homNay) + 1} ngày`) },
                { k: "duBan", label: "Số ngày bán hết", f: "text", v: (x) => (isFinite(x.duBan) ? `${soDu(x.duBan)} ngày` : "Không bán"), noTot: true },
                { ...giaTriCot<TonMatHang>(), opt: true },
              ]
      bang = (
        <BangBaoCao<D>
          khoa={`kho:${view}`}
          tieuDe={XEM[view]}
          phu={`${ds.length} mặt hàng`}
          cotDau="Mặt hàng"
          cot={cot}
          dong={ds}
          tong={{ _n: "Tổng", giaTri: ds.reduce((s, x) => s + x.giaTri, 0) } as D}
          sapMacDinh={view === "current" ? (xemGiaVon ? { k: "giaTri", dir: -1 } : { k: "_n", dir: 1 }) : view === "low" ? { k: "duBan", dir: 1 } : { k: "_n", dir: 1 }}
          chinh={view === "current" && xemGiaVon ? "giaTri" : "sl"}
          onDong={(x) => denLo(x.sp)}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else if (view === "exp") {
      type D = DongBang & LoKho & { con: number; giaTri: number }
      const ds: D[] = loHet.map((l) => ({ ...l, _n: l.ma, _sub: tenGiaTri(dm, "prod", l.sp), con: soNgay(homNay, l.hsd!), giaTri: l.sl * l.gia }))
      bang = (
        <BangBaoCao<D>
          khoa="kho:exp"
          tieuDe="Lô sắp hết hạn"
          phu={`${ds.length} lô · ngưỡng ≤ ${NGUONG_KHO.hetHan} ngày`}
          cotDau="Lô · mặt hàng"
          cot={[
            { k: "hsd", label: "HSD", f: "date", v: (x) => x.hsd },
            { k: "con", label: "Còn", f: "days", v: (x) => x.con, tone: (x) => (x.con < 0 ? "danger" : "warning") },
            { k: "sl", label: "Số lượng", f: "qty", v: (x) => hienSoLuong(dm.sp.get(x.sp), x.sl), noTot: true },
            giaTriCot<LoKho & { con: number; giaTri: number }>(),
          ]}
          dong={ds}
          tong={{ _n: "Tổng", giaTri: ds.reduce((s, x) => s + x.giaTri, 0) } as D}
          sapMacDinh={{ k: "con", dir: 1 }}
          chinh="con"
          onDong={(x) => denLo(x.sp)}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else if (view === "lots" && E.loc.prod?.[0]) {
      const sp = E.loc.prod[0]
      const t = d.ton.find((x) => x.sp === sp)
      type D = DongBang & LoKho & { con: number | null; giaTri: number }
      const ds: D[] = (t?.lo || []).map((l) => ({ ...l, _n: l.ma, con: l.hsd ? soNgay(homNay, l.hsd) : null, giaTri: l.sl * l.gia }))
      bang = (
        <BangBaoCao<D>
          khoa={`kho:lots:${sp}`}
          tieuDe={`Các lô của ${tenGiaTri(dm, "prod", sp)}`}
          phu={`${ds.length} lô còn hàng · bấm một lô để xem thẻ kho 30 ngày`}
          cotDau="Lô"
          cot={[
            { k: "nhap", label: "Ngày nhập", f: "date", v: (x) => x.nhap || null },
            { k: "hsd", label: "HSD", f: "date", v: (x) => x.hsd },
            { k: "con", label: "Còn", f: "days", v: (x) => x.con, noTot: true, tone: (x) => (x.con != null && x.con <= NGUONG_KHO.hetHan ? "warning" : undefined) },
            { k: "sl", label: "Số lượng", f: "qty", v: (x) => hienSoLuong(dm.sp.get(x.sp), x.sl), noTot: true },
            giaTriCot<LoKho & { con: number | null; giaTri: number }>(),
          ]}
          dong={ds}
          tong={{ _n: "Tổng", giaTri: t?.giaTri || 0 } as D}
          sapMacDinh={{ k: "hsd", dir: 1 }}
          chinh="sl"
          onDong={() => () => daoThem({ l: "Thẻ kho", v: "card", f: { prod: sp, range: [congNgay(homNay, -29), homNay] } })}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else if (theoKy) {
      if (bd.dangTai && !bd.data) bang = <DangTai soThe={0} />
      else if (bd.loi) bang = <LoiDocSo text={`Đọc phiếu kho hỏng: ${bd.loi}`} onThuLai={bd.taiLai} />
      else if (bd.data) {
        const tonNay = new Map<string, number>()
        const gia = new Map<string, number>()
        for (const x of d.ton) {
          tonNay.set(x.sp, x.sl)
          if (x.sl) gia.set(x.sp, x.giaTri / x.sl)
        }
        for (const m of bd.data.ds) if (!gia.has(m.sp) && m.gia) gia.set(m.sp, m.gia)
        if (view === "xnt") {
          const xnt = tinhXnt(tonNay, bd.data.ds, a, b)
          type D = DongBang & DongXnt & { giaTri: number }
          const ds: D[] = Array.from(xnt.values())
            .filter((x) => qua(x.sp) && (x.dau || x.nhap || x.ban || x.tra || x.khac || x.cuoi))
            .map((x) => ({ ...x, ...tenSp(x.sp), giaTri: Math.max(0, x.cuoi) * (gia.get(x.sp) || 0) }))
          const q = (k: keyof DongXnt, label: string): CotBang<D> => ({ k, label, f: "qty", v: (x) => hienSoLuong(dm.sp.get(x.sp), Number(x[k])), noTot: true })
          bang = (
            <BangBaoCao<D>
              khoa="kho:xnt"
              tieuDe="Xuất – nhập – tồn"
              phu={`${nhanKhoang(a, b)} · ${ds.length} mặt hàng`}
              cotDau="Mặt hàng"
              cot={[q("dau", "Tồn đầu"), q("nhap", "Nhập"), q("ban", "Xuất bán"), q("tra", "Trả về"), q("khac", "Xuất khác"), q("cuoi", "Tồn cuối"), giaTriCot<DongXnt & { giaTri: number }>("Giá trị cuối")]}
              dong={ds}
              tong={{ _n: "Tổng", giaTri: ds.reduce((s, x) => s + x.giaTri, 0) } as D}
              sapMacDinh={xemGiaVon ? { k: "giaTri", dir: -1 } : { k: "_n", dir: 1 }}
              chinh="cuoi"
              onDong={(x) => () => daoThem({ l: x._n, v: "card", f: { prod: x.sp, range: [a, b] } })}
              xemGiaVon={xemGiaVon}
              xuatRef={xuatRef}
            />
          )
          if (xemGiaVon) {
            // Giá trị tồn cuối mỗi ngày = Σ SL cuối ngày × giá vốn bình quân hiện tại.
            const ngay = chiaThoiGian(a, b, "day")
            const sau = new Map<string, number>()
            const theoNgay = bd.data.ds.slice().sort((x, y) => y.ngay.localeCompare(x.ngay))
            let i = 0
            const giaTriNgay: number[] = []
            for (let j = ngay.length - 1; j >= 0; j--) {
              const dd = ngay[j].k
              while (i < theoNgay.length && theoNgay[i].ngay > dd) {
                sau.set(theoNgay[i].sp, (sau.get(theoNgay[i].sp) || 0) + theoNgay[i].sl)
                i++
              }
              let v = 0
              tonNay.forEach((sl, sp) => {
                if (qua(sp)) v += Math.max(0, sl - (sau.get(sp) || 0)) * (gia.get(sp) || 0)
              })
              sau.forEach((s, sp) => {
                if (!tonNay.has(sp) && qua(sp)) v += Math.max(0, -s) * (gia.get(sp) || 0)
              })
              giaTriNgay[j] = v
            }
            bieuDo = <BieuDoCot tieuDe="Giá trị tồn theo ngày" nhat cot={ngay.map((t, j) => ({ label: t.label, v: giaTriNgay[j], title: `${t.label}: ${soDu(giaTriNgay[j])}` }))} />
          }
        } else if (view === "card" && E.loc.prod?.[0]) {
          const sp = E.loc.prod[0]
          const cua = bd.data.ds.filter((m) => m.sp === sp)
          const [x, y] = E.khoang || [a, b]
          const sauX = cua.filter((m) => m.ngay >= x).reduce((s, m) => s + m.sl, 0)
          const dau = (tonNay.get(sp) || 0) - sauX
          let du = dau
          const nhan = { nhap: "Phiếu nhập", tra: "Trả về", ban: "Xuất bán", khac: "Xuất khác / điều chỉnh" }
          type D = DongBang & { ngay: string; dien: string; vao: number; ra: number; du: number }
          const ds: D[] = cua
            .filter((m) => m.ngay >= x && m.ngay <= y)
            .map((m, i) => ({ _n: m.ma, _s: i, ngay: m.ngay, dien: nhan[m.loai], vao: m.sl > 0 ? m.sl : 0, ra: m.sl < 0 ? -m.sl : 0, du: (du += m.sl) }))
          const p = dm.sp.get(sp)
          const hq = (v: number) => hienSoLuong(p, v)
          bang = (
            <BangBaoCao<D>
              khoa={`kho:card:${sp}:${x}`}
              tieuDe={`Thẻ kho · ${p?.ten || "Không rõ mặt hàng"} · đơn vị ${p?.donViCoSo || ""}`}
              phu={`${nhanKhoang(x, y)} · tồn đầu ${hq(dau).t}`}
              cotDau="Chứng từ"
              cot={[
                { k: "ngay", label: "Ngày", f: "date", v: (r) => r.ngay },
                { k: "dien", label: "Diễn giải", f: "text", v: (r) => r.dien },
                { k: "vao", label: "Nhập", f: "qty", v: (r) => (r.vao ? hq(r.vao) : { t: "", sub: "" }) },
                { k: "ra", label: "Xuất", f: "qty", v: (r) => (r.ra ? hq(r.ra) : { t: "", sub: "" }) },
                { k: "du", label: "Tồn", f: "qty", v: (r) => hq(r.du) },
              ]}
              dong={ds}
              khongSap
              chinh="du"
              xemGiaVon={xemGiaVon}
              xuatRef={xuatRef}
            />
          )
        }
      }
    } else if (view === "pgroup" || view === "brand" || view === "ncc") {
      type D = DongBang & { k: string; giaTri: number; n: number }
      const m = new Map<string, D>()
      for (const x of ton) {
        const p = dm.sp.get(x.sp)
        const k = (view === "pgroup" ? p?.nhom : view === "brand" ? p?.thuongHieu : p?.ncc) || CHUA_CO
        const g = m.get(k) || { k, _n: view === "ncc" ? tenGiaTri(dm, "ncc", k) : k, giaTri: 0, n: 0 }
        g.giaTri += x.giaTri
        g.n += 1
        m.set(k, g)
      }
      const tong = ton.reduce((s, x) => s + x.giaTri, 0)
      bang = (
        <BangBaoCao<D>
          khoa={`kho:${view}`}
          tieuDe={`Theo ${XEM[view].toLowerCase()}`}
          cotDau={XEM[view]}
          cot={[giaTriCot<{ k: string; giaTri: number; n: number }>(), { k: "share", label: "% tổng", f: "share", v: (x) => x.giaTri, cost: true }, { k: "n", label: "Số mặt hàng", f: "int", v: (x) => x.n }]}
          dong={Array.from(m.values())}
          tong={{ _n: "Tổng", k: "", giaTri: tong, n: ton.length }}
          coSo={tong || 1}
          sapMacDinh={xemGiaVon ? { k: "giaTri", dir: -1 } : { k: "_n", dir: 1 }}
          chinh={xemGiaVon ? "giaTri" : "n"}
          onDong={(x) => () => daoThem({ l: x._n, v: "current", f: { [view]: x.k } })}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    }
    return { kpis, bang, bieuDo, ten }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nap.data, dm, bd.data, bd.loi, bd.dangTai, JSON.stringify(E), view, a, b, xemGiaVon, homNay])

  const goc = (st.xem || "current") as XemGoc
  const dao: MatDao[] = [{ label: `Kho · ${XEM[goc]}`, onClick: () => veBuoc(0) }, ...st.dao.map((s, i) => ({ label: s.l, onClick: () => veBuoc(i + 1) }))]
  const loai: LoaiLoc[] = ["prod", "pgroup", "brand", "ncc"]
  return (
    <KhungBaoCao
      href="/bao-cao/kho"
      role={bc.user?.role}
      dao={dao}
      onBoDao={() => veBuoc(0)}
      onXuat={bc.xuatFile ? () => xuatExcel(`Kho · ${vm?.ten || ""} · ${theoKy ? `${tenKy(st.ky)} ${nhanKhoang(a, b)}` : ngayThang(homNay)}`, xuatRef.current?.()) : null}
      thanhLoc={
        <ThanhLoc
          che={theoKy ? "range" : "static"}
          nhanTinh={`Số tại ${ngayDu(homNay)} · ${nap.capNhat || "—"} · không theo kỳ`}
          homNay={homNay}
          maKy={st.ky}
          ca={st.ca}
          cb={st.cb}
          onKy={(ky, ca, cb) => dat({ ky, ca: ca ?? null, cb: cb ?? null, dao: st.dao.filter((x) => x.v !== "card") })}
          loai={loai}
          loc={st.loc}
          luaChon={(k) => luaChonLoc(dm, k)}
          onLoc={(k, vals) => dat({ loc: { ...st.loc, [k]: vals } })}
          onBoHet={() => dat({ loc: {} })}
          capNhat={nap.capNhat}
          onTaiLai={() => (nap.taiLai(), bd.taiLai())}
        />
      }
    >
      {bc.loading || (nap.dangTai && !vm) ? (
        <DangTai soThe={5} />
      ) : nap.loi ? (
        <LoiDocSo text={`Đọc tồn kho hỏng: ${nap.loi}. Màn này không hiện số 0 thay cho phần lỗi.`} onThuLai={nap.taiLai} />
      ) : vm ? (
        <>
          {(nap.data?.thieu || bd.data?.thieu) && <ChuaDu text="Số liệu quá lớn, đang hiện 20.000 dòng đầu — thêm lọc để thu hẹp." />}
          <HangKpi kpis={vm.kpis} />
          <GhiChu
            text={`Ngưỡng: sắp hết hạn ≤ ${NGUONG_KHO.hetHan} ngày · tồn thấp khi đủ bán < ${NGUONG_KHO.tonThap} ngày · chậm bán khi ${NGUONG_KHO.khongBan} ngày không bán hoặc cần > ${NGUONG_KHO.banHet} ngày mới bán hết.`}
          />
          <HangChon nhan="Xem theo" ds={(Object.keys(XEM) as XemGoc[]).map((v) => ({ k: v, label: XEM[v], on: v === goc && !st.dao.length, onClick: () => doiXem(v) }))} />
          {vm.bieuDo}
          {vm.bang}
        </>
      ) : null}
    </KhungBaoCao>
  )
}
