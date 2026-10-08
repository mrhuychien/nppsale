/**
 * Mã MỒI cho scripts/audit-unchecked-db.py — nhóm ĐÃ KIỂM LỖI.
 *
 * Mọi truy vấn dưới đây đều có phần kiểm lỗi. Máy dò phải im lặng với cả
 * file này. Mỗi hình dạng là một cách viết CÓ THẬT trong dự án; hình dạng
 * `fetchAllForAggregate` chính là thứ từng làm máy dò báo nhầm 35 chỗ và
 * khiến cổng CI bị bỏ mặc suốt 30 commit.
 *
 * File này không nằm trong ROOTS nên không bị quét lúc chạy thường; chỉ
 * tests/audit-detector.test.ts trỏ thẳng vào đây.
 */
/* eslint-disable */
// @ts-nocheck

/* 15b. Hàm bọc khai báo trong tệp bằng `async function` — thân có `if (r.error) throw`. */
async function docDuTrongTep<T>(fetchAllForAggregate: any, build: any): Promise<T[]> {
  const r = await fetchAllForAggregate(build)
  if (r.error) throw new Error(r.error)
  return r.rows
}

export async function probes(
  supabase: any, fetchAllForAggregate: any, selectResilient: any,
  ghiPhaiTrungDong: any, docDuHoacNem: any, docTheoLoId: any, ids: string[],
  sb: any, docDemNhom: any, docThongKeNgay: any, apLoc: any, apSapXep: any, locTrangThai: any, applyFilters: any,
  days: string[]
) {
  // 1. Truy vấn là ĐỐI SỐ của một hàm bọc, kiểm lỗi ở câu lệnh ngay sau.
  const aRes = await fetchAllForAggregate((from: number, to: number) =>
    supabase
      .from("probe_wrapped_ok")
      .select("id, amount", { count: "exact" })
      .gt("amount", 0)
      .range(from, to)
  )
  if (aRes.error) console.error("lỗi:", aRes.error)

  // 2. Promise.all, kiểm lỗi gom một lượt sau khi mảng đóng.
  const [bRes, cRes] = await Promise.all([
    supabase.from("probe_all_ok_a").select("id"),
    supabase.from("probe_all_ok_b").select("id", {
      count: "exact",
    }),
  ])
  const qErr = ([bRes, cRes] as Array<{ error?: { message?: string } | null }>)
    .find((r) => r?.error)?.error
  if (qErr) console.error("lỗi:", qErr.message)

  // 3. Destructure xuống dòng — tên biến cách chỗ mở ngoặc vài dòng.
  const [
    dRes,
    eRes,
  ] = await Promise.all([
    supabase.from("probe_multiline_ok_a").select("id"),
    supabase.from("probe_multiline_ok_b").select("id"),
  ])
  if (dRes.error || eRes.error) console.error("lỗi")

  // 4. Handler `.then` — chỗ kiểm nằm TRONG thân handler.
  Promise.all([
    supabase.from("probe_then_ok_a").select("id"),
    supabase.from("probe_then_ok_b").select("id"),
  ]).then(([fRes, gRes]) => {
    const vErr = fRes.error || gRes.error
    if (vErr) console.error("lỗi:", vErr.message)
  })

  // 5. Bí danh: kết quả được đặt tên lại rồi mới kiểm.
  const results = await Promise.all([
    supabase.from("probe_alias_ok").select("id"),
  ])
  const hRes = results[0]
  if (hRes.error) console.error("lỗi:", hRes.error)

  // 6. Hàm dựng query rồi mới await — phần kiểm lỗi nằm ở chỗ gọi.
  const build = (select: string) =>
    supabase.from("probe_builder_ok").select(select).order("id")
  const buildRes = await selectResilient(build, "id, name", "*")
  if (buildRes.error) console.error("lỗi:", buildRes.error)

  // 7. Destructure có sẵn `error`.
  const { data, error } = await supabase.from("probe_destructure_ok").select("id")
  if (error) console.error("lỗi:", error)

  // 8. Ghi có `.throwOnError()`.
  await supabase.from("probe_throw_ok").insert({ id: 1 }).throwOnError()

  // 9. Cố ý bỏ qua, có ghi lý do.
  // audit-ok: ghi log best-effort, hỏng cũng không làm gì được
  await supabase.from("probe_auditok").insert({ id: 1 })

  // 10. Đối số của hàm bọc TỰ NÉM LỖI — cùng dòng, và khác dòng.
  await ghiPhaiTrungDong(supabase.from("probe_ghi_trung_dong_ok").delete().eq("id", 1))
  await ghiPhaiTrungDong(
    supabase
      .from("probe_ghi_trung_dong_multi_ok")
      .update({ ten: "x" })
      .eq("id", 1)
  )
  const du = await docDuHoacNem<{ id: string }>(
    (from: number, to: number) =>
      supabase
        .from("probe_doc_du_ok")
        .select("id", { count: "exact" })
        .order("id")
        .range(from, to),
    "đọc mồi"
  )
  const lo = await docTheoLoId<{ id: string }>(
    ids,
    (l: string[], from: number, to: number) =>
      supabase.from("probe_theo_lo_ok").select("id", { count: "exact" }).in("id", l).order("id").range(from, to),
    "đọc mồi theo lô"
  )

  // 11. Client tên khác `supabase` (`sb`), gán lại không `let` — kiểm ngay dòng dưới (lib/customers/tao-khach.ts).
  let res = await sb.from("probe_let_sb_ok").insert({ id: 1 }).select("id").single()
  if (res.error && res.error.code === "PGRST204") {
    res = await sb.from("probe_reassign_ok").insert({ id: 1 }).select("id").single()
  }
  if (res.error) throw res.error

  // 12. Khối CHÚ THÍCH dài giữa câu đọc và câu kiểm (dashboard) — chú thích không tính vào cửa sổ.
  const [kRes, mRes] = await Promise.all([
    supabase.rpc("probe_rpc_comment_gap_ok", { p: 1 }),
    supabase.from("probe_comment_gap_ok").select("id"),
  ])
  /**
   * ⚠ Chú thích giải thích vì sao phải ném.
   *   dòng 2
   *   dòng 3
   *   dòng 4
   *   dòng 5
   *   dòng 6
   *   dòng 7
   */
  // và một dòng chú thích nữa
  const kErr = ([kRes, mRes] as Array<{ error?: unknown }>).find((r) => r?.error)?.error
  if (kErr) throw kErr

  // 13. Kiểu tham số LỒNG (`<Record<string, unknown>>`) và kiểu chạy NHIỀU DÒNG (`<{ … }>(`) của hàm bọc tự ném.
  const longKieu = await docDuHoacNem<Record<string, unknown>>(
    (a: number, b: number) =>
      supabase
        .from("probe_generic_nested_ok")
        .select("id", { count: "exact" })
        .order("id")
        .range(a, b),
    "đọc mồi"
  )
  const nhieuDong = await docTheoLoId<{
    id: string
  }>(
    ids,
    (l: string[], from: number, to: number) =>
      supabase
        .from("probe_generic_multiline_ok")
        .select("id", { count: "exact" })
        .in("id", l)
        .order("id")
        .range(from, to),
    "đọc mồi theo lô"
  )

  // 14. Hàm bọc lỗi → `null` (nơi gọi có đường lùi): docDemNhom / docThongKeNgay.
  const nhom = docDemNhom(await apLoc(supabase.from("probe_dem_nhom_ok").select("status, count()")))
  const qDem = supabase.from("probe_dem_nhom_builder_ok").select("status, count()")
  const nhom2 = docDemNhom(await apLoc(qDem))
  const tk = await docThongKeNgay(
    days,
    (from: number, to: number) => supabase.from("probe_thong_ke_ngay_ok").select("id", { count: "exact" }).range(from, to),
    (r: any) => r.ngay,
    (r: any) => r.tien
  )

  // 15. Hàm bọc KHAI BÁO TRONG TỆP, thân có `if (error) throw` (components/bao-cao/xem-nhanh.tsx, lib/opening-balance/io.ts).
  const mot = async (q: any) => {
    const { data: d1, error: loi } = await q
    if (loi) throw new Error(loi.message)
    return d1
  }
  const m1 = await mot(sb.from("probe_local_wrapper_ok").select("id").eq("id", 1).maybeSingle())
  const m2 = await docDuTrongTep(fetchAllForAggregate, (from: number, to: number) =>
    sb.from("probe_local_fn_ok").select("id", { count: "exact" }).order("id").range(from, to)
  )

  // 16. Query bọc trong hàm gắn thứ tự / bộ lọc (KHÔNG await), trả cho nơi gọi qua hàm gắn bộ lọc (các màn danh sách).
  //     (Tên biến KHÁC nhau giữa hai mồi: trùng tên thì mồi này mượn được phần kiểm của mồi kia.)
  const taoQ = (dem: boolean) => {
    let qDs = apSapXep(
      supabase.from("probe_builder_wrapped_ok").select("id", dem ? { count: "exact" } : undefined),
      "x"
    )
    qDs = locTrangThai(qDs, "posted")
    return applyFilters(qDs as never) as typeof qDs
  }
  const demTrangThai = async (st: string | null) => {
    let qDem2 = supabase.from("probe_count_await_wrapped_ok").select("id", { count: "exact", head: true })
    if (st) qDem2 = qDem2.eq("status", st)
    const { count, error: demErr } = await applyFilters(qDem2 as never)
    if (demErr) console.error("đếm hỏng")
    return count ?? 0
  }

  // 17. Query await qua toán tử BA NGÔI (inventory/stocktake-adjust).
  const coSo = supabase
    .from("probe_ternary_await_ok")
    .select("id")
    .limit(60)
  const { data: tn, error: tnErr } = await (ids.length >= 2
    ? coSo.or("id.eq.1")
    : coSo
  ).abortSignal(undefined)
  if (tnErr) console.warn("lỗi")

  return { data, du, lo, longKieu, nhieuDong, nhom, nhom2, tk, m1, m2, taoQ, demTrangThai, tn }
}
