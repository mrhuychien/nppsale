import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { soChiTietNoNcc, type TraTienNo } from "@/lib/payables/so-chi-tiet-ncc"
import { tongNoNcc, type DongSoNoNcc, type LoaiDongNoNcc } from "@/lib/payables/so-no-ncc"

/**
 * Chủ nhà 08/11/2026: "phần chi tiết công nợ từng ncc chưa có dư nợ sau mỗi giao dịch, kiểm tra xem phần tiền thanh
 * toán cho ncc cũng chưa có trong công nợ". Tab Công nợ ở chi tiết NCC thành SỔ CHI TIẾT: mỗi giao dịch (phiếu nhập,
 * trả NCC, nợ đầu kỳ, phiếu chi, trả tiền) một dòng + dư nợ sau giao dịch; dòng cuối = dư nợ hiện tại.
 */
const doc = (p: string) => readFileSync(p, "utf8")

function khoan(
  id: string, loai: LoaiDongNoNcc, ma: string, amount: number, paid: number, created_at: string, status?: string
): DongSoNoNcc {
  const st = status ?? (amount > 0 && paid >= amount ? "paid" : paid > 0 ? "partial" : "open")
  return {
    id, amount, paid, status: st, due_date: null, created_at, invoice_number: null, opening_balance: loai === "dau-ky",
    notes: null, loai, ma, href: `/x/${id}`, conLai: amount - paid,
  }
}
const tra = (id: string, payable_id: string, amount: number, paid_at: string, supplier_payment_id: string | null = null, method = "cash"): TraTienNo =>
  ({ id, payable_id, amount, method, paid_at, supplier_payment_id })

/**
 * Sổ mẫu (luật mig 242): nợ đầu kỳ 100.000 (01/09) · phiếu nhập PN-1 300.000 (10/09) · trả thẳng 80.000 vào PN-1 (12/09)
 * · trả NCC TN-1 −50.000 (15/09) · phiếu chi PCNCC-1 400.000 (20/09): trừ đầu kỳ 100.000, PN-1 220.000, dư 80.000 thành
 * trả trước (dòng amount 0, paid 80.000).
 */
const NO = [
  khoan("dk", "dau-ky", "Nợ đầu kỳ", 100000, 100000, "2026-09-01T03:00:00Z"),
  khoan("pn1", "phieu-nhap", "PN-1", 300000, 300000, "2026-09-10T03:00:00Z"),
  khoan("tn1", "tra-ncc", "TN-1", -50000, 0, "2026-09-15T03:00:00Z", "open"),
  khoan("tt1", "tra-truoc", "PCNCC-1", 0, 80000, "2026-09-20T05:00:00Z", "open"),
]
const TRA = [
  tra("pp-thang", "pn1", 80000, "2026-09-12T03:00:00Z"),
  tra("pp-a", "dk", 100000, "2026-09-20T05:00:00Z", "sp1"),
  tra("pp-b", "pn1", 220000, "2026-09-20T05:00:00Z", "sp1"),
  tra("pp-c", "tt1", 80000, "2026-09-20T05:00:00Z", "sp1"),
]
const PHIEU = [{ id: "sp1", code: "PCNCC-1", method: "transfer" }]

