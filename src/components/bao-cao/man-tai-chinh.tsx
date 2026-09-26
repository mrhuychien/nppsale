"use client"

/**
 * MÀN 6 — TÀI CHÍNH (`/bao-cao/tai-chinh`). Spec mục 8, thiết kế 26/09/2026.
 * Ba tab: Kết quả kinh doanh (bậc thang, kỳ này · kỳ trước · chênh lệch; "Theo tháng" trải thành
 * cột) · Dòng tiền (+ biểu đồ thu / chi) · Tài sản – Nguồn vốn (tại một ngày).
 * Không có "Thêm lọc": số toàn NPP. Lãi lỗ / dòng tiền / tồn quỹ qua các hàm cộng sổ ở database.
 */
import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useBaoCao } from "@/hooks/use-bao-cao"
import { KhungBaoCao, type MatDao } from "./khung"
import { ThanhLoc } from "./thanh-loc"
import { HangKpi, CongTacDoan, DangTai, LoiDocSo, GhiChu, type TheKpi } from "./khoi"
import { BieuDoCot } from "./bieu-do"
import { BangBaoCao, type CotBang, type DongBang } from "./bang"
import { XemNhanhChungTu, type ChungTuMo } from "./xem-nhanh"
import { useNap, layDanhMuc, xuatExcel } from "./dung-chung"
import { createClient } from "@/lib/supabase/client"
import { kyTheoMa, chiaThoiGian, doHat, nhanKhoang, ngayDu, tenKy } from "@/lib/bao-cao/ky"
import { hieuLuc, lienKetMan, MAC_DINH_MAN } from "@/lib/bao-cao/trang-thai"
import { soGon, soDu, phanTram, soSanh } from "@/lib/bao-cao/so"
import { napKetQuaKd, napDongTien, napKhoanThu, napPhieuChi, type KetQuaKd, type DongTien } from "@/lib/bao-cao/nap-tien"
import { napCongNo } from "@/lib/bao-cao/nap-cong-no"
import { fetchBalanceSheet, fetchCashFlow } from "@/lib/finance"
import { GIAI_THICH } from "@/lib/bao-cao/giai-thich"

type Tab = "pl" | "cash" | "bs"
const TEN_TAB: Record<Tab, string> = { pl: "Kết quả kinh doanh", cash: "Dòng tiền", bs: "Tài sản – Nguồn vốn" }

interface DongTc extends DongBang {
  nay: number | null
  truoc: number | null
  /** 1 = tăng là tốt, −1 = tăng là xấu (chi phí, giá vốn…). */
  chieu: 1 | -1
  bam?: () => void
  [thang: string]: unknown
}

