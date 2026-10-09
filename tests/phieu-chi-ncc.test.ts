import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"
import { fakePostgrest } from "./helpers/fake-postgrest"
import {
  chuaCoPhieuChiNcc, docPhanTruPhieuChi, dongChiCuaPhieuNcc, duocChiTraNcc, giaTriChiNccMoi, huyPhieuChiNcc,
  kiemPhieuChiNcc, lapPhieuChiNcc, loiPhieuChiNcc, napPhieuChiNcc, nhanHinhThucChiNcc, thongBaoChiNcc,
  type PhieuChiNcc,
} from "@/lib/payables/phieu-chi-ncc"
import { chungTuCuaNo, ghepChungTu, NHAN_LOAI_NO_NCC } from "@/lib/payables/so-no-ncc"
import { lichSuGiaoDich } from "@/lib/suppliers/chi-tiet"
import { gopPhanPhieuChiNcc, type PhieuChi } from "@/lib/bao-cao/nap-tien"
import { duocVaoTrang, mucChaCua } from "@/lib/nav/nav-permission"
import { getFeature } from "@/lib/permissions-features"

/**
 * PHIẾU CHI TRẢ NHÀ CUNG CẤP (mig 242).
 *
 * ⚠ CHỦ NHÀ 09/10/2026: "phiếu chi thêm phần chi cho ncc và chọn NCC là xong, phiếu chi xuất hiện xong giao dịch NCC là
 *   xong, ko nhất thiết phiếu chi phải chi trả đúng hóa đơn nào đó, có thể chi trả ncc 1 cục 200 triệu, nhiều hóa đơn nợ".
 * ⚠ Máy chủ chia tiền vào các khoản nợ CŨ NHẤT (nợ đầu kỳ trước); trả dư thành tiền trả trước, tự trừ vào phiếu nhập
 *   sau. Không đụng dòng âm của phiếu trả NCC. Không vào chi phí / lãi lỗ.
 *   Bộ thử chạy thật: scripts/sql/thu-242-phieu-chi-tra-ncc.sql (19/19 dưới safeupdate; thử phá 14 chỗ — đỏ cả 14).
 */
const GOC = resolve(__dirname, "..")
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf-8")
const HAM = hamDangChay()
const MIG = doc("supabase/migrations/242_phieu_chi_tra_ncc.sql")

describe("chi_tra_ncc (bản đang chạy)", () => {
  const h = HAM.get("public.chi_tra_ncc(UUID,NUMERIC,DATE,TEXT,TEXT,TEXT)")

  it("là bản mig 242; chỉ Chủ NPP / Kế toán; kiểm tiền, hình thức, NCC cùng NPP, ngày không sau hôm nay", () => {
    expect(h?.file).toBe("242_phieu_chi_tra_ncc.sql")
    expect(h!.than).toContain("IF COALESCE(public.user_role(), '') NOT IN ('owner', 'accountant') THEN")
    expect(h!.than).toContain("IF p_amount IS NULL OR p_amount <= 0 THEN")
    expect(h!.than).toContain("IF COALESCE(p_method, '') NOT IN ('cash', 'transfer') THEN")
    expect(h!.than).toContain("SELECT 1 FROM suppliers WHERE id = p_supplier_id AND org_id = v_org")
    expect(h!.than).toContain("IF v_ngay > public.vn_today() THEN")
  })

  it("đánh số PCNCC- theo NPP dưới khoá; ghi lùi ngày → 12:00 giờ VN của ngày ấy", () => {
    expect(h!.than).toContain("PERFORM pg_advisory_xact_lock(hashtext('supplier_payments:' || v_org::text));")
    expect(h!.than).toContain("v_code := 'PCNCC-' || public._so_chung_tu(v_seq);")
    expect(h!.than).toContain("ELSE (v_ngay + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh' END;")
  })

  it("cả số tiền vào dòng trả trước của chính phiếu (0 / số tiền / 'open') rồi dồn sang khoản nợ cũ nhất — không ghi chi phí", () => {
    expect(h!.than).toContain("VALUES (v_org, p_supplier_id, v_code, 0, p_amount, 'open', 'Trả trước NCC — phiếu chi ' || v_code, v_luc)")
    expect(h!.than).toContain("VALUES (v_line, p_amount, p_method, v_luc, v_uid, 'Phiếu chi ' || v_code || COALESCE(' — ' || v_ghi, ''), v_id);")
    expect(h!.than.indexOf("INSERT INTO payable_payments")).toBeLessThan(h!.than.indexOf("PERFORM public._don_tra_truoc_ncc(v_org, p_supplier_id);"))
    // Trả NCC là trả nợ, không phải chi phí — không vào lãi lỗ.
    expect(h!.than).not.toMatch(/INSERT INTO expenses/i)
  })
})

