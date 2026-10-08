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

/* 17. Hàm DÀI có `if (… error) throw` ở đâu đó KHÔNG phải hàm bọc tự kiểm: dòng khai báo của nó không được coi là
       "lời gọi hàm bọc" bao quanh truy vấn trơn trong thân, và gọi nó quanh một truy vấn cũng không được tha. */
async function luuDai(supabase: any, q: any) {
  const { error } = await supabase.from("probe_long_fn_checked_x").update({ a: 1 }).eq("id", 1)
  if (error) throw error
  await supabase.from("probe_inside_long_fn_bad").update({ b: 2 }).eq("id", 1)
  console.log(1)
  console.log(2)
  console.log(3)
  console.log(4)
  console.log(5)
  console.log(6)
  console.log(7)
  console.log(8)
  return q
}

/* 18. Hàm bọc NGẮN, tự ném lỗi — nhưng dòng KHAI BÁO `async function nganCo(` không phải lời gọi bao quanh truy vấn
       trơn trong thân nó. */
async function nganCo(supabase: any, q: any) {
  await supabase.from("probe_inside_short_wrapper_bad").update({ c: 3 }).eq("id", 1)
  const { data, error } = await q
  if (error) throw error
  return data
}

/* 19. Handler `.then` CÓ kiểm lỗi của một câu lệnh KHÁC đứng đầu hàm — không được "cho mượn" phần kiểm. */
export function hamCoThenDaKiem(supabase: any) {
  supabase.from("probe_then_first_ok_x").select("id").then(({ data, error }) => {
    if (error) console.error("lỗi")
    console.log(data)
  })
  supabase.from("probe_after_checked_then_bad").delete().eq("id", 1)
  return nganCo
}

/* 21. Ngoặc LẺ trong chú thích / chuỗi / regex không được làm lệch độ sâu. Đếm thô thì phần dưới sâu thêm vài
       tầng, và lời gọi hàm bọc tự ném lỗi ở dòng trên thành "khối bao" của truy vấn trơn bên dưới → được tha. */
export async function ngoacLe(supabase: any, ghiPhaiTrungDong: any) {
  await ghiPhaiTrungDong(supabase.from("probe_ngoac_le_ok_x").delete().eq("id", 1)) // (chưa đóng
  const s = "(" + '[' + `{` + /\(/.source
  await supabase.from("probe_ngoac_le_bad").update({ a: s }).eq("id", 1)
}

export async function goiHamDai(supabase: any) {
  return luuDai(supabase, supabase.from("probe_long_fn_call_bad").select("id"))
}

export async function probes(
  supabase: any, fetchAllForAggregate: any, ghiPhaiTrungDong: any, boQuaLoi: any, sb: any, apSapXep: any, apLoc: any
) {
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

  // 10. Hàm bọc LẠ (không nằm trong danh sách tự ném lỗi) — không được tha.
  await boQuaLoi(supabase.from("probe_wrapper_unknown_bad").delete().eq("id", 1))

  // 11. Truy vấn trơn đứng NGAY DƯỚI một lời gọi hàm bọc tự ném lỗi — không được ăn theo.
  await ghiPhaiTrungDong(supabase.from("probe_ghi_trung_dong_neighbour_ok").delete().eq("id", 1))
  await supabase.from("probe_after_wrapper_bad").update({ ten: "x" }).eq("id", 1)

  // 12. Client `sb`, gán vào biến nhưng KHÔNG soi `.error` của biến ấy.
  let r1 = await sb.from("probe_let_sb_bad").insert({ id: 1 }).select("id").single()
  console.log(r1.data)

  // 13. Câu kiểm nằm QUÁ XA (hơn 8 dòng code) — bỏ dòng chú thích không có nghĩa là nới cửa sổ code.
  const [xaRes] = await Promise.all([
    supabase.from("probe_far_check_bad").select("id"),
  ])
  console.log(1)
  console.log(2)
  console.log(3)
  console.log(4)
  console.log(5)
  console.log(6)
  console.log(7)
  console.log(8)
  if (xaRes.error) console.error("muộn quá")

  // 14. Hàm bọc TRONG TỆP nhưng NUỐT lỗi (không ném) — không được coi là hàm bọc tự kiểm.
  const nuot = async (q: any) => {
    const { data: d2, error: loi } = await q
    if (loi) console.warn("bỏ qua")
    return d2 ?? []
  }
  const n1 = await nuot(sb.from("probe_local_swallow_bad").select("id"))
  console.log(n1)

  // 15. Query bọc trong hàm gắn thứ tự rồi await mà KHÔNG kiểm lỗi.
  let q2 = apSapXep(
    supabase.from("probe_builder_wrapped_bad").select("id"),
    "x"
  )
  const { data: d9 } = await q2
  console.log(d9)

  // 16. Kết quả đi vào một hàm LẠ (không có trong danh sách hàm bọc tự kiểm lỗi).
  const qLa = supabase.from("probe_builder_unknown_wrap_bad").select("id")
  console.log(boQuaLoi(await apLoc(qLa)))

  // 20. Await qua toán tử BA NGÔI mà KHÔNG kiểm lỗi.
  const coSoBad = supabase
    .from("probe_ternary_await_bad")
    .select("id")
  const { data: tnBad } = await (n1.length >= 2
    ? coSoBad.or("id.eq.1")
    : coSoBad
  )
  console.log(tnBad)

  // 9. GHI trong nhánh, không kiểm lỗi.
  await supabase.from("probe_insert_bad").insert({
    id: 2,
    note: "không kiểm",
  })

  return null
}