export function ManTaiChinh() {
  const bc = useBaoCao("reports", MAC_DINH_MAN["/bao-cao/tai-chinh"])
  const { st, dat, daoThem, veBuoc, homNay, xemGiaVon, orgId } = bc
  const router = useRouter()
  const tab = (["pl", "cash", "bs"].includes(st.tab) ? st.tab : "pl") as Tab
  const E = hieuLuc(st, tab, null)
  const ky = kyTheoMa(st.ky, homNay, st.ca, st.cb)
  const { a, b } = ky
  const cmp = st.soSanh ? ky.cmp : null
  const X = st.den || homNay
  const theoThang = tab === "pl" && st.theoThang
  const [ct, setCt] = useState<ChungTuMo | null>(null)
  const xuatRef = useRef<(() => (string | number)[][]) | null>(null)

  const nap = useNap(
    orgId
      ? async () => {
          const sb = createClient()
          if (E.xem === "docs") {
            const [x, y] = E.khoang || [a, b]
            const kind = String(E.co.kind)
            if (kind === "thu") return { loai: "docs" as const, thu: (await napKhoanThu(sb, x, y)).ds.filter((t) => !E.co.hinhThuc || t.hinhThuc === E.co.hinhThuc || (E.co.hinhThuc === "khac" && t.hinhThuc !== "Tiền mặt")), chi: [] }
            const chi = (await napPhieuChi(sb, orgId, x, y, kind !== "chiPhi")).ds.filter((c) => (kind === "ncc" ? c.loai === "ncc" : c.loai === "chi" && (!E.co.nhom || c.nhom === E.co.nhom)))
            return { loai: "docs" as const, thu: [], chi }
          }
          if (tab === "pl") {
            if (theoThang) {
              const nam = homNay.slice(0, 4)
              const thang = chiaThoiGian(`${nam}-01-01`, homNay, "month")
              const kq = await Promise.all(thang.map((t) => napKetQuaKd(sb, orgId, t.r[0], t.r[1])))
              return { loai: "plm" as const, thang, kq, ca: await napKetQuaKd(sb, orgId, `${nam}-01-01`, homNay) }
            }
            const [nay, truoc] = await Promise.all([napKetQuaKd(sb, orgId, a, b), cmp ? napKetQuaKd(sb, orgId, cmp[0], cmp[1]) : null])
            return { loai: "pl" as const, nay, truoc }
          }
          if (tab === "cash") {
            const g = doHat(a, b) === "month" ? "month" : "week"
            const cot = chiaThoiGian(a, b, g)
            const [nay, truoc, luong] = await Promise.all([
              napDongTien(sb, orgId, a, b),
              cmp ? napDongTien(sb, orgId, cmp[0], cmp[1]) : null,
              Promise.all(cot.map((t) => fetchCashFlow(sb, orgId, { from: t.r[0], to: t.r[1] }))),
            ])
            return { loai: "cash" as const, nay, truoc, cot, luong }
          }
          const { dm } = await layDanhMuc(orgId)
          const [bs, no] = await Promise.all([fetchBalanceSheet(sb, orgId, X), napCongNo(sb, orgId, X, dm)])
          return { loai: "bs" as const, bs, phaiThu: no.khach.reduce((s, k) => s + k.no, 0) }
        }
      : null,
    `${orgId}|${tab}|${a}|${b}|${cmp?.[0] ?? ""}|${theoThang}|${X}|${JSON.stringify(st.dao)}`
  )

  const vm = useMemo(() => {
    const d = nap.data
    if (!d) return null
    const sangBan = () => router.push(lienKetMan("/bao-cao/ban-hang", { ky: st.ky, ca: st.ca, cb: st.cb, xem: "time" }))
    const chiPhi = (nhom?: string) => () => daoThem({ l: nhom || "Chi phí", v: "docs", f: { kind: "chiPhi", ...(nhom ? { nhom } : {}), range: [a, b] } })
    if (d.loai === "docs") {
      type D = DongBang & { id: string; ngay: string; doiTuong: string; dien: string; tien: number; mo: ChungTuMo | null }
      const ds: D[] = [
        ...d.thu.map((t) => ({ _n: t.maHd ? `Thu ${t.maHd}` : "Khoản thu", id: t.id, ngay: t.ngay, doiTuong: "", dien: t.hinhThuc, tien: t.tien, mo: { loai: "thu" as const, id: t.id } })),
        ...d.chi.map((c) => ({ _n: c.ma || (c.loai === "ncc" ? "Trả NCC" : "Phiếu chi"), id: c.id, ngay: c.ngay, doiTuong: c.nhom, dien: c.dien, tien: c.tien, mo: c.loai === "chi" ? { loai: "chi" as const, id: c.id } : null })),
      ]
      return {
        kpis: [] as TheKpi[],
        bang: (
          <BangBaoCao<D>
            khoa={`tc:docs:${JSON.stringify(E.co)}`}
            tieuDe="Chứng từ"
            phu={`${ds.length} chứng từ`}
            cotDau="Chứng từ"
            cot={[
              { k: "ngay", label: "Ngày", f: "date", v: (r) => r.ngay },
              { k: "doiTuong", label: "Đối tượng", f: "text", v: (r) => r.doiTuong },
              { k: "dien", label: "Diễn giải", f: "text", v: (r) => r.dien },
              { k: "tien", label: "Số tiền", f: "money", v: (r) => r.tien, bold: true },
            ]}
            dong={ds}
            tong={{ _n: "Tổng", tien: ds.reduce((s, r) => s + r.tien, 0) } as D}
            sapMacDinh={{ k: "ngay", dir: -1 }}
            chinh="tien"
            onDong={(r) => (r.mo ? () => setCt(r.mo) : null)}
            xemGiaVon={xemGiaVon}
            xuatRef={xuatRef}
          />
        ),
        bieuDo: null,
      }
    }
    if (d.loai === "pl" || d.loai === "plm") {
      const dong = (k: KetQuaKd): [string, number, boolean, 1 | -1, (() => void) | undefined, string, boolean][] => [
        ["Doanh thu bán ra", k.rev, false, 1, sangBan, "", false],
        ["− Hàng trả", k.ret, false, -1, sangBan, "", false],
        ["= Doanh thu thuần", k.net, true, 1, sangBan, "", false],
        ["− Giá vốn", k.cogs, false, -1, undefined, "", false],
        ["= Lãi gộp", k.gp, true, 1, undefined, `Biên ${phanTram(k.net ? k.gp / k.net : 0)}`, false],
        ["− Chi phí", k.tongChi, false, -1, chiPhi(), "", false],
        ...Array.from(k.chi.entries())
          .sort((x, y) => y[1] - x[1])
          .map(([n, v]): [string, number, boolean, 1 | -1, (() => void) | undefined, string, boolean] => [n, v, false, -1, chiPhi(n), "", true]),
        ["= Lãi thuần", k.lai, true, 1, undefined, `Biên ${phanTram(k.net ? k.lai / k.net : 0)}`, false],
      ]
      if (d.loai === "plm") {
        const ten = dong(d.ca).map((r) => r[0])
        const ds: DongTc[] = dong(d.ca).map(([n, v, bold, chieu, bam, sub, indent], i) => {
          const o: DongTc = { _n: n, _sub: sub, _bold: bold, _indent: indent, _s: i, nay: v, truoc: null, chieu, bam }
          d.kq.forEach((k, j) => {
            const r = dong(k).find((x) => x[0] === ten[i])
            o["m" + j] = r ? r[1] : 0
          })
          return o
        })
        const cot: CotBang<DongTc>[] = [...d.thang.map((t, j) => ({ k: "m" + j, label: "Th" + Number(t.k.slice(5, 7)), f: "money" as const, v: (r: DongTc) => r["m" + j] as number })), { k: "nay", label: "Cộng", f: "money", v: (r) => r.nay, bold: true }]
        return {
          kpis: [] as TheKpi[],
          bieuDo: null,
          bang: (
            <BangBaoCao<DongTc>
              khoa="tc:plm"
              tieuDe="Kết quả kinh doanh theo tháng"
              phu={`Năm ${homNay.slice(0, 4)} · tháng ${Number(homNay.slice(5, 7))} tính đến ${ngayDu(homNay)}`}
              cotDau="Chỉ tiêu"
              cot={cot}
              dong={ds}
              khongSap
              chinh="nay"
              onDong={(r) => r.bam || null}
              xemGiaVon
              xuatRef={xuatRef}
            />
          ),
        }
      }
      const nay = d.nay
      const truoc = d.truoc
      const dsNay = dong(nay)
      const dsTruoc = truoc ? dong(truoc) : null
      const ds: DongTc[] = dsNay.map(([n, v, bold, chieu, bam, sub, indent], i) => ({
        _n: n,
        _sub: sub,
        _bold: bold,
        _indent: indent,
        _s: i,
        nay: v,
        truoc: dsTruoc ? dsTruoc.find((x) => x[0] === n)?.[1] ?? 0 : null,
        chieu,
        bam,
      }))
      const cot: CotBang<DongTc>[] = [
        { k: "nay", label: "Kỳ này", f: "money", v: (r) => r.nay, bold: true },
        ...(truoc
          ? ([
              { k: "truoc", label: "Kỳ trước", f: "money", v: (r) => r.truoc },
              {
                k: "cl",
                label: "Chênh lệch",
                f: "money",
                v: (r) => (r.nay ?? 0) - (r.truoc ?? 0),
                render: (r) => {
                  const c = (r.nay ?? 0) - (r.truoc ?? 0)
                  return { t: `${c > 0 ? "+" : ""}${soDu(c)}`, tone: c === 0 ? "muted" : (c > 0) === (r.chieu > 0) ? "success" : "danger" }
                },
              },
            ] as CotBang<DongTc>[])
          : []),
      ]
      return {
        kpis: [
          { id: "net", label: "Doanh thu thuần", value: soGon(nay.net), info: GIAI_THICH.net, delta: soSanh(nay.net, truoc?.net, true) },
          { id: "gp", label: "Lãi gộp", value: soGon(nay.gp), info: GIAI_THICH.gp, sub: `Biên ${phanTram(nay.net ? nay.gp / nay.net : 0)}`, delta: soSanh(nay.gp, truoc?.gp, true) },
          { id: "ex", label: "Chi phí", value: soGon(nay.tongChi), delta: soSanh(nay.tongChi, truoc?.tongChi, false), onClick: chiPhi() },
          { id: "np", label: "Lãi thuần", value: soGon(nay.lai), sub: `Biên ${phanTram(nay.net ? nay.lai / nay.net : 0)}`, tone: nay.lai < 0 ? "danger" : undefined, delta: soSanh(nay.lai, truoc?.lai, true) },
        ] as TheKpi[],
        bieuDo: null,
        bang: (
          <BangBaoCao<DongTc>
            khoa="tc:pl"
            tieuDe="Kết quả kinh doanh"
            phu={`${nhanKhoang(a, b)}${cmp ? ` · so với ${nhanKhoang(cmp[0], cmp[1])}` : ""}`}
            cotDau="Chỉ tiêu"
            cot={cot}
            dong={ds}
            khongSap
            chinh="nay"
            onDong={(r) => r.bam || null}
            xemGiaVon
            xuatRef={xuatRef}
          />
        ),
      }
    }
    if (d.loai === "cash") {
      const docThu = (l: string, hinhThuc: string) => () => daoThem({ l, v: "docs", f: { kind: "thu", hinhThuc, range: [a, b] } })
      const rows = (t: DongTien): [string, number, boolean, (() => void) | undefined, boolean, 1 | -1][] => [
        ["Tồn quỹ đầu kỳ", t.dau, true, undefined, false, 1],
        ["+ Thu từ khách", t.thuTm + t.thuCk, true, undefined, false, 1],
        ["Tiền mặt", t.thuTm, false, docThu("Thu tiền mặt", "Tiền mặt"), true, 1],
        ["Chuyển khoản", t.thuCk, false, docThu("Thu chuyển khoản", "khac"), true, 1],
        ["− Trả nhà cung cấp", t.ncc, false, () => daoThem({ l: "Trả NCC", v: "docs", f: { kind: "ncc", range: [a, b] } }), false, -1],
        ["− Chi phí", t.chi, false, () => daoThem({ l: "Chi phí", v: "docs", f: { kind: "chi", range: [a, b] } }), false, -1],
        ["= Tồn quỹ cuối kỳ", t.cuoi, true, undefined, false, 1],
      ]
      const tr = d.truoc ? rows(d.truoc) : null
      const ds: DongTc[] = rows(d.nay).map(([n, v, bold, bam, indent, chieu], i) => ({ _n: n, _bold: bold, _indent: indent, _s: i, nay: v, truoc: tr ? tr[i][1] : null, chieu, bam }))
      return {
        kpis: [
          { id: "ci", label: "Thu từ khách", value: soGon(d.nay.thuTm + d.nay.thuCk), delta: soSanh(d.nay.thuTm + d.nay.thuCk, d.truoc ? d.truoc.thuTm + d.truoc.thuCk : null, true) },
          { id: "co", label: "Chi ra", value: soGon(d.nay.ncc + d.nay.chi), delta: soSanh(d.nay.ncc + d.nay.chi, d.truoc ? d.truoc.ncc + d.truoc.chi : null, false) },
          { id: "cc", label: "Tồn quỹ cuối kỳ", value: soGon(d.nay.cuoi), info: GIAI_THICH.cashEnd },
        ] as TheKpi[],
        bieuDo: (
          <BieuDoCot
            tieuDe={`Thu / chi theo ${d.cot.length && d.cot[0].label.startsWith("Tháng") ? "tháng" : "tuần"}`}
            chuGiai={[{ label: "Thu", kieu: "cot" }, { label: "Chi", kieu: "cot2" }]}
            cot={d.cot.map((t, i) => {
              const f = d.luong[i].operating
              return { label: t.label.replace("Tuần ", ""), v: f.cashFromCustomers, v2: f.cashToSuppliers + f.cashToExpenses, title: `${t.sub}: thu ${soDu(f.cashFromCustomers)} / chi ${soDu(f.cashToSuppliers + f.cashToExpenses)}` }
            })}
          />
        ),
        bang: (
          <BangBaoCao<DongTc>
            khoa="tc:cash"
            tieuDe="Dòng tiền"
            phu={nhanKhoang(a, b)}
            cotDau="Chỉ tiêu"
            cot={[{ k: "nay", label: "Kỳ này", f: "money", v: (r) => r.nay, bold: true }, ...(tr ? [{ k: "truoc", label: "Kỳ trước", f: "money", v: (r: DongTc) => r.truoc } as CotBang<DongTc>] : [])]}
            dong={ds}
            khongSap
            chinh="nay"
            onDong={(r) => r.bam || null}
            xemGiaVon
            xuatRef={xuatRef}
          />
        ),
      }
    }
    // Tài sản – Nguồn vốn
    const bs = d.bs
    const ts = bs.assets.cash + d.phaiThu + bs.assets.inventory
    const npt = bs.liabilities.accountsPayable + bs.liabilities.unpaidExpenses
    const ds: DongTc[] = [
      { _n: "Tài sản", _bold: true, nay: ts, truoc: null, chieu: 1 },
      { _n: "Tiền", _indent: true, nay: bs.assets.cash, truoc: null, chieu: 1 },
      { _n: "Phải thu khách", _indent: true, nay: d.phaiThu, truoc: null, chieu: 1, bam: () => router.push(lienKetMan("/bao-cao/cong-no", { den: X === homNay ? null : X })) },
      { _n: "Hàng tồn kho", _indent: true, nay: bs.assets.inventory, truoc: null, chieu: 1, bam: () => router.push(lienKetMan("/bao-cao/kho", {})) },
      { _n: "Nguồn vốn", _bold: true, nay: ts, truoc: null, chieu: 1 },
      { _n: "Phải trả nhà cung cấp", _indent: true, nay: bs.liabilities.accountsPayable, truoc: null, chieu: -1 },
      { _n: "Chi phí chưa trả", _indent: true, nay: bs.liabilities.unpaidExpenses, truoc: null, chieu: -1 },
      { _n: "Vốn chủ (phần chênh)", _indent: true, nay: ts - npt, truoc: null, chieu: 1 },
    ].map((x, i) => ({ ...x, _s: i }) as DongTc)
    return {
      kpis: [
        { id: "ta", label: "Tổng tài sản", value: soGon(ts) },
        { id: "ap", label: "Phải trả NCC", value: soGon(bs.liabilities.accountsPayable) },
        { id: "eq", label: "Vốn chủ", value: soGon(ts - npt), tone: ts - npt < 0 ? "danger" : undefined },
      ] as TheKpi[],
      bieuDo: null,
      bang: (
        <BangBaoCao<DongTc>
          khoa="tc:bs"
          tieuDe="Tài sản – Nguồn vốn"
          phu={`Tính đến ${ngayDu(X)}`}
          cotDau="Khoản mục"
          cot={[
            { k: "nay", label: "Số tiền", f: "money", v: (r) => r.nay, bold: true },
            { k: "share", label: "% tổng", f: "share", v: (r) => r.nay },
          ]}
          dong={ds}
          coSo={ts || 1}
          khongSap
          chinh="nay"
          onDong={(r) => r.bam || null}
          xemGiaVon
          xuatRef={xuatRef}
        />
      ),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nap.data, a, b, X, xemGiaVon])

  const dao: MatDao[] = [{ label: `Tài chính · ${TEN_TAB[tab]}`, onClick: () => veBuoc(0) }, ...st.dao.map((s, i) => ({ label: s.l, onClick: () => veBuoc(i + 1) }))]
  const laDocs = E.xem === "docs"
  return (
    <KhungBaoCao
      href="/bao-cao/tai-chinh"
      role={bc.user?.role}
      dao={dao}
      onBoDao={() => veBuoc(0)}
      onXuat={bc.xuatFile ? () => xuatExcel(`Tài chính · ${TEN_TAB[tab]} · ${tab === "bs" ? "đến " + ngayDu(X) : tenKy(st.ky) + " " + nhanKhoang(a, b)}`, xuatRef.current?.()) : null}
      thanhLoc={
        <ThanhLoc
          che={tab === "bs" ? "asof" : theoThang ? "static" : "range"}
          nhanTinh={`Năm ${homNay.slice(0, 4)} · các tháng trải thành cột`}
          homNay={homNay}
          maKy={st.ky}
          ca={st.ca}
          cb={st.cb}
          onKy={(ky, ca, cb) => dat({ ky, ca: ca ?? null, cb: cb ?? null, dao: [] })}
          ngay={X}
          onNgay={(n) => dat({ den: n === homNay ? null : n })}
          soSanh={tab !== "bs" && !theoThang ? { bat: st.soSanh, nhan: "So với kỳ trước", onDoi: () => dat({ soSanh: !st.soSanh }) } : null}
          loai={[]}
          loc={{}}
          luaChon={() => []}
          onLoc={() => undefined}
          onBoHet={() => undefined}
          capNhat={nap.capNhat}
          onTaiLai={nap.taiLai}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <CongTacDoan<Tab>
          className="w-full lg:w-[420px]"
          ds={[
            { value: "pl", label: "Kết quả kinh doanh" },
            { value: "cash", label: "Dòng tiền" },
            { value: "bs", label: "Tài sản – Nguồn vốn" },
          ]}
          value={tab}
          onChange={(v) => dat({ tab: v, dao: [], theoThang: false })}
        />
        {tab === "pl" && !laDocs && (
          <CongTacDoan
            className="w-full lg:w-[220px]"
            ds={[
              { value: "p", label: "Kỳ đã chọn" },
              { value: "m", label: "Theo tháng" },
            ]}
            value={st.theoThang ? "m" : "p"}
            onChange={(v) => dat({ theoThang: v === "m" })}
          />
        )}
      </div>
      {bc.loading || (nap.dangTai && !vm) ? (
        <DangTai soThe={4} />
      ) : nap.loi ? (
        <LoiDocSo text={`Đọc số tài chính hỏng: ${nap.loi}. Màn này không hiện số 0 thay cho phần lỗi.`} onThuLai={nap.taiLai} />
      ) : vm ? (
        <>
          <HangKpi kpis={vm.kpis} />
          <GhiChu text="Số toàn NPP, không có lọc." />
          {vm.bieuDo}
          {vm.bang}
        </>
      ) : null}
      <XemNhanhChungTu ct={ct} onDong={() => setCt(null)} />
    </KhungBaoCao>
  )
}