describe("sổ chi tiết công nợ NCC", () => {
  const so = soChiTietNoNcc(NO, TRA, PHIEU)

  it("mỗi giao dịch một dòng, mới trước, dư nợ sau từng giao dịch; tiền trả là dòng của sổ", () => {
    expect(so.dong.map((d) => [d.ma, d.tang, d.giam, d.duNo])).toEqual([
      ["PCNCC-1", 0, 400000, -130000],
      ["TN-1", 0, 50000, 270000],
      ["PN-1", 0, 80000, 320000],
      ["PN-1", 300000, 0, 400000],
      ["Nợ đầu kỳ", 100000, 0, 100000],
    ])
    expect(so.dong.map((d) => d.loai)).toEqual(["phieu-chi", "tra-ncc", "tra-tien", "phieu-nhap", "dau-ky"])
    expect(so.dong.map((d) => d.dienGiai)).toEqual([
      "Phiếu chi trả NCC · Chuyển khoản", "Trả hàng NCC", "Trả tiền NCC · Tiền mặt", "Phiếu nhập hàng", "Nợ đầu kỳ",
    ])
  })

  it("dư nợ cuối = dư nợ hiện tại (`tongNoNcc`): NCC đang giữ 130.000 của mình (trả NCC 50.000 + trả trước 80.000)", () => {
    expect(so.duNoCuoi).toBe(-130000)
    expect(so.duNoCuoi).toBe(tongNoNcc(NO))
  })

  it("phiếu chi chia vào nhiều khoản (kể cả phần trả trước) là MỘT dòng đủ số tiền; dòng trả trước không đếm lần nữa", () => {
    const pc = so.dong.filter((d) => d.loai === "phieu-chi")
    expect(pc).toHaveLength(1)
    expect(pc[0]).toMatchObject({ giam: 400000, href: "/finance/phieu-chi-ncc/sp1", dienGiai: "Phiếu chi trả NCC · Chuyển khoản" })
    expect(pc[0].trangThai.nhan).toBe("Đã chi · trả trước 80.000đ")
    expect(so.dong.some((d) => d.ma === "PCNCC-1" && d.loai !== "phieu-chi")).toBe(false)
  })

  it("trả thẳng vào một khoản (Ghi trả NCC): dòng riêng mang mã khoản, dẫn về khoản nợ", () => {
    const t = so.dong.find((d) => d.loai === "tra-tien")!
    expect(t).toMatchObject({ ma: "PN-1", giam: 80000, href: "/payables/pn1", dienGiai: "Trả tiền NCC · Tiền mặt" })
  })

  it("khoản nợ mang trạng thái của nó; khoản trả một phần ghi còn bao nhiêu; dòng trả NCC là 'Trừ vào nợ'", () => {
    const s2 = soChiTietNoNcc([khoan("pn2", "phieu-nhap", "PN-2", 500000, 200000, "2026-10-01T03:00:00Z")], [tra("p", "pn2", 200000, "2026-10-02T03:00:00Z")])
    const pn2 = s2.dong.find((d) => d.loai === "phieu-nhap")!
    expect(pn2.trangThai).toEqual({ nhan: "Thanh toán một phần", tone: "warning" })
    expect(pn2.conLai).toBe(300000)
    expect(so.dong.find((d) => d.loai === "tra-ncc")!.trangThai.nhan).toBe("Trừ vào nợ")
    expect(so.dong.find((d) => d.loai === "phieu-nhap")!.conLai).toBeUndefined()
  })

  it("nợ đầu kỳ đứng đầu sổ dù nhập sau phiếu nhập (số dư mang sang là điểm xuất phát)", () => {
    const s2 = soChiTietNoNcc([
      khoan("pn", "phieu-nhap", "PN-9", 200000, 0, "2026-09-05T03:00:00Z"),
      khoan("dk2", "dau-ky", "Nợ đầu kỳ", 1000000, 0, "2026-10-01T03:00:00Z"),
    ], [])
    expect(s2.dong.map((d) => [d.ma, d.duNo])).toEqual([["PN-9", 1200000], ["Nợ đầu kỳ", 1000000]])
  })

  it("đã trả mà không có phiếu chi (nợ đầu kỳ nhập sẵn số đã trả) → dòng 'Đã thanh toán — không có phiếu chi' ngay sau khoản ấy", () => {
    const rows = [khoan("dk3", "dau-ky", "Nợ đầu kỳ", 1000000, 400000, "2026-09-01T03:00:00Z")]
    const s2 = soChiTietNoNcc(rows, [])
    expect(s2.dong.map((d) => [d.loai, d.tang, d.giam, d.duNo])).toEqual([
      ["tra-san", 0, 400000, 600000],
      ["dau-ky", 1000000, 0, 1000000],
    ])
    expect(s2.duNoCuoi).toBe(tongNoNcc(rows))
  })

  it("trả cùng lúc với một khoản nợ: khoản nợ ghi trước, tiền trả sau", () => {
    const s2 = soChiTietNoNcc([khoan("pn", "phieu-nhap", "PN-3", 100000, 100000, "2026-09-05T03:00:00Z")], [tra("p", "pn", 100000, "2026-09-05T03:00:00Z")])
    expect(s2.dong.map((d) => [d.loai, d.duNo])).toEqual([["tra-tien", 0], ["phieu-nhap", 100000]])
  })

  it("không có phiếu nào → sổ rỗng, dư 0", () => {
    expect(soChiTietNoNcc([], [])).toEqual({ dong: [], duNoCuoi: 0 })
  })
})