describe("_don_tra_truoc_ncc — chia tiền trả trước vào khoản nợ cũ nhất", () => {
  const h = HAM.get("public._don_tra_truoc_ncc(UUID,UUID)")

  it("khoá sổ nợ của NCC; khoản cũ nhất: nợ đầu kỳ trước, rồi ngày ghi nợ, rồi id", () => {
    expect(h?.file).toBe("242_phieu_chi_tra_ncc.sql")
    expect(h!.than).toContain("PERFORM 1 FROM payables WHERE org_id = p_org AND supplier_id = p_supplier ORDER BY id FOR UPDATE;")
    expect(h!.than).toContain("ORDER BY p.opening_balance DESC, p.created_at, p.id")
  })

  it("chỉ khoản CÒN PHẢI TRẢ (> 0): không đụng dòng âm của phiếu trả NCC, không lấy dòng trả trước làm khoản nợ", () => {
    expect(h!.than).toContain("AND p.amount - COALESCE(p.paid, 0) > 0")
    expect(h!.than).toContain("AND NOT EXISTS (SELECT 1 FROM supplier_payments s2 WHERE s2.prepay_payable_id = p.id)")
  })

  it("không lặp mãi; dòng trả trước hết tiền thì xoá", () => {
    expect(h!.than).toContain("v_lay := LEAST(v_con, d.amount - d.paid);")
    expect(h!.than).toContain("EXIT WHEN v_lay <= 0;")
    expect(h!.than).toMatch(/DELETE FROM payables p\s+USING supplier_payments sp\s+WHERE sp\.prepay_payable_id = p\.id/)
  })
})

