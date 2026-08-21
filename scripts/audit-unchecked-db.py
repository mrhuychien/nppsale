#!/usr/bin/env python3
"""
Liệt kê các lời gọi Supabase KHÔNG kiểm tra lỗi.

Hai nhóm, mức nguy hiểm khác hẳn nhau:

  GHI (insert/update/delete/upsert/rpc) — NGUY HIỂM NHẤT.
    Người dùng bấm Lưu, giao diện báo thành công, nhưng dữ liệu KHÔNG vào
    database và không có cảnh báo nào. Mất dữ liệu thật sự.

  ĐỌC (select) — người dùng thấy danh sách rỗng thay vì thấy lỗi, nên
    không thể chẩn đoán. Khó chịu nhưng không mất dữ liệu.

Cách nhận biết "đã kiểm": trong PHẠM VI CẢ BIỂU THỨC — tính theo độ sâu
ngoặc chứ không phải một cửa sổ N dòng cố định — có xuất hiện `error`
(destructure `{ error }`, biến kết thúc bằng Err) hoặc `.throwOnError()`.

Chạy: python3 scripts/audit-unchecked-db.py [--json]
"""
import json
import os
import re
import sys

ROOTS = ["src/app", "src/components", "src/hooks", "src/lib"]
WRITE_OPS = ("insert", "update", "delete", "upsert", "rpc")
TRAILING_CHECK_LINES = 3


def iter_files():
    for root in ROOTS:
        for dirpath, _, names in os.walk(root):
            for n in names:
                if n.endswith((".ts", ".tsx")):
                    yield os.path.join(dirpath, n)


def span_end(lines, i):
    """
    Trả về chỉ số dòng KẾT THÚC của cả biểu thức supabase bắt đầu ở dòng `i`.

    Không thể dùng cửa sổ cố định N dòng: một chuỗi như
    `.from(...).insert({ 10 dòng }).select().single().throwOnError()` dài
    hơn mọi hằng số hợp lý, nên `.throwOnError()` ở cuối rơi ra ngoài cửa
    sổ → báo nhầm "chưa kiểm lỗi". Ngược lại, cửa sổ quá rộng lại nuốt
    biểu thức KẾ TIẾP và mượn chữ `error` của nó → bỏ sót lỗi thật.

    Cách làm: bám theo độ sâu ngoặc, và khi đã đóng hết thì đi tiếp chừng
    nào dòng sau vẫn còn nối chuỗi (bắt đầu bằng dấu chấm).
    """
    depth = 0
    for j in range(i, min(i + 60, len(lines))):
        depth += lines[j].count("(") - lines[j].count(")")
        if depth > 0:
            continue
        # Ngoặc đã cân bằng — câu lệnh còn nối sang dòng dưới không?
        #   "."     → nối chuỗi:  .eq(...).throwOnError()
        #   "?" ":" → nhánh của toán tử ba ngôi, phần kiểm lỗi nằm sau cả hai
        nxt = lines[j + 1].strip() if j + 1 < len(lines) else ""
        if nxt.startswith((".", "?", ":")):
            continue
        # Sau nhánh cuối của ternary còn dòng gán/kiểm lỗi: const { error } = await q
        if lines[j].strip().startswith((":", "?")):
            return j + 2
        return j + 1
    return min(i + 60, len(lines))


def checked_after(lines, end, window):
    """
    Mẫu phổ biến: kết quả gán vào biến rồi kiểm lỗi ở CÂU LỆNH KẾ TIẾP.
        const r = await supabase.from(...).insert(...)
        if (r.error) throw r.error

    Không thể xử lý bằng cách nới cửa sổ thêm N dòng — làm vậy sẽ mượn
    luôn phần kiểm lỗi của câu lệnh kế tiếp và bỏ sót lỗi thật:
        await supabase.from("payments").update(...)      ← CHƯA kiểm
        const { error } = await supabase.from(...)       ← của câu khác
        if (error) throw error

    Nên phải bám theo TÊN BIẾN: chỉ chấp nhận khi vài dòng sau có
    `<tên biến>.error`, đúng biến vừa gán.
    """
    m = re.search(r"(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?supabase", window)
    if not m:
        return False
    name = re.escape(m.group(1))
    after = "\n".join(lines[end : end + TRAILING_CHECK_LINES])
    return bool(re.search(r"\b%s\s*[?.]?\.\s*error\b" % name, after))


