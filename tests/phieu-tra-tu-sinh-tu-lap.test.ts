import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { hanhDongPhieuTra, laNhapTheoDon, laPhieuTuSinh } from "@/lib/returns/loai-phieu"
import { debtAfterReturn } from "@/lib/pos/return-totals"

/**
 * PHIẾU TRẢ TỰ SINH (THEO HÓA ĐƠN) vs PHIẾU TỰ LẬP — mig 191.
 *
 * ⚠ CHỦ NHÀ 25/09/2026:
 *   "Đơn hàng có hàng đổi trả, công nợ sẽ được trừ ngay khi Hoá đơn đã xuất. CHỉ treo
 *    nhập kho bên Trả hàng bằng phiếu tự sinh (ở trạng thái Chờ xử lý). Với đơn Trả
 *    hàng bình thường thì khi phiếu hoàn thành -> đồng thời nhập kho và trừ công nợ."
 *   "Phiếu trả sinh ra tự động thì chỉ huỷ phiếu ko sửa được (muốn sửa thì sửa từ hoá
 *    đơn), khi huỷ phiếu -> quay lại trạng thái chờ xử lý. Phiếu trả do người dùng tạo
 *    -> sửa/huỷ được -> mọi thứ cập nhật theo."
 *   "Lưu ý trạng thái Chờ xử lý chỉ có ở phiếu trả tự sinh."
 *
 * Hành vi SQL đã chạy thật trên Postgres 16 (kịch bản 9 khối: tự sinh chờ / nhập kho /
 * huỷ về chờ / nhập lại huỷ lần hai; tự lập nháp → hoàn thành → sửa → rút dư có → huỷ
 * → huỷ phiếu thu; gắn HĐ không cấn trừ lần hai; trình duyệt ghi thẳng bị chặn) và
 * thử phá từng chỗ vá. Các chốt dưới giữ mã nguồn khỏi trôi về luật cũ.
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/191_luat_phieu_tra_tu_sinh_va_tu_lap.sql")
const boChuThich = (s: string) => s.replace(/--[^\n]*/g, "")

describe("hanhDongPhieuTra — ai được làm gì", () => {
  const tuSinh = { credit_with_invoice: true, order_id: "o", invoice_id: "i" }

  it("tự sinh Chờ xử lý: chỉ Hoàn thành (nhập kho); không huỷ, không sửa", () => {
    const h = hanhDongPhieuTra({ ...tuSinh, status: "submitted" })
    expect(h).toMatchObject({ hoanThanh: true, huy: false, sua: false })
    expect(h.lyDo).toContain("sửa hóa đơn")
  })

  it("tự sinh đã nhập kho: huỷ là HUỶ NHẬP KHO (về Chờ xử lý), vẫn không sửa", () => {
    expect(hanhDongPhieuTra({ ...tuSinh, status: "completed" })).toMatchObject({ hoanThanh: false, huy: "ve_cho", sua: false })
  })

  it("tự lập: Nháp → Hoàn thành; sửa + huỷ được cả khi đã nhập kho", () => {
    expect(hanhDongPhieuTra({ status: "draft", invoice_id: null, order_id: null })).toMatchObject({ hoanThanh: true, huy: "huy", sua: true })
    expect(hanhDongPhieuTra({ status: "draft", invoice_id: "i", order_id: "o" })).toMatchObject({ hoanThanh: true, sua: true })
    expect(hanhDongPhieuTra({ status: "completed", invoice_id: null })).toMatchObject({ hoanThanh: false, huy: "huy", sua: true })
  })

  it("hàng trả nháp đi theo đơn chưa xuất HĐ: sửa ở đơn, không thao tác ở đây", () => {
    const r = { status: "draft", order_id: "o", invoice_id: null }
    expect(laNhapTheoDon(r)).toBe(true)
    expect(laPhieuTuSinh(r)).toBe(false)
    expect(hanhDongPhieuTra(r)).toMatchObject({ hoanThanh: false, huy: false, sua: false })
  })

  it("đã huỷ: không còn thao tác nào", () => {
    expect(hanhDongPhieuTra({ status: "cancelled" })).toMatchObject({ hoanThanh: false, huy: false, sua: false })
  })
})