describe("huy_phieu_chi_ncc / huỷ phiếu nhập / trigger khoản nợ mới", () => {
  it("huỷ: kiểm NPP + vai, bấm hai lần đứng yên, gỡ mọi phần đã trừ, rồi dồn lại tiền trả trước của phiếu khác", () => {
    const h = HAM.get("public.huy_phieu_chi_ncc(UUID,TEXT)")
    expect(h?.file).toBe("242_phieu_chi_tra_ncc.sql")
    expect(h!.than).toContain("IF v.org_id IS DISTINCT FROM public.user_org_id() THEN")
    expect(h!.than).toContain("IF COALESCE(public.user_role(), '') NOT IN ('owner', 'accountant') THEN")
    expect(h!.than).toMatch(/IF v\.status = 'cancelled' THEN\s+RETURN jsonb_build_object\([^)]*'da_huy', false/)
    expect(h!.than).toContain("DELETE FROM payable_payments WHERE supplier_payment_id = p_id;")
    expect(h!.than).toContain("PERFORM public._don_tra_truoc_ncc(v.org_id, v.supplier_id);")
  })

  it("huỷ phiếu nhập: phần phiếu chi trả về trả trước TRƯỚC khi kiểm DA_TRA_TIEN, xoá nợ xong thì dồn sang khoản khác", () => {
    const h = HAM.get("public.cancel_purchase_invoice(UUID,TEXT)")
    expect(h?.file).toBe("242_phieu_chi_tra_ncc.sql")
    const tra = h!.than.indexOf("PERFORM public._tra_phan_bo_ve_truoc(v_payable);")
    expect(tra).toBeGreaterThan(-1)
    expect(tra).toBeLessThan(h!.than.indexOf("RAISE EXCEPTION 'DA_TRA_TIEN:"))
    expect(h!.than).toMatch(/DELETE FROM payables WHERE id = v_payable;\s+(--[^\n]*\n\s+)?PERFORM public\._don_tra_truoc_ncc\(v_org, v_supplier\);/)
    // Giữ nguyên phần mig 238 (huỷ khi cho phép tồn âm).
    expect(h!.than).toContain("SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;")
  })

  it("_tra_phan_bo_ve_truoc: dòng trả trước đã xoá thì lập lại; chỉ phần của phiếu chi CÒN HIỆU LỰC", () => {
    const h = HAM.get("public._tra_phan_bo_ve_truoc(UUID)")
    expect(h?.file).toBe("242_phieu_chi_tra_ncc.sql")
    expect(h!.than).toContain("WHERE pp.payable_id = p_payable AND sp.status = 'posted'")
    expect(h!.than).toMatch(/IF v_line IS NULL THEN\s+INSERT INTO payables/)
    expect(h!.than).toContain("UPDATE payable_payments SET payable_id = v_line WHERE id = r.id;")
  })

  it("khoản nợ dương mới của NCC có tiền trả trước → tự dồn vào", () => {
    const h = HAM.get("public._trg_tra_truoc_vao_no_moi()")
    expect(h?.file).toBe("242_phieu_chi_tra_ncc.sql")
    expect(h!.than).toContain("PERFORM public._don_tra_truoc_ncc(NEW.org_id, NEW.supplier_id);")
    expect(MIG).toMatch(/CREATE TRIGGER trg_tra_truoc_vao_no_moi\s+AFTER INSERT ON public\.payables\s+FOR EACH ROW WHEN \(NEW\.amount > 0\)/)
  })

  it("quyền: hàm nội bộ đóng hết; RPC cho authenticated, không anon; bảng chỉ có chính sách ĐỌC", () => {
    for (const f of ["_don_tra_truoc_ncc(uuid, uuid)", "_tra_phan_bo_ve_truoc(uuid)", "_trg_tra_truoc_vao_no_moi()"]) {
      expect(MIG).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`)
    }
    for (const f of ["chi_tra_ncc(uuid, numeric, date, text, text, text)", "huy_phieu_chi_ncc(uuid, text)", "cancel_purchase_invoice(uuid, text)"]) {
      expect(MIG).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon;`)
      expect(MIG).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`)
    }
    expect(MIG).toMatch(/CREATE POLICY phieu_chi_ncc_doc ON public\.supplier_payments\s+FOR SELECT/)
    expect(MIG).not.toMatch(/CREATE POLICY[^;]+ON public\.supplier_payments\s+FOR (INSERT|UPDATE|DELETE|ALL)/)
  })
})

describe("lib phieu-chi-ncc: gọi đúng RPC, nói đúng câu", () => {
  it("lapPhieuChiNcc: đúng hàm + tham số; ô trống → null; đọc kết quả", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: "pc1", code: "PCNCC-0007", so_tien: 200000000, da_tru_no: 185000000, tra_truoc: 15000000, so_khoan: 14 },
      error: null,
    })
    const k = await lapPhieuChiNcc({ rpc } as never, {
      supplierId: "s1", amount: 200000000, paidDate: "2026-10-09", method: "transfer", notes: "  ", reference: " UNC 15 ",
    })
    expect(rpc.mock.calls).toEqual([["chi_tra_ncc", {
      p_supplier_id: "s1", p_amount: 200000000, p_paid_date: "2026-10-09", p_method: "transfer", p_notes: null, p_reference: "UNC 15",
    }]])
    expect(k).toEqual({ id: "pc1", code: "PCNCC-0007", so_tien: 200000000, da_tru_no: 185000000, tra_truoc: 15000000, so_khoan: 14 })
  })

  it("lỗi máy chủ: cắt mã ở đầu; chưa có hàm (sổ chưa chạy 242) → bảo chạy migration", async () => {
    const loi = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN: chỉ chủ NPP hoặc kế toán được lập phiếu chi trả NCC." } })
    await expect(lapPhieuChiNcc({ rpc: loi } as never, { supplierId: "s1", amount: 1, paidDate: "2026-10-09", method: "cash" }))
      .rejects.toThrow(/^chỉ chủ NPP hoặc kế toán được lập phiếu chi trả NCC\.$/)
    const chuaCo = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.chi_tra_ncc(p_amount, …) in the schema cache" } })
    await expect(lapPhieuChiNcc({ rpc: chuaCo } as never, { supplierId: "s1", amount: 1, paidDate: "2026-10-09", method: "cash" }))
      .rejects.toThrow("cần chạy migration 242")
    expect(loiPhieuChiNcc({ message: "NGAY_TUONG_LAI: Ngày chi không được sau hôm nay." })).toBe("Ngày chi không được sau hôm nay.")
  })

  it("huyPhieuChiNcc: đúng hàm + tham số", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "pc1", code: "PCNCC-0001", da_huy: true, so_tien_go: 500 }, error: null })
    expect(await huyPhieuChiNcc({ rpc } as never, "pc1", "  chi nhầm ")).toEqual({ da_huy: true, so_tien_go: 500 })
    expect(await huyPhieuChiNcc({ rpc } as never, "pc2", "")).toEqual({ da_huy: true, so_tien_go: 500 })
    expect(rpc.mock.calls).toEqual([
      ["huy_phieu_chi_ncc", { p_id: "pc1", p_reason: "chi nhầm" }],
      ["huy_phieu_chi_ncc", { p_id: "pc2", p_reason: null }],
    ])
  })

  it("chuaCoPhieuChiNcc: chỉ lỗi 'chưa có bảng / hàm / cột' của phiếu chi NCC", () => {
    expect(chuaCoPhieuChiNcc({ code: "42P01", message: "x" })).toBe(true)
    expect(chuaCoPhieuChiNcc({ code: "PGRST205", message: "x" })).toBe(true)
    // `fetchAllForAggregate` chỉ giữ câu lỗi (chuỗi).
    expect(chuaCoPhieuChiNcc("Could not find the table 'public.supplier_payments' in the schema cache")).toBe(true)
    expect(chuaCoPhieuChiNcc({ message: "column payable_payments.supplier_payment_id does not exist" })).toBe(true)
    expect(chuaCoPhieuChiNcc({ message: "mạng rớt" })).toBe(false)
    expect(chuaCoPhieuChiNcc({ message: "relation \"public.expenses\" does not exist" })).toBe(false)
    expect(chuaCoPhieuChiNcc(null)).toBe(false)
  })

  it("thongBaoChiNcc nói rõ phần trừ nợ và phần trả trước", () => {
    const k = { id: "x", code: "PCNCC-0002", so_tien: 820000, da_tru_no: 700000, tra_truoc: 120000, so_khoan: 5 }
    expect(thongBaoChiNcc(k)).toEqual({
      title: "Đã lập phiếu chi PCNCC-0002 — 820.000đ",
      description: "đã trừ 700.000đ vào 5 khoản nợ cũ nhất; 120.000đ là tiền trả trước (tự trừ vào phiếu nhập sau).",
    })
    expect(thongBaoChiNcc({ ...k, da_tru_no: 820000, tra_truoc: 0 }).description).toBe("đã trừ 820.000đ vào 5 khoản nợ cũ nhất.")
    expect(thongBaoChiNcc({ ...k, da_tru_no: 0, tra_truoc: 820000, so_khoan: 0 }).description).toBe(
      "820.000đ là tiền trả trước (tự trừ vào phiếu nhập sau)."
    )
  })

  it("kiểm trước khi gửi + giá trị mặc định (ngày = hôm nay giờ VN, tiền mặt)", () => {
    const v = giaTriChiNccMoi("s1", "2026-10-09")
    expect(v).toEqual({ supplierId: "s1", amount: 0, date: "2026-10-09", method: "cash", reference: "", notes: "" })
    expect(kiemPhieuChiNcc({ ...v, supplierId: "" }, "2026-10-09")).toBe("Chọn nhà cung cấp")
    expect(kiemPhieuChiNcc(v, "2026-10-09")).toBe("Nhập số tiền chi lớn hơn 0")
    expect(kiemPhieuChiNcc({ ...v, amount: 5, date: "" }, "2026-10-09")).toBe("Chọn ngày chi")
    expect(kiemPhieuChiNcc({ ...v, amount: 5, date: "2026-10-10" }, "2026-10-09")).toBe("Ngày chi không được sau hôm nay")
    expect(kiemPhieuChiNcc({ ...v, amount: 5 }, "2026-10-09")).toBeNull()
    expect(kiemPhieuChiNcc({ ...v, amount: 5, date: "2026-09-30" }, "2026-10-09")).toBeNull()
  })

  it("vai được chi trả NCC: Chủ NPP, Kế toán — như ghi trả tiền NCC", () => {
    expect(["owner", "accountant", "manager", "sales", "warehouse", "driver", null].map(duocChiTraNcc))
      .toEqual([true, true, false, false, false, false, false])
    expect(nhanHinhThucChiNcc("transfer")).toBe("Chuyển khoản")
    expect(nhanHinhThucChiNcc("cash")).toBe("Tiền mặt")
  })

  it("dongChiCuaPhieuNcc: một dòng 'đã chi' của danh sách phiếu chi, mã PCNCC-, không danh mục chi phí, không xoá được", () => {
    const p: PhieuChiNcc = {
      id: "pc1", code: "PCNCC-0003", supplier_id: "s1", paid_date: "2026-10-08", amount: 5000000, method: "transfer",
      reference_code: "UNC 9", notes: "trả đợt 1", status: "posted", created_by: "u1", created_at: "2026-10-08T05:00:00Z",
      supplier: { name: "Vinamilk", code: "NCC01" },
    }
    const d = dongChiCuaPhieuNcc(p)
    expect(d).toMatchObject({
      id: "pc1", expense_date: "2026-10-08", amount: 5000000, reference_code: "PCNCC-0003", description: "Vinamilk — trả đợt 1",
      category_id: null, source_type: null, is_paid: true, payment_method: "transfer",
    })
    expect(d.ncc).toBe(p)
    expect(dongChiCuaPhieuNcc({ ...p, notes: null }).description).toBe("Vinamilk")
  })
})

describe("đọc phiếu chi NCC", () => {
  const phieu = (id: string, o: Partial<PhieuChiNcc> & { org_id?: string } = {}) => ({
    id, org_id: "o1", code: `PCNCC-${id}`, supplier_id: "s1", paid_date: "2026-10-05", amount: 100, method: "cash",
    status: "posted", created_at: "2026-10-05T03:00:00Z", ...o,
  })

  it("napPhieuChiNcc: chỉ phiếu còn hiệu lực, đúng NPP, ngày chi trong kỳ; xếp có mốc id", async () => {
    const db = fakePostgrest({
      supplier_payments: [
        phieu("a"), phieu("b", { status: "cancelled" }), phieu("c", { org_id: "o2" }),
        phieu("d", { paid_date: "2026-09-30" }), phieu("e", { paid_date: "2026-10-31" }),
      ],
    })
    const r = await napPhieuChiNcc(db.client as never, "o1", "2026-10-01", "2026-10-31")
    expect(r.loi).toBeNull()
    expect(r.ds.map((p) => p.id).sort()).toEqual(["a", "e"])
    expect(db.calls[0].orders).toContain("id")
  })

  it("napPhieuChiNcc: sổ chưa chạy 242 → rỗng, KHÔNG báo lỗi; lỗi khác → báo", async () => {
    const chuaCo = clientLoi({ code: "PGRST205", message: "Could not find the table 'public.supplier_payments' in the schema cache" })
    expect(await napPhieuChiNcc(chuaCo, "o1", "2026-10-01", "2026-10-31")).toEqual({ ds: [], loi: null, truncated: false })
    const r = await napPhieuChiNcc(clientLoi({ message: "mạng rớt" }), "o1", "2026-10-01", "2026-10-31")
    expect(r.ds).toEqual([])
    expect(r.loi).toBe("Không đọc được phiếu chi trả NCC: mạng rớt")
  })

  it("docPhanTruPhieuChi: gộp các phần của cùng khoản; nhãn theo chứng từ; thứ tự như máy chủ trừ, trả trước cuối", async () => {
    const no = (id: string, created_at: string, o: Record<string, unknown> = {}) => ({ id, invoice_number: null, opening_balance: false, created_at, ...o })
    const db = fakePostgrest({
      payable_payments: [
        // Dòng trả trước lập lúc chi (01/10) — CŨ hơn phiếu nhập lập sau đó rồi tự hút tiền trả trước (trigger), vẫn phải cuối.
        { id: "1", supplier_payment_id: "pc1", payable_id: "pre", amount: 20, payable: no("pre", "2026-10-01T01:00:00Z", { invoice_number: "PCNCC-0001" }) },
        { id: "2", supplier_payment_id: "pc1", payable_id: "p2", amount: 60, payable: no("p2", "2026-10-02T00:00:00Z") },
        { id: "3", supplier_payment_id: "pc1", payable_id: "lt", amount: 5, payable: no("lt", "2026-10-03T00:00:00Z", { invoice_number: "HĐ tay 7" }) },
        { id: "4", supplier_payment_id: "pc1", payable_id: "dk", amount: 50, payable: no("dk", "2026-10-05T00:00:00Z", { opening_balance: true }) },
        { id: "5", supplier_payment_id: "pc1", payable_id: "p2", amount: 40, payable: no("p2", "2026-10-02T00:00:00Z") },
        { id: "6", supplier_payment_id: "pc2", payable_id: "p2", amount: 999, payable: no("p2", "2026-10-02T00:00:00Z") },
      ],
      purchase_invoices: [{ id: "pi2", payable_id: "p2", receipt_code: "PN-0003" }],
    })
    const r = await docPhanTruPhieuChi(db.client as never, { id: "pc1", prepay_payable_id: "pre" })
    expect(r).toEqual([
      { payableId: "dk", tien: 50, ma: "Nợ đầu kỳ", loai: "dau-ky", href: "/payables/dk" },
      { payableId: "p2", tien: 100, ma: "PN-0003", loai: "phieu-nhap", href: "/purchasing/receipts/pi2" },
      { payableId: "lt", tien: 5, ma: "HĐ tay 7", loai: "lap-tay", href: "/payables/lt" },
      { payableId: "pre", tien: 20, ma: "Tiền trả trước", loai: "tra-truoc", href: "/payables/pre" },
    ])
  })
})

describe("phiếu chi NCC ở các màn khác", () => {
  it("sổ nợ NCC: dòng trả trước của phiếu chi → loại 'Trả trước', mã PCNCC-, trỏ về phiếu chi", () => {
    const truoc = new Map([["pre", { id: "pc1", prepay_payable_id: "pre", code: "PCNCC-0004" }]])
    expect(chungTuCuaNo({ id: "pre", invoice_number: "PCNCC-0004" }, new Map(), new Map(), truoc)).toEqual({
      loai: "tra-truoc", ma: "PCNCC-0004", href: "/finance/phieu-chi-ncc/pc1", soHdNcc: null,
    })
    // Không có phiếu chi trỏ vào → như cũ (công nợ lập tay).
    expect(chungTuCuaNo({ id: "x", invoice_number: "HĐ 1" }, new Map(), new Map(), truoc).loai).toBe("lap-tay")
    const [d] = ghepChungTu(
      [{ id: "pre", supplier_id: "s1", invoice_number: "PCNCC-0004", amount: 0, paid: 120, status: "open" } as never],
      [], [], [{ id: "pc1", prepay_payable_id: "pre", code: "PCNCC-0004" }]
    )
    expect(d).toMatchObject({ loai: "tra-truoc", ma: "PCNCC-0004", conLai: -120 })
    expect(NHAN_LOAI_NO_NCC["tra-truoc"]).toBe("Trả trước")
  })

  it("lịch sử giao dịch NCC: mỗi phiếu chi MỘT dòng, dù tiền đã chia vào nhiều khoản nợ", () => {
    const ds = lichSuGiaoDich([], [], [], [
      { id: "pc1", code: "PCNCC-0001", paid_date: "2026-10-08", amount: 200000000, method: "transfer", status: "posted" },
      { id: "pc2", code: "PCNCC-0002", paid_date: "2026-10-09", amount: 5, method: "cash", status: "cancelled" },
    ])
    expect(ds.map((g) => [g.id, g.loai, g.ma, g.soTien, g.trangThai, g.tone, g.href])).toEqual([
      ["pcn-pc2", "chi", "PCNCC-0002", 5, "Đã huỷ", "danger", "/finance/phieu-chi-ncc/pc2"],
      ["pcn-pc1", "chi", "PCNCC-0001", 200000000, "Đã chi", "success", "/finance/phieu-chi-ncc/pc1"],
    ])
    expect(ds[1].meta).toBe("Phiếu chi trả NCC · Chuyển khoản · 08/10/2026")
  })

  it("sổ quỹ / phiếu chi của báo cáo: các phần của một phiếu chi gộp lại một dòng PCNCC-, tiền không đổi", () => {
    const ds: PhieuChi[] = [
      { id: "pp1", ngay: "2026-10-08", tien: 70, nhom: "Vinamilk", dien: "Trả NCC", ma: "PN-1", loai: "ncc" },
      { id: "cp1", ngay: "2026-10-08", tien: 9, nhom: "Điện", dien: "Tiền điện", ma: "", loai: "chi" },
      { id: "pp2", ngay: "2026-10-08", tien: 30, nhom: "Vinamilk", dien: "Trả NCC", ma: "PN-2", loai: "ncc" },
      { id: "pp3", ngay: "2026-10-07", tien: 4, nhom: "TH", dien: "Trả NCC", ma: "PN-9", loai: "ncc" },
    ]
    const thuoc = new Map([
      ["pp1", { id: "pc1", code: "PCNCC-0001", ncc: "Vinamilk", ghiChu: "đợt 1" }],
      ["pp2", { id: "pc1", code: "PCNCC-0001", ncc: "Vinamilk", ghiChu: "đợt 1" }],
    ])
    const r = gopPhanPhieuChiNcc(ds, thuoc)
    expect(r).toEqual([
      { id: "pc1", ngay: "2026-10-08", tien: 100, nhom: "Vinamilk", dien: "Phiếu chi trả NCC · đợt 1", ma: "PCNCC-0001", loai: "ncc" },
      ds[1],
      ds[3],
    ])
    expect(r.reduce((s, c) => s + c.tien, 0)).toBe(ds.reduce((s, c) => s + c.tien, 0))
  })

  it("trang chi tiết phiếu chi cùng quyền với màn Chi phí", () => {
    expect(mucChaCua("/finance/phieu-chi-ncc/abc")).toBe("/finance/expenses")
    expect(duocVaoTrang("accountant", "/finance/phieu-chi-ncc/abc", "settings")).toBe(true)
    expect(duocVaoTrang("sales", "/finance/phieu-chi-ncc/abc", "settings")).toBe(false)
    expect(duocVaoTrang("warehouse", "/finance/phieu-chi-ncc/abc", "settings")).toBe(false)
  })
})

describe("màn hình: lập / xem / huỷ phiếu chi trả NCC", () => {
  const chiPhi = doc("src/app/(dashboard)/finance/expenses/page.tsx")

  it("màn Chi phí: loại 'Trả NCC' chỉ hiện cho vai được chi; lưu đi RPC, không ghi bảng chi phí", () => {
    expect(chiPhi).toMatch(/\{chiNccDuoc && \(\s+<div[^>]*role="tablist" aria-label="Loại phiếu chi">/)
    expect(chiPhi).toContain('if (loaiPhieu === "ncc") return handleSaveNcc()')
    expect(chiPhi).toMatch(/const handleSaveNcc = async \(\) => \{\s+const loi = kiemPhieuChiNcc\(nccForm\)/)
    expect(chiPhi).toContain("const k = await lapPhieuChiNcc(supabase, {")
    expect(chiPhi).toContain("const chiNccDuoc = duocChiTraNcc(user?.role)")
  })

  it("màn Chi phí: phiếu chi NCC không có nút xoá; huỷ qua hộp hỏi lại (RPC), chỉ vai được chi", () => {
    expect(chiPhi).toContain("const xoaDuoc = (e: DongChi) => !!canDelete && e.source_type === null && !e.ncc")
    expect(chiPhi).toMatch(/actions=\{xem\?\.ncc && chiNccDuoc \? \(/)
    expect(chiPhi).toContain("await huyPhieuChiNcc(supabase, huyNcc.id, lyDoHuy)")
    expect(chiPhi).toMatch(/<ConfirmDialog\s+open=\{!!huyNcc\}/)
  })

  it("màn Chi phí: đang lọc nâng cao (điều kiện trên cột chi phí) thì không gộp phiếu chi NCC", () => {
    expect(chiPhi).toContain("coLocNC ? Promise.resolve({ ds: [] as PhieuChiNcc[], loi: null, truncated: false }) : napPhieuChiNcc(supabase, user.org_id, dateFrom, dateTo)")
  })

  it("màn Chi phí: ngày mặc định của phiếu chi phí là hôm nay GIỜ VN (không phải UTC)", () => {
    expect(chiPhi).toContain("const [formDate, setFormDate] = useState(() => homNayVNKey())")
    expect(chiPhi).toContain("setFormDate(homNayVNKey())")
    expect(chiPhi).not.toContain("toISOString().slice(0, 10)")
  })

  it("chi tiết NCC: nút Chi trả NCC + hộp lập phiếu chỉ cho vai được chi; phần tiền của phiếu không hiện lặp thành từng lần trả", () => {
    const s = doc("src/app/(dashboard)/suppliers/[id]/page.tsx")
    expect(s.match(/\{duocChiTraNcc\(user\?\.role\) && \(/g)?.length).toBe(3)
    expect(s).toContain("setPhieuChi(chi.filter((c) => !phanCuaPhieu.has(c.id)))")
    expect(s).toContain("lichSuGiaoDich(phieuNhap, phieuTra, phieuChi, phieuChiNcc)")
    expect(s).toMatch(/<PhieuChiNccDialog\s+open=\{moChiNcc\}[\s\S]*?coDinh=\{\{ id: supplier\.id, name: supplier\.name \}\}/)
  })

  it("trang chi tiết phiếu chi: nút Huỷ chỉ khi phiếu còn hiệu lực và vai được chi", () => {
    const s = doc("src/app/(dashboard)/finance/phieu-chi-ncc/[id]/page.tsx")
    expect(s).toContain('useRoleGuard("settings")')
    expect(s).toContain("{!daHuy && duocChiTraNcc(user?.role) && (")
    expect(s).toContain("await huyPhieuChiNcc(supabase, phieu.id, lyDo)")
  })

  it("công nợ NCC: dòng trả trước hiện 'Tiền trả trước'; khoản còn lại ≤ 0 không có khung ghi trả", () => {
    const ds = doc("src/app/(dashboard)/payables/page.tsx")
    expect(ds).toContain('return chungTu.get(p.id)?.loai === "tra-truoc"')
    expect(ds.match(/nhanTrangThaiNo\((p|xem), chungTu\)/g)?.length).toBe(3)
    const ct = doc("src/app/(dashboard)/payables/[id]/page.tsx")
    expect(ct).toContain('const canRecordPayment = user && ["owner", "accountant"].includes(user.role) && payable.status !== "paid" && balance > 0')
  })
})

describe("tên 'Phiếu chi' (chủ nhà 09/10/2026: đổi menu 'Chi phí' → 'Phiếu chi', cạnh 'Phiếu thu')", () => {
  it("thanh bên, tiêu đề thanh trên, ô Trang chủ, danh mục phân quyền cùng gọi 'Phiếu chi'", () => {
    expect(doc("src/components/layout/sidebar.tsx")).toContain('{ label: "Phiếu chi", href: "/finance/expenses", icon: Wallet },')
    expect(doc("src/components/layout/header.tsx")).toContain('"/finance/expenses": "Phiếu chi",')
    expect(doc("src/app/(dashboard)/home/page.tsx")).toContain('{ label: "Phiếu chi", href: "/finance/expenses",')
    expect(getFeature("finance.expenses")?.label).toBe("Phiếu chi")
  })

  it("đầu trang danh sách + trống: 'Phiếu chi'; đếm cả phiếu trả NCC khi nói 'chưa có'", () => {
    const s = doc("src/app/(dashboard)/finance/expenses/page.tsx")
    expect(s).toContain('<PageHeader className="max-lg:hidden" title="Phiếu chi"')
    expect(s).toMatch(/mobileHead=\{\{\s+title: "Phiếu chi",/)
    expect(s).toContain('title={dongChi.length === 0 ? "Chưa có phiếu chi" : "Không có phiếu chi khớp bộ lọc"}')
    expect(doc("src/components/bao-cao/xem-nhanh.tsx")).toContain('label: "Mở danh sách phiếu chi", href: "/finance/expenses"')
  })
})

/** Supabase giả: mọi lệnh đọc trả cùng một lỗi. */
function clientLoi(error: { message: string; code?: string }) {
  const q: unknown = new Proxy(
    {},
    {
      get: (_t, k) =>
        k === "then"
          ? (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error, count: null }).then(res, rej)
          : () => q,
    }
  )
  return { from: () => q } as never
}