/**
 * Mô phỏng ĐÚNG luật máy chủ (mig 242 `chi_tra_ncc` + `_don_tra_truoc_ncc`, mig 167 `record_payable_payment`) trên nhiều
 * chuỗi giao dịch giả: dư nợ cuối sổ phải luôn bằng `tongNoNcc`, và mỗi dòng = dòng trước + tăng − giảm.
 */
describe("sổ chi tiết: dư nợ cuối luôn khớp sổ nợ (mô phỏng luật máy chủ)", () => {
  function moPhong(seed: number) {
    let s = seed
    const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
    const no: DongSoNoNcc[] = []
    const traTien: TraTienNo[] = []
    const phieu: Array<{ id: string; code: string; method: string }> = []
    let gio = Date.parse("2026-09-01T00:00:00Z")
    const luc = () => new Date((gio += 3600_000 * (1 + Math.floor(rand() * 30)))).toISOString()
    let n = 0
    const moi = () => `x${++n}`
    const conNo = (r: DongSoNoNcc) => r.amount - r.paid
    const tinhTrangThai = (r: DongSoNoNcc) => {
      r.status = r.amount > 0 ? (r.paid >= r.amount ? "paid" : r.paid > 0 ? "partial" : "open") : "open"
    }
    const laTruoc = (r: DongSoNoNcc) => r.loai === "tra-truoc"
    const donTruoc = () => {
      for (const t of [...traTien].filter((x) => x.supplier_payment_id && laTruoc(no.find((r) => r.id === x.payable_id)!))) {
        let con = Number(t.amount)
        while (con > 0) {
          const d = no.filter((r) => !laTruoc(r) && conNo(r) > 0)
            .sort((a, b) => Number(b.opening_balance) - Number(a.opening_balance) || a.created_at.localeCompare(b.created_at))[0]
          if (!d) break
          const lay = Math.min(con, conNo(d))
          traTien.push({ id: moi(), payable_id: d.id, amount: lay, method: t.method, paid_at: t.paid_at, supplier_payment_id: t.supplier_payment_id })
          d.paid += lay; tinhTrangThai(d)
          const tr = no.find((r) => r.id === t.payable_id)!
          tr.paid -= lay
          con -= lay
        }
        if (con <= 0) traTien.splice(traTien.indexOf(t), 1)
        else t.amount = con
      }
      for (const r of [...no]) if (laTruoc(r) && r.paid <= 0 && !traTien.some((x) => x.payable_id === r.id)) no.splice(no.indexOf(r), 1)
    }
    if (rand() < 0.5) {
      const tien = 1000 * Math.floor(1 + rand() * 500)
      const san = rand() < 0.5 ? 1000 * Math.floor(rand() * (tien / 1000)) : 0
      no.push(khoan(moi(), "dau-ky", "Nợ đầu kỳ", tien, san, luc()))
    }
    for (let i = 0; i < 25; i++) {
      const x = rand()
      if (x < 0.4) {
        no.push(khoan(moi(), "phieu-nhap", `PN-${n}`, 1000 * Math.floor(1 + rand() * 900), 0, luc()))
        donTruoc()
      } else if (x < 0.55) {
        no.push(khoan(moi(), "tra-ncc", `TN-${n}`, -1000 * Math.floor(1 + rand() * 200), 0, luc(), "open"))
      } else if (x < 0.75) {
        const mo = no.filter((r) => !laTruoc(r) && conNo(r) > 0)
        if (mo.length) {
          const d = mo[Math.floor(rand() * mo.length)]
          const lay = Math.max(1, Math.floor(rand() * conNo(d)))
          traTien.push({ id: moi(), payable_id: d.id, amount: lay, method: "cash", paid_at: luc(), supplier_payment_id: null })
          d.paid += lay; tinhTrangThai(d)
        }
      } else {
        const tien = 1000 * Math.floor(1 + rand() * 1500)
        const spId = moi()
        const l = luc()
        phieu.push({ id: spId, code: `PCNCC-${n}`, method: "transfer" })
        const tt = khoan(moi(), "tra-truoc", `PCNCC-${n}`, 0, tien, l, "open")
        no.push(tt)
        traTien.push({ id: moi(), payable_id: tt.id, amount: tien, method: "transfer", paid_at: l, supplier_payment_id: spId })
        donTruoc()
      }
    }
    return { no, traTien, phieu }
  }

  it("200 chuỗi giao dịch: dư nợ cuối = tongNoNcc; dư từng dòng = dòng trước + tăng − giảm; phiếu chi một dòng", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { no, traTien, phieu } = moPhong(seed)
      const so = soChiTietNoNcc(no, traTien, phieu)
      expect(so.duNoCuoi, `chuỗi ${seed}`).toBeCloseTo(tongNoNcc(no), 2)
      const cu = [...so.dong].reverse()
      let du = 0
      for (const d of cu) {
        du += d.tang - d.giam
        expect(d.duNo, `chuỗi ${seed} dòng ${d.id}`).toBeCloseTo(du, 2)
      }
      const soPhieuCoTien = new Set(traTien.filter((t) => t.supplier_payment_id).map((t) => t.supplier_payment_id)).size
      expect(so.dong.filter((d) => d.loai === "phieu-chi")).toHaveLength(soPhieuCoTien)
    }
  })
})

