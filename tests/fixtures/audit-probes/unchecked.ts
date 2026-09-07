/**
 * Mã MỒI cho scripts/audit-unchecked-db.py — nhóm CHƯA KIỂM LỖI.
 *
 * Mỗi hình dạng ở đây là bản sinh đôi của một hình dạng trong checked.ts,
 * chỉ khác đúng một điều: phần kiểm lỗi bị bỏ. Máy dò phải bắt được TẤT CẢ.
 *
 * Đây là phần "thử phá" của cổng: nới lỏng máy dò cho hết báo nhầm là rất
 * dễ, và nới quá tay thì nó im lặng với cả lỗi thật. File này bắt lỗi đó.
 */
/* eslint-disable */
// @ts-nocheck

export async function probes(supabase: any, fetchAllForAggregate: any) {
  // 1. Hàm bọc, KHÔNG kiểm lỗi.
  const aRes = await fetchAllForAggregate((from: number, to: number) =>
    supabase
      .from("probe_wrapped_bad")
      .select("id, amount", { count: "exact" })
      .gt("amount", 0)
      .range(from, to)
  )
  console.log(aRes.rows.length)

  // 2. Promise.all, KHÔNG kiểm lỗi.
  const [bRes, cRes] = await Promise.all([
    supabase.from("probe_all_bad_a").select("id"),
    supabase.from("probe_all_bad_b").select("id", {
      count: "exact",
    }),
  ])
  console.log(bRes.data, cRes.data)

  // 3. Handler `.then`, KHÔNG kiểm lỗi.
  Promise.all([
    supabase.from("probe_then_bad").select("id"),
  ]).then(([fRes]) => {
    console.log(fRes.data)
  })

  // 4. Destructure không nhận biến lỗi, và ngay dưới có một khoá JSON
  //    trùng tên của việc KHÁC — đúng cái bẫy đã bỏ lọt một lỗi thật ở
  //    route đối soát. (Chú thích này cố tình không viết ra chữ tiếng Anh
  //    đó: cửa sổ soi tính cả dòng chú thích, viết vào là tự vô hiệu mồi.)
  const { data: taken } = await supabase
    .from("probe_json_error_key_bad")
    .select("id")
    .maybeSingle()
  if (taken) {
    return {
      error: "Đã nối với hoá đơn khác rồi.",
    }
  }

  // 5. GHI không kiểm lỗi — nhóm nguy hiểm nhất.
  await supabase.from("probe_write_bad").update({ checked_at: "now" }).eq("id", 1)

  // 6. `audit-ok` KHÔNG kèm lý do — chỉ là cách tắt cảnh báo cho tiện, nên
  //    vẫn phải kêu. Không có mồi này thì luật "bắt buộc có lý do" không
  //    được test nào giữ.
  // audit-ok:
  await supabase.from("probe_auditok_noreason").insert({ id: 3 })

  // 7. Đứng NGAY DƯỚI một câu lệnh đã kiểm đầy đủ. Máy dò không được mượn
  //    phần kiểm của hàng xóm — đó đúng là cách một lỗi thật lọt qua.
  const okRes = await Promise.all([
    supabase.from("probe_neighbour_ok").select("id"),
  ])
  if (okRes[0].error) console.error("lỗi:", okRes[0].error)

  const badPair = await Promise.all([
    supabase.from("probe_neighbour_bad_a").select("id"),
    supabase.from("probe_neighbour_bad_b").select("id"),
  ])
  console.log(badPair.length)

  // 8. Trong Promise.all, và ngay dưới có một khoá JSON trùng tên của việc
  //    KHÁC. Không ràng buộc với ĐÚNG biến vừa nhận kết quả thì chỗ này
  //    được coi là đã kiểm — im lặng đúng chiều nguy hiểm.
  const jsonRes = await Promise.all([
    supabase.from("probe_wrapper_json_key_bad").select("id"),
  ])
  if (!jsonRes[0].data) {
    return { error: "Không có dữ liệu." }
  }

  // 9. GHI trong nhánh, không kiểm lỗi.
  await supabase.from("probe_insert_bad").insert({
    id: 2,
    note: "không kiểm",
  })

  return null
}
