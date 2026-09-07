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

export async function probes(supabase: any, fetchAllForAggregate: any, selectResilient: any) {
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

  return { data }
}