describe("màn chi tiết NCC: tab Công nợ là sổ chi tiết", () => {
  const s = doc("src/app/(dashboard)/suppliers/[id]/page.tsx")

  it("dựng sổ từ sổ nợ + MỌI lần trả (kèm phiếu chi của từng phần) + phiếu chi NCC", () => {
    expect(s).toContain("const soChiTiet = useMemo(() => soChiTietNoNcc(soNo, traTien, phieuChiNcc), [soNo, traTien, phieuChiNcc])")
    expect(s).toContain('supabase.from("payable_payments").select("id, supplier_payment_id", { count: "exact" })')
    expect(s).toContain("setTraTien(chi.map((c) => ({ ...c, supplier_payment_id: phieuCuaPhan.get(c.id) ?? null })))")
    // Lịch sử giao dịch vẫn bỏ phần tiền của phiếu chi (phiếu đã là một dòng).
    expect(s).toContain("setPhieuChi(chi.filter((c) => !phieuCuaPhan.has(c.id)))")
  })

  it("cột Ngày · Chứng từ · Diễn giải · Tăng nợ · Giảm nợ · Dư nợ · Trạng thái; đầu tab ghi Dư nợ hiện tại", () => {
    const cot = Array.from(s.matchAll(/<TableHead className="[^"]*">([^<]+)<\/TableHead>/g), (m) => m[1])
    const i = cot.indexOf("Ngày")
    expect(cot.slice(i, i + 7)).toEqual(["Ngày", "Chứng từ", "Diễn giải", "Tăng nợ", "Giảm nợ", "Dư nợ", "Trạng thái"])
    expect(s).toContain('Dư nợ hiện tại <b className="tabular-nums text-foreground" data-testid="ncc-du-no-hien-tai">{formatCurrency(tongNo)}</b>')
    expect(s).not.toContain("Còn phải trả <b")
  })

  it("đọc lần trả tiền hỏng / sổ lệch thì nói ra, không để dư nợ từng dòng trông như đúng", () => {
    expect(s).toContain('loiTraTien = errorMessage(e, "Không đọc được các lần trả tiền NCC")')
    expect(s).toContain("{traTienLoi && (")
    expect(s).toContain("Math.abs(soChiTiet.duNoCuoi - tongNo) >= 1")
  })
})