describe("mig 191 — máy chủ giữ luật", () => {
  it("có khối VÌ SAO trích lời chủ nhà, kết thúc bằng NOTIFY + SELECT tóm tắt", () => {
    expect(MIG).toContain("VÌ SAO — chủ nhà 25/09/2026")
    expect(MIG).toContain("trạng thái Chờ xử lý chỉ có ở phiếu trả tự sinh")
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema';\s*\n\s*SELECT 'Luật phiếu trả/)
  })

  it("hàm nội bộ SECURITY DEFINER thu quyền gọi thẳng (luật mig 166)", () => {
    for (const fn of ["_cong_no_phieu_tra(uuid)", "_cong_no_am_trang_thai()", "_khoa_phieu_tra_tu_sinh()"]) {
      expect(MIG, fn).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
    }
  })

  it("cancel_return: tự sinh chờ → chặn; tự sinh đã nhập → về Chờ xử lý; đánh dấu phiếu nhập đã đảo", () => {
    const i = MIG.indexOf("CREATE OR REPLACE FUNCTION public.cancel_return")
    const body = boChuThich(MIG.slice(i, MIG.indexOf("$$;", i)))
    expect(body).toContain("RAISE EXCEPTION 'RETURN_FOLLOWS_INVOICE")
    expect(body).toMatch(/IF r\.tu_sinh THEN\s*UPDATE returns\s*SET status = 'submitted'/)
    expect(body).toContain("SET notes = notes || ' (đã đảo)'")
    // Bỏ khoá "hóa đơn gốc đã có tiền thu" — nợ tự tăng lại.
    expect(body).not.toContain("hóa đơn gốc đã có tiền thu")
    // Mảnh vá mig 190: huỷ phiếu chờ gắn HĐ thì tính lại công nợ HĐ.
    expect(body).toMatch(/IN \('draft', 'submitted'\)[\s\S]*?_wf2b_recompute_receivable\(r\.invoice_id\)[\s\S]*?RETURN;/)
    // Phiếu độc lập → công nợ âm của chính nó.
    expect(body).toContain("PERFORM public._cong_no_phieu_tra(p_return_id)")
  })

  it("complete_return: phiếu tự lập hoàn thành thẳng từ Nháp, phiếu độc lập ghi công nợ âm", () => {
    expect(MIG).toContain("pg_get_functiondef('public.complete_return(uuid, text)'::regprocedure)")
    expect(MIG).toContain("E'    PERFORM public._cong_no_phieu_tra(p_return_id);\\n'")
    expect(MIG).toContain("E'    r.status := ''submitted'';\\n'")
  })

  it("save_pos_return chặn sửa phiếu tự sinh", () => {
    const i = MIG.indexOf("CREATE OR REPLACE FUNCTION public.save_pos_return")
    const body = boChuThich(MIG.slice(i, MIG.indexOf("$fn$;", i)))
    expect(body).toMatch(/IF r\.tu_sinh THEN\s*RAISE EXCEPTION 'RETURN_FOLLOWS_INVOICE/)
  })

  it("trình duyệt không ghi thẳng được vào phiếu tự sinh (trigger theo current_user)", () => {
    expect(MIG).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN")
    expect(MIG).toContain("CREATE TRIGGER trg_khoa_phieu_tra_tu_sinh")
    expect(MIG).toContain("CREATE TRIGGER trg_khoa_dong_tra_tu_sinh")
  })

  it("phiếu thu không cấn trừ lần hai phiếu gắn HĐ / phiếu đã là công nợ âm", () => {
    expect(MIG).toContain("E'        AND r.invoice_id IS NULL\\n'")
    expect(MIG).toContain("NOT EXISTS (SELECT 1 FROM receivables rc2 WHERE rc2.return_id = r.id)")
  })

  it("huỷ phiếu thu không kẹp paid của dòng âm về 0", () => {
    const i = MIG.indexOf("CREATE OR REPLACE FUNCTION public.void_cash_receipt")
    const body = boChuThich(MIG.slice(i, MIG.indexOf("$$;", i)))
    expect(body).toMatch(/WHEN COALESCE\(rc\.amount, 0\) < 0 OR rc\.return_id IS NOT NULL\s*THEN COALESCE\(rc\.paid, 0\) - l\.amount/)
  })

  it("dùng QUÁ dư có (paid < amount âm) là nợ lại → 'open', không 'paid'", () => {
    expect(MIG).toContain("abs(COALESCE(NEW.paid, 0) - NEW.amount) < 0.01 THEN 'paid' ELSE 'open'")
  })

  it("ghi bù phiếu cũ + chuyển phiếu tự lập đang Chờ xử lý về Nháp", () => {
    expect(MIG).toMatch(/UPDATE returns SET status = 'draft'\s*WHERE status = 'submitted' AND NOT COALESCE\(credit_with_invoice, false\);/)
    expect(MIG).toContain("AND NOT EXISTS (SELECT 1 FROM receivables rc WHERE rc.return_id = ret.id)")
  })
})

describe("giao diện theo luật mới", () => {
  it("màn POS: phiếu tự sinh chỉ xem, nút ghi khoá", () => {
    const POS = read("src/components/pos/return-screen.tsx")
    expect(POS).toContain("credit_with_invoice, reason,")
    expect(POS).toContain("setTuSinh(!!r.credit_with_invoice)")
    expect(POS).toContain("disabled={dangLuu || daHuy || tuSinh ||")
  })

  it("màn chi tiết web: luật đi qua hanhDongPhieuTra", () => {
    const P = read("src/app/(dashboard)/returns/[id]/page.tsx")
    expect(P).toContain("const hd = hanhDongPhieuTra(ret)")
    expect(P).toContain("{hd.hoanThanh && (")
    expect(P).toContain("canEdit && hd.sua && !editMode")
    expect(P).not.toContain("khoản có này đem cấn trừ ở màn Phiếu thu")
  })

  it("màn phiếu thu không liệt kê phiếu trả gắn hóa đơn để cấn trừ", () => {
    const P = read("src/app/(dashboard)/finance/cash-receipts/new/page.tsx")
    expect(P).toMatch(/\.is\("order_id", null\)[\s\S]{0,300}\.is\("invoice_id", null\)/)
  })

  it("POS: trả nhiều hơn nợ là dư có (số âm), không kẹp 0", () => {
    expect(debtAfterReturn(100_000, 150_000)).toBe(-50_000)
  })
})

describe("script khám", () => {
  it("kham-so-that có dòng mig 191", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 31, 'Mig 191")
  })

  it("kiem-phieu-tra.sql chỉ ĐỌC và chạy được cả trước mig 191", () => {
    const Q = boChuThich(read("scripts/sql/kiem-phieu-tra.sql"))
    expect(Q).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i)
    // Không gọi thẳng cột `return_id` (chưa có trước mig 191).
    expect(Q).not.toMatch(/rc\.return_id/)
    expect(Q).toContain("to_jsonb(rc)->>'return_id'")
  })
})
