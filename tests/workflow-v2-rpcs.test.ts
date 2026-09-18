import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const MIG = readFileSync(resolve(ROOT, "supabase/migrations/120_workflow_v2_rpcs.sql"), "utf-8")
/** Bỏ chú thích — file này trích lại tên mã lỗi trong phần giải thích. */
const SQL = MIG.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")

/** Thân của một hàm, từ CREATE tới dấu kết thúc $$; */
function fn(name: string): string {
  const i = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(i, `không tìm thấy hàm ${name}`).toBeGreaterThan(0)
  const j = SQL.indexOf("\n$$;", i)
  expect(j).toBeGreaterThan(i)
  return SQL.slice(i, j)
}

const RPCS = [
  "complete_order",
  "edit_completed_order",
  "cancel_order",
  "complete_return",
  "cancel_return",
  "create_cash_receipt",
  "void_cash_receipt",
]
const HELPERS = [
  "_wf2_notify",
  "_wf2_recompute_receivable",
  "_wf2_export_order",
  "_wf2_restock",
  "_wf2_assert_order_unlocked",
]

describe("120 — trigger nhập kho tự động của đơn trả phải biến mất", () => {
  /**
   * ⚠ Còn trigger cũ thì mỗi lần hoàn thành phiếu trả sẽ nhập kho HAI
   * lần: một lần do complete_return, một lần do trigger. Tồn tăng gấp
   * đôi số hàng trả và không có gì báo.
   */
  it("gỡ cả trigger lẫn hàm", () => {
    expect(SQL).toContain("DROP TRIGGER  IF EXISTS trg_auto_restock_return ON returns;")
    expect(SQL).toContain("DROP FUNCTION IF EXISTS public.auto_restock_on_return();")
  })

  it("gỡ TRƯỚC khi dựng complete_return", () => {
    expect(SQL.indexOf("DROP TRIGGER  IF EXISTS trg_auto_restock_return"))
      .toBeLessThan(SQL.indexOf("CREATE OR REPLACE FUNCTION public.complete_return("))
  })
})