def span_start(lines, i):
    """
    Lùi về đầu CÂU LỆNH chứa dòng `i`, tối đa 12 dòng.

    Cần thiết vì phần `const { data, error } =` có thể nằm khá xa phía
    trên khi câu lệnh dùng toán tử ba ngôi:
        const { data, error } = existing
          ? await supabase.from(...).update(...)   ← dòng bị soi
          : await supabase.from(...).insert(...)
    Lùi cố định 4 dòng sẽ bỏ sót chữ `error` và báo nhầm.

    Quy tắc: dòng j thuộc cùng câu lệnh với dòng j+1 khi j+1 là phần NỐI
    TIẾP của nó — bắt đầu bằng `.` (nối chuỗi) hoặc `?` / `:` (nhánh
    ternary). Cứ lùi chừng nào điều đó còn đúng.

    Không dùng "dòng kết thúc bằng ; { }" làm mốc dừng: `setLoading(true)`
    kết thúc bằng `)` nên không khớp, và việc lùi sẽ chạy quá đầu câu lệnh.
    """
    j = i
    while j > 0 and j > i - 13:
        if not lines[j].strip().startswith((".", "?", ":")):
            break
        j -= 1
    return j


def promise_all_checked(lines, i):
    """
    Mẫu gom nhiều truy vấn:

        const [aRes, bRes] = await Promise.all([
          supabase.from("a").select(...),     ← từng phần tử KHÔNG có `error`
          supabase.from("b").select(...),
        ])
        const qErr = [aRes, bRes].find((r) => r?.error)?.error   ← kiểm ở đây

    Phần kiểm lỗi nằm SAU cả mảng nên không thể thấy được nếu chỉ soi trong
    phạm vi từng phần tử. Nếu không xử lý, mỗi phần tử bị báo nhầm một lần —
    và vài trăm cảnh báo giả sẽ chôn mất những lỗi thật.

    Cách làm: tìm ngược `Promise.all([` bao quanh, nhảy tới `])` đóng của nó,
    rồi soi vài dòng ngay sau xem có kiểm lỗi không.
    """
    open_at = None
    for j in range(i, max(-1, i - 80), -1):
        if "Promise.all([" in lines[j]:
            open_at = j
            break
        # Gặp đầu một câu lệnh khác → không nằm trong Promise.all nào.
        if lines[j].strip().endswith((";", "{", "}")):
            return False
    if open_at is None:
        return False

    # Chỉ đếm ngoặc vuông TỪ SAU token `Promise.all([`. Dòng mở thường là
    # `] = await Promise.all([` — phần `]` bên trái thuộc về destructure,
    # nếu đếm luôn thì hai dấu triệt tiêu nhau và mảng bị coi là đóng ngay.
    head = lines[open_at].split("Promise.all([", 1)[1]
    depth = 1 + head.count("[") - head.count("]")
    for j in range(open_at, min(open_at + 200, len(lines))):
        if j > open_at:
            depth += lines[j].count("[") - lines[j].count("]")
        if j > open_at and depth <= 0:
            after = "\n".join(lines[j : j + 6])
            return bool(re.search(r"\berror\b|\w+Err\b", after))
    return False


def builder_checked(lines, i):
    """
    Mẫu dựng query dần rồi mới await:

        let q = supabase.from("x").select(...)      ← chỗ bị soi
        if (filter) q = q.eq(...)
        const { data, error } = await q             ← kiểm lỗi ở đây

    Phần kiểm lỗi cách chỗ khai báo cả chục dòng nên không nằm trong phạm
    vi biểu thức. Cách xử lý: lấy tên biến rồi tìm chỗ nó được await (hoặc
    truyền vào selectResilient / trả về cho hàm gọi) và soi ở đó.
    """
    # `i` thường trỏ vào dòng `.from("x")` giữa chuỗi, nên phải lùi về đầu
    # câu lệnh mới thấy được `let q = supabase`.
    head = span_start(lines, i)
    m = re.match(r"\s*(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=", lines[head])
    if not m:
        return False
    name = re.escape(m.group(1))
    for j in range(i + 1, min(i + 60, len(lines))):
        # Query được nhét vào một Promise.all — phần kiểm lỗi nằm ở đó.
        if re.match(r"\s*%s\s*,?\s*$" % name, lines[j]):
            return promise_all_checked(lines, j)
        if re.search(r"await\s+%s\b" % name, lines[j]):
            return bool(re.search(r"\berror\b|\w+Err\b", "\n".join(lines[max(0, j - 2) : j + 4])))
        # Trả query ra ngoài (build = (select) => ...) → nơi gọi chịu trách nhiệm.
        if re.search(r"return\s+%s\b" % name, lines[j]):
            return True
    return False