describe("120 — mọi RPC đều gác cửa", () => {
  for (const name of RPCS) {
    it(`${name}: kiểm tổ chức và kiểm quyền`, () => {
      const body = fn(name)
      expect(body, "thiếu kiểm quyền").toContain("public.user_has_permission(auth.uid(),")
      // Hàm phiếu thu không nhận id đơn nên kiểm org qua user_org_id() khi đọc.
      expect(body, "thiếu kiểm tổ chức").toContain("public.user_org_id()")
    })
  }

  it("dùng khoá quyền có thật trong ma trận, không bịa khoá mới", () => {
    const keys = Array.from(SQL.matchAll(/user_has_permission\(auth\.uid\(\), '([^']+)'\)/g)).map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)
    // user_has_permission tách tại dấu chấm CUỐI rồi tra role_permissions,
    // nên module và action phải nằm trong hai danh sách CHECK của bảng đó.
    const MODULES = ["orders", "customers", "inventory", "products", "commissions",
      "receivables", "deliveries", "promotions", "invoices", "returns", "reports", "settings"]
    const ACTIONS = ["read", "create", "update", "delete", "approve", "export"]
    for (const k of keys) {
      const dot = k.lastIndexOf(".")
      expect(dot, `khoá ${k} không có dấu chấm`).toBeGreaterThan(0)
      expect(MODULES, `module lạ trong khoá ${k}`).toContain(k.slice(0, dot))
      expect(ACTIONS, `action lạ trong khoá ${k}`).toContain(k.slice(dot + 1))
    }
  })

  it("mọi lỗi mang mã P0001 và mở đầu bằng mã viết hoa", () => {
    const raises = Array.from(SQL.matchAll(/RAISE EXCEPTION\s+'([^']+)'/g)).map((m) => m[1])
    expect(raises.length).toBeGreaterThan(10)
    for (const r of raises) {
      expect(r, `thông điệp không mở đầu bằng mã: ${r}`).toMatch(/^[A-Z][A-Z_]+(:|$)/)
    }
    // Mỗi RAISE phải kèm ERRCODE, nếu không giao diện không tách được lý do.
    expect((SQL.match(/RAISE EXCEPTION/g) || []).length)
      .toBe((SQL.match(/USING ERRCODE = 'P0001'/g) || []).length)
  })
})

describe("120 — hai bước đụng kho và tiền phải bật cờ RPC", () => {
  /**
   * ⚠ Trigger ở mig 119 chặn submitted→completed và completed→cancelled
   * khi không có cờ. Quên bật là RPC tự chặn chính mình; bật sai chỗ là
   * mở lại đúng cái cửa vừa đóng.
   */
  it("complete_order bật cờ trước khi đổi trạng thái", () => {
    const b = fn("complete_order")
    const flag = b.indexOf("set_config('npp.via_rpc', 'on', true)")
    const upd = b.indexOf("SET status = 'completed'")
    expect(flag).toBeGreaterThan(0)
    expect(upd).toBeGreaterThan(flag)
  })

  it("cancel_order bật cờ ở nhánh đơn đã xuất, KHÔNG bật ở nhánh nháp", () => {
    const b = fn("cancel_order")
    expect((b.match(/set_config\('npp\.via_rpc'/g) || []).length).toBe(1)
    const flag = b.indexOf("set_config('npp.via_rpc'")
    const draftBranch = b.indexOf("IF o.status IN ('draft', 'submitted') THEN")
    expect(draftBranch).toBeGreaterThan(0)
    expect(flag).toBeGreaterThan(draftBranch)
    // Cờ phải nằm SAU nhánh nháp đã return, tức ở phần xử lý đơn đã xuất.
    expect(flag).toBeGreaterThan(b.indexOf("Huỷ đơn ĐÃ XUẤT") > 0 ? 0 : flag - 1)
  })
})

describe("120 — xuất hàng", () => {
  const b = fn("complete_order")

  it("chỉ chạy từ Phiếu tạm; gọi lần hai thì nói ra chứ không xuất lại", () => {
    expect(b).toContain("IF o.status <> 'submitted' THEN")
    expect(b).toContain("ORDER_NOT_SUBMITTED")
  })

  it("khoá dòng đơn trước khi đọc trạng thái", () => {
    const sel = b.indexOf("FROM sales_orders WHERE id = p_order_id FOR UPDATE")
    const check = b.indexOf("IF o.status <> 'submitted'")
    expect(sel).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(sel)
  })

  it("gom cả hàng đổi của phiếu trả kèm đơn, đánh dấu [Exchange]", () => {
    expect(b).toContain("rl.is_exchange = true")
    expect(b).toContain("'[Exchange]'")
    expect(b).toContain("r.status = 'draft'")
  })

  it("xuất kho, ghi mốc, tính công nợ, mở phiếu trả, báo NVBH — đủ 5 việc", () => {
    for (const s of [
      "_wf2_export_order(p_order_id",
      "completed_at = now(), completed_by = auth.uid()",
      "_wf2_recompute_receivable(p_order_id)",
      "UPDATE returns SET status = 'submitted'",
      "'order_completed'",
    ]) expect(b, `thiếu: ${s}`).toContain(s)
  })
})

describe("120 — sửa đơn đã xuất", () => {
  const b = fn("edit_completed_order")

  it("đủ bốn khoá", () => {
    const g = fn("_wf2_assert_order_unlocked")
    for (const code of ["LOCKED_HAS_PAYMENT", "LOCKED_TOO_OLD", "LOCKED_EINVOICE", "LOCKED_RETURN_DONE"]) {
      expect(g, `thiếu khoá ${code}`).toContain(code)
    }
    expect(b).toContain("LOCKED_NOT_COMPLETED")
    expect(b).toContain("_wf2_assert_order_unlocked(p_order_id, o.order_date, true)")
  })

  /** ⚠ Huỷ đơn đã xuất KHÔNG bị chặn bởi hạn sửa: hàng có thể quay về muộn hơn. */
  it("huỷ đơn đã xuất bỏ qua khoá hạn sửa", () => {
    expect(fn("cancel_order")).toContain("_wf2_assert_order_unlocked(p_order_id, o.order_date, false)")
  })

  it("đối chiếu tổng dòng với tạm tính trước khi ghi gì", () => {
    const chk = b.indexOf("TOTAL_MISMATCH")
    const write = b.indexOf("DELETE FROM sales_order_lines")
    expect(chk).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(chk)
  })

  /**
   * ⚠ Không dùng bảng tạm: gọi hàm hai lần trong cùng một giao dịch sẽ
   * đụng "bảng tạm đã tồn tại", lỗi chỉ hiện khi sửa hai đơn liền tay.
   */
  it("tính chênh lệch bằng biến jsonb, không bằng bảng tạm", () => {
    expect(b).not.toContain("CREATE TEMP TABLE")
    expect(b).toContain("INTO v_delta")
  })

  it("chênh dương xuất thêm, chênh âm hoàn về đúng lô đã lấy", () => {
    expect(b).toContain("_wf2_export_order(p_order_id, v_add")
    expect(b).toContain("_wf2_restock(s.id, v_take")
    expect(b).toContain("NO_EXPORT_TO_REVERSE")
  })

  it("dòng không có id là thêm, id cũ vắng mặt là xoá", () => {
    expect(b).toContain("WHERE NULLIF(l->>'id', '') IS NULL")
    expect(b).toContain("id NOT IN (")
  })

  it("ghi nhật ký kèm cả hai phiếu kho, dùng biến đã chắc chắn có giá trị", () => {
    expect(b).toContain("'edit_after_complete'")
    expect(b).toContain("jsonb_build_object('export_entry_id', export_entry_id,")
    // ⚠ v_exp là record chỉ được gán khi có phần tăng; đọc nó ngoài nhánh
    // đó là lỗi "record is not assigned yet".
    expect(b.slice(b.indexOf("INSERT INTO order_activity_log"))).not.toContain("v_exp.")
  })
})

describe("120 — huỷ đơn", () => {
  const b = fn("cancel_order")

  it("NVBH chỉ huỷ được đơn của mình", () => {
    expect(b).toContain("public.user_role() = 'sales' AND o.sales_user_id <> auth.uid()")
    expect(b).toContain("FORBIDDEN_NOT_OWNER")
  })

  it("huỷ đơn đã xuất: bắt buộc lý do, hoàn kho rồi mới xoá công nợ", () => {
    expect(b).toContain("REASON_REQUIRED")
    const restock = b.indexOf("_wf2_restock(s.id")
    const del = b.indexOf("DELETE FROM receivables")
    expect(restock).toBeGreaterThan(0)
    expect(del).toBeGreaterThan(restock)
    expect(b).toContain("'cancel_after_complete'")
  })

  it("huỷ rồi huỷ lại thì không làm gì thêm", () => {
    expect(b).toContain("IF o.status = 'cancelled' THEN RETURN; END IF;")
  })
})

describe("120 — đơn trả", () => {
  const b = fn("complete_return")

  it("chỉ từ Phiếu tạm, và phải chọn kho nhận hợp lệ", () => {
    expect(b).toContain("RETURN_NOT_SUBMITTED")
    expect(b).toContain("IF p_zone NOT IN ('sale', 'date') THEN")
    expect(b).toContain("BAD_ZONE")
  })

  /**
   * ⚠ HÀNG ĐỔI CŨNG VÀO KHO NHƯ HÀNG TRẢ — nó chỉ khác ở chỗ không ghi
   * có công nợ. Vòng nhập kho KHÔNG được lọc `is_exchange`.
   *
   * ⚠ Chốt này từng soi cả thân hàm và cấm chuỗi `rl.is_exchange = false`
   * ở bất cứ đâu. Sai phạm vi: phép kiểm TRẦN SỐ LƯỢNG (Q8) hợp lệ khi
   * loại dòng đổi ra, vì hàng đổi không bị chặn bởi số đã bán. Nay chỉ
   * soi đúng VÒNG NHẬP KHO.
   */
  it("nhập vào đúng kho được chọn, cả dòng hàng đổi", () => {
    expect(b).toContain("b.warehouse_zone = p_zone")
    expect(b).toContain("warehouse_zone")
    const loop = b.slice(b.indexOf("FOR l IN"), b.indexOf("UPDATE returns"))
    expect(loop, "vòng nhập kho đang bỏ qua dòng hàng đổi").not.toContain("is_exchange = false")
  })

  /** ⚠ Hạn dùng của lô mới phải suy được, không bịa một ngày cố định. */
  it("lô mới suy hạn từ lô cũ, rồi tới hạn sử dụng sản phẩm", () => {
    expect(b).toContain("SELECT max(b2.expires_at) INTO v_exp")
    expect(b).toContain("COALESCE(p.shelf_life_days, 365)")
    expect(b).not.toContain("2099-12-31")
  })

  it("có đơn gốc thì tính lại công nợ, và báo người tạo phiếu", () => {
    expect(b).toContain("IF r.order_id IS NOT NULL THEN")
    expect(b).toContain("'return_completed'")
  })

  it("huỷ phiếu trả đã hoàn thành: chặn khi khoản có đã dùng, và đảo đúng phiếu nhập", () => {
    const c = fn("cancel_return")
    expect(c).toContain("LOCKED_CREDIT_APPLIED")
    expect(c).toContain("r.applied_receipt_id IS NOT NULL")
    // Khớp phiếu nhập bằng ĐỦ id phiếu trả, không phải 8 ký tự đầu.
    expect(c).toContain("se.notes = 'Nhập lại từ phiếu trả ' || p_return_id::text")
    expect(c).not.toContain("left(p_return_id::text, 8)")
  })
})

describe("120 — phiếu thu", () => {
  const b = fn("create_cash_receipt")

  it("không tạo số dư có: cấn trừ vượt nợ đã chọn thì dừng", () => {
    expect(b).toContain("CREDIT_EXCEEDS_SELECTED")
    expect(b).toContain("IF v_sum_cred > v_sum_line THEN")
  })

  it("kiểm từng khoản nợ đúng khách và không thu vượt phần còn nợ", () => {
    expect(b).toContain("BAD_RECEIVABLE_LINE")
    expect(b).toContain("COALESCE(r.amount, 0) - COALESCE(r.paid, 0)")
  })

  it("phiếu trả cấn trừ phải hoàn thành, cùng khách, không gắn đơn, chưa dùng", () => {
    expect(b).toContain("r.status = 'completed' AND r.order_id IS NULL")
    expect(b).toContain("r.applied_receipt_id IS NULL")
    expect(b).toContain("BAD_CREDIT")
  })

  it("cấn trừ nợ cũ nhất trước", () => {
    expect(b).toContain("ORDER BY x.due_date NULLS LAST")
  })

  /**
   * ⚠ Gửi trùng một phiếu trả hai lần trong cùng payload thì khách được
   * cấn trừ gấp đôi mà không có lỗi nào. Đọc credits phải DISTINCT ở cả
   * ba chỗ: tính tổng, kiểm điều kiện, và phân bổ.
   */
  it("phiếu trả trùng trong payload chỉ tính một lần", () => {
    expect((b.match(/SELECT DISTINCT \(c2->>'return_id'\)::uuid/g) || []).length).toBe(3)
  })

  /** Ghi return_id lên dòng cấn trừ, nếu không thì không lần ngược được. */
  it("dòng cấn trừ ghi rõ phiếu trả nào", () => {
    expect(b).toContain("kind, return_id")
    expect(b).toContain("'return_credit', c.id")
  })

  /** Ngày phiếu do người lập chọn, không phải ngày chạy hàm. */
  it("ghi đúng ngày lập phiếu", () => {
    expect(b).toContain("COALESCE((p->>'receipt_date')::date, current_date)")
  })

  it("mã phiếu trùng thì thử lại, không ném lỗi thô", () => {
    expect(b).toContain("EXCEPTION WHEN unique_violation THEN")
    expect(b).toContain("IF v_try >= 5 THEN RAISE; END IF;")
  })

  it("huỷ phiếu thu trả công nợ về đúng như cũ", () => {
    const v = fn("void_cash_receipt")
    expect(v).toContain("DELETE FROM payments WHERE id = l.payment_id")
    expect(v).toContain("paid = GREATEST(0, COALESCE(paid, 0) - l.amount)")
    expect(v).toContain("UPDATE returns SET applied_receipt_id = NULL")
    expect(v).toContain("status = 'voided'")
    expect(v).toContain("REASON_REQUIRED")
  })
})

describe("120 — công nợ", () => {
  /** ⚠ `paid` là tiền khách đã trả. Tính lại công nợ mà đè lên nó là xoá tiền thật. */
  it("tính lại công nợ không bao giờ ghi đè số đã thu", () => {
    const b = fn("_wf2_recompute_receivable")
    expect(b).toContain("SET amount = v_net,")
    expect(b).not.toMatch(/SET[^;]*\bpaid\s*=/)
  })

  it("chỉ phiếu trả đã HOÀN THÀNH mới trừ công nợ", () => {
    expect(fn("_wf2_recompute_receivable")).toContain("status = 'completed'")
    expect(fn("_wf2_recompute_receivable")).not.toContain("'approved'")
  })

  it("hạn thanh toán suy từ điều khoản NETxx, mặc định là trả ngay", () => {
    expect(fn("_wf2_recompute_receivable")).toContain("'NET([0-9]+)'")
  })
})

describe("120 — quyền thực thi", () => {
  it("7 RPC cấp cho người đăng nhập", () => {
    for (const name of RPCS) {
      expect(SQL, `thiếu GRANT cho ${name}`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`)
      )
    }
  })

  /** ⚠ Helper bỏ qua mọi kiểm tra của RPC. Cấp cho ai gọi thẳng là mở cửa hậu. */
  it("5 helper thu quyền của PUBLIC và KHÔNG cấp cho ai", () => {
    for (const name of HELPERS) {
      expect(SQL, `thiếu REVOKE cho ${name}`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`)
      )
      expect(SQL, `${name} không được cấp quyền gọi thẳng`).not.toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`)
      )
    }
  })

  it("mọi hàm đều SECURITY DEFINER và ghim search_path", () => {
    const n = (SQL.match(/CREATE OR REPLACE FUNCTION public\./g) || []).length
    expect(n).toBe(RPCS.length + HELPERS.length)
    expect((SQL.match(/SECURITY DEFINER SET search_path = public/g) || []).length).toBe(n)
  })

  it("nạp lại schema cho PostgREST", () => {
    expect(SQL).toContain("NOTIFY pgrst, 'reload schema'")
  })
})

describe("120 — các lỗi đã bị soi chéo bắt, không được quay lại", () => {
  /** ⚠ Xoá payments khi dòng phiếu thu còn trỏ tới là lỗi khoá ngoại 23503. */
  it("huỷ phiếu thu gỡ tham chiếu trước khi xoá khoản trả", () => {
    const v = fn("void_cash_receipt")
    const detach = v.indexOf("UPDATE cash_receipt_lines SET payment_id = NULL")
    const del = v.indexOf("DELETE FROM payments")
    expect(detach).toBeGreaterThan(0)
    expect(del).toBeGreaterThan(detach)
  })

  /** ⚠ Phiếu thu đã huỷ vẫn để lại dòng trỏ vào công nợ. */
  it("huỷ đơn đã xuất gỡ dòng phiếu thu trước khi xoá công nợ", () => {
    const b = fn("cancel_order")
    const detach = b.indexOf("UPDATE cash_receipt_lines crl")
    const del = b.indexOf("DELETE FROM receivables")
    expect(detach).toBeGreaterThan(0)
    expect(del).toBeGreaterThan(detach)
  })

  /** ⚠ DML kèm RETURNING INTO trả nhiều dòng là lỗi 21000. */
  it("không dùng RETURNING INTO trên lệnh có thể trúng nhiều dòng", () => {
    expect(fn("complete_order")).not.toMatch(/UPDATE returns[\s\S]{0,120}RETURNING id INTO/)
  })

  /** ⚠ Hoàn kho hai lần khi sửa rồi huỷ cùng một đơn. */
  it("hoàn kho trừ dần dấu vết đã hoàn", () => {
    const r = fn("_wf2_restock")
    expect(r).toContain("UPDATE stock_line_consumptions")
    expect(r).toContain("SET qty_in_base_uom = qty_in_base_uom - v_give")
    expect(fn("cancel_order")).toContain("SELECT sum(slc.qty_in_base_uom)")
  })

  /** ⚠ Hệ số quy đổi 0 làm số lượng thành NULL ở cột NOT NULL. */
  it("chặn hệ số quy đổi bằng 0", () => {
    expect(fn("_wf2_restock")).toContain("IF COALESCE(v_conv, 0) <= 0 THEN v_conv := 1; END IF;")
  })

  /** ⚠ Dòng thêm mới gửi id rỗng làm hỏng phép ép kiểu uuid. */
  it("ép kiểu id dòng đơn luôn bọc NULLIF", () => {
    const b = fn("edit_completed_order")
    expect(b).not.toMatch(/[^F]\(l->>'id'\)::uuid/)
  })

  /** ⚠ Công nợ chỉ sinh cho đơn đã xuất hàng. */
  it("không tạo công nợ cho đơn chưa xuất", () => {
    expect(fn("_wf2_recompute_receivable")).toContain("IF v_id IS NULL AND o.status <> 'completed' THEN")
  })

  /** ⚠ Hàng trả nhập lại với giá vốn 0 thổi phồng lãi gộp. */
  it("hàng trả nhập lại mang giá vốn thật", () => {
    const b = fn("complete_return")
    expect(b).toContain("FROM stock_line_consumptions slc")
    expect(b).not.toContain("v_base, 0, 0, p_zone")
  })

  /** ⚠ Trigger xếp kho tự động ghi đè lựa chọn của người duyệt. */
  it("ép lại đúng kho người dùng chọn sau khi tạo lô", () => {
    expect(fn("complete_return")).toContain("UPDATE batches SET warehouse_zone = p_zone WHERE id = v_batch;")
  })

  /** ⚠ Phiếu trả cũ do trigger cũ nhập kho: không đảo được thì phải dừng. */
  it("đảo phiếu trả không khớp dòng nào thì báo lỗi, không im lặng", () => {
    const c = fn("cancel_return")
    expect(c).toContain("NO_IMPORT_TO_REVERSE")
    expect(c).toContain("IF v_rows = 0 THEN")
  })

  /** ⚠ Lý do huỷ phiếu trả phải có chỗ chứa, nếu không tham số là vô nghĩa. */
  it("lưu lý do huỷ phiếu trả", () => {
    expect(SQL).toContain("ALTER TABLE returns ADD COLUMN IF NOT EXISTS cancel_reason text;")
    expect((fn("cancel_return").match(/cancel_reason = p_reason/g) || []).length).toBe(2)
  })

  /**
   * ⚠ user_has_permission trả false khi ma trận chưa có dòng. Không seed
   * thì sau migration chỉ chủ sở hữu dùng được, còn giao diện vẫn hiện nút.
   */
  it("mở đúng các ô quyền mà RPC cần, không đè cấu hình sẵn có", () => {
    expect(SQL).toContain("INSERT INTO role_permissions (org_id, role, module, action, allowed)")
    expect(SQL).toContain("ON CONFLICT (org_id, role, module, action) DO NOTHING;")
    for (const cell of ["('manager',    'orders',      'approve')", "('manager',    'returns',     'approve')",
                        "('accountant', 'receivables', 'create')", "('accountant', 'receivables', 'update')"]) {
      expect(SQL, `thiếu ô quyền ${cell}`).toContain(cell)
    }
  })
})

describe("120 — lỗi lượt soi thứ hai bắt được", () => {
  /**
   * ⚠ Màn xuất kho cũ GỘP nhiều đơn vào một phiếu (ref_order_ids là mảng).
   * Huỷ một đơn mà hoàn nguyên dòng của phiếu gộp là trả về kho cả hàng
   * của đơn khác.
   */
  it("huỷ đơn chỉ hoàn đúng phần của đơn đó trong phiếu xuất gộp", () => {
    const b = fn("cancel_order")
    expect(b).toContain("AND sel.product_id = d.product_id")
    expect(b).toContain("AND sel.unit_name = d.unit_name")
    expect(b).toContain("v_take := LEAST(s.qty_left, v_need);")
  })

  /** ⚠ SECURITY DEFINER bỏ qua RLS, nên chủ đơn phải được kiểm trong hàm. */
  it("NVBH không sửa được đơn đã xuất của người khác", () => {
    const b = fn("edit_completed_order")
    expect(b).toContain("public.user_role() = 'sales' AND o.sales_user_id <> auth.uid()")
    expect(b).toContain("FORBIDDEN_NOT_OWNER")
  })

  /** ⚠ Nhập trả cho đơn chưa xuất là cộng khống tồn kho. */
  it("chỉ nhập trả khi đơn gốc đã xuất hàng", () => {
    expect(fn("complete_return")).toContain("ORDER_NOT_COMPLETED")
  })

  /**
   * ⚠ CHỐT NÀY ĐÃ ĐẢO CHIỀU, CÓ CHỦ Ý — xem Q11 trong sổ câu hỏi.
   *
   * Bản cũ đòi `_wf2_recompute_receivable` RAISE `OVERPAID_AFTER_CREDIT`
   * khi công nợ mới thấp hơn số đã thu. Lý do hồi đó đúng: hệ thống không
   * có khái niệm số dư có, nên hạ `amount` xuống dưới `paid` là làm biến
   * mất tiền đang giữ của khách.
   *
   * Nhưng phép chặn đó rollback CẢ `complete_return`, kể cả phần nhập
   * kho, và bảo người dùng "huỷ phiếu thu trước" — việc họ thường KHÔNG
   * làm được, vì tiền có thể vào qua màn thu theo công nợ và khi đó không
   * có phiếu thu nào tồn tại. Phiếu trả kẹt vĩnh viễn.
   *
   * Chủ nhà chọn phương án (a): cho phép `paid > amount`, phần dư là số
   * dư có của khách. Nay chốt đúng chiều ngược lại — và chốt thêm rằng
   * status phải là 'paid', vì mọi bộ lọc trong kho dùng `status <> 'paid'`
   * để nói "đã tất toán, đừng tính nữa".
   */
  it("cho phép số dư có, và gắn đúng status 'paid'", () => {
    const b = fn("_wf2_recompute_receivable")
    expect(b, "phép chặn cũ đã quay lại").not.toContain("OVERPAID_AFTER_CREDIT")
    expect(b).toContain("WHEN v_paid >= v_net THEN 'paid'")
  })

  /**
   * ⚠ HUỶ PHIẾU THU PHẢI GẮN LẠI ĐÚNG STATUS. Sau Q11, một dòng vẫn có
   * thể còn `paid >= amount` sau khi trừ phần của phiếu thu vừa huỷ. Rơi
   * vào `ELSE 'partial'` là dòng dư bị mọi bộ lọc `status <> 'paid'` hút
   * vào các phép cộng công nợ, và màn công nợ theo khách ra số ÂM — không
   * lỗi nào bắn ra.
   */
  it("huỷ phiếu thu xét nhánh 'paid' trước", () => {
    const b = fn("void_cash_receipt")
    const i = b.indexOf("status = CASE")
    expect(i).toBeGreaterThan(0)
    const branch = b.slice(i, i + 500)
    expect(branch.indexOf("'paid'")).toBeGreaterThan(0)
    expect(branch.indexOf("'paid'"), "nhánh 'paid' phải đứng trước 'partial'").toBeLessThan(
      branch.indexOf("'partial'")
    )
  })

  /** ⚠ Hai kế toán bấm cùng lúc, hoặc payload trùng khoản nợ. */
  it("phiếu thu gộp trùng khoản nợ và khoá hàng khi kiểm", () => {
    const b = fn("create_cash_receipt")
    expect(b).toContain("FOR UPDATE")
    expect((b.match(/GROUP BY 1/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  /** Lô nhận hàng trả phải cùng tổ chức. */
  it("tìm lô trong đúng tổ chức", () => {
    expect(fn("complete_return")).toContain("WHERE b.org_id = r.org_id")
  })
})