def analyse(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out = []
    for i, line in enumerate(lines):
        if "supabase" not in line and ".from(" not in line and "await" not in line:
            continue
        # Điểm bắt đầu một lời gọi Supabase.
        # Loại trừ Buffer.from()/Array.from()/Object.from() — không phải DB.
        if re.search(r"\b(Buffer|Array|Object|Set|Map)\.from\(", line):
            continue
        # Tên bảng luôn là chuỗi: .from("orders"). Tránh khớp .from(bienSo).
        if not re.search(r'(await\s+)?supabase\s*[\.\n]|\.from\(\s*["\']', line):
            continue

        end = span_end(lines, i)
        # Ít nhất 3 dòng phía trên: đủ để thấy `const { data, error } =` và
        # ghi chú `// audit-ok:` đặt ngay trên lời gọi. Câu lệnh dài hơn thì
        # span_start lùi xa hơn.
        start = min(span_start(lines, i), max(0, i - 3))
        window = "\n".join(lines[start:end])
        # Xác định loại thao tác trong cửa sổ
        op = None
        for w in WRITE_OPS:
            if re.search(r"\.%s\(" % w, window):
                op = "ghi"
                break
        if op is None:
            if ".select(" in window:
                op = "doc"
            else:
                continue

        # Đã kiểm lỗi chưa? Bốn cách, tương ứng bốn cách viết trong dự án.
        checked = (
            re.search(r"\berror\b|\w+Err\b", window)
            or "selectResilient" in window
            or "throwOnError" in window
            or checked_after(lines, end, window)
            or promise_all_checked(lines, i)
            or builder_checked(lines, i)
        )
        if checked:
            continue

        # Bỏ qua khai báo hàm dựng query (build = (select) => ...)
        if re.search(r"const\s+build\s*=", line):
            continue

        # Lối thoát có chủ đích: một số chỗ CỐ Ý không kiểm lỗi (ví dụ ghi
        # log best-effort trong catch — nếu ghi log cũng hỏng thì cũng
        # không làm gì được). Đánh dấu bằng `// audit-ok: <lý do>` ngay
        # trên lời gọi. Bắt buộc có lý do để không bị lạm dụng làm cách
        # tắt cảnh báo cho tiện.
        if re.search(r"//\s*audit-ok:\s*\S", window):
            continue

        out.append({
            "file": path,
            "line": i + 1,
            "op": op,
            "code": line.strip()[:110],
            "_end": end,
        })
    return out


def main():
    findings = []
    for f in sorted(iter_files()):
        findings += analyse(f)

    # Khử trùng theo SPAN, không theo khoảng cách dòng: một biểu thức nhiều
    # dòng khớp ở cả dòng `await supabase` lẫn dòng `.from(...)` — chỉ báo
    # một lần. Dùng khoảng cách cố định sẽ nuốt mất lời gọi kế tiếp khi hai
    # lời gọi nằm sát nhau.
    dedup, covered = [], {}
    for f in findings:
        if f["line"] < covered.get(f["file"], 0):
            continue
        covered[f["file"]] = f.pop("_end")
        dedup.append(f)

    if "--json" in sys.argv:
        print(json.dumps(dedup, ensure_ascii=False, indent=1))
        return 0

    ghi = [f for f in dedup if f["op"] == "ghi"]
    doc = [f for f in dedup if f["op"] == "doc"]
    print(f"GHI không kiểm lỗi (mất dữ liệu): {len(ghi)}")
    print(f"ĐỌC không kiểm lỗi (rỗng im lặng): {len(doc)}")
    print()

    for f in dedup:
        print(f"  {f['op'].upper()}  {f['file']}:{f['line']}  {f['code']}")

    # Cả hai con số hiện đang bằng 0. Chạy kèm --strict trong CI để giữ
    # nguyên như vậy: thêm một truy vấn không kiểm lỗi là build đỏ ngay,
    # thay vì lặng lẽ tích lũy lại như trước.
    if "--strict" in sys.argv and dedup:
        print(
            "\nLỖI: có truy vấn chưa kiểm lỗi. Thêm `error` vào destructure,"
            "\n     hoặc `.throwOnError()` nếu đang ở trong try/catch."
            "\n     Nếu CỐ Ý bỏ qua, ghi `// audit-ok: <lý do>` ngay trên lời gọi."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
