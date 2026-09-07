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
    # Đối số không phải cờ = thư mục cần quét, thay cho ROOTS. Dùng để
    # tests/audit-detector.test.ts soi chính máy dò này bằng mã mồi: một
    # máy dò không có test thì lần sau nới lỏng cũng không ai biết.
    roots = [a for a in sys.argv[1:] if not a.startswith("-")] or ROOTS
    for root in roots:
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
    # Dòng trên kết thúc bằng `=` / `=>` thì câu lệnh vẫn còn tiếp:
    #     const build = (select: string) =>
    #       supabase.from("batches").select(select)…
    # Không lùi qua nó thì không thấy được `const build =`, và một hàm dựng
    # query bị coi là truy vấn chưa kiểm lỗi.
    while j > 0 and j > i - 13 and lines[j - 1].rstrip().endswith(("=", "=>")):
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

    Cách làm CŨ là dò ngược tới chữ `Promise.all([`, và dừng lại khi gặp một
    dòng kết thúc bằng `;` `{` `}` — coi đó là đầu một câu lệnh khác.

    ⚠ MỐC DỪNG ĐÓ SAI, và đã trả giá: một phần tử bình thường của mảng cũng
    kết thúc bằng `}`:

        supabase.from("batches").select("id, qty", {
          count: "exact",                      ← dòng này…
        })                                     ← …và dòng này kết thúc bằng `}`

    Gặp nó là hàm bỏ cuộc giữa chừng và báo "không nằm trong Promise.all
    nào", dù đang đứng ngay trong một cái. Nay dùng ĐỘ SÂU NGOẶC thay cho
    hình dạng cuối dòng — xem `enclosing_assignment`, hàm này chỉ còn là lớp
    vỏ mỏng gọi sang đó.
    """
    return enclosing_assignment_checked(lines, line_depths(lines), i)


def line_depths(lines):
    """Độ sâu ngoặc (gộp cả ba loại) tại ĐẦU mỗi dòng."""
    d, out = 0, []
    for l in lines:
        out.append(d)
        d += l.count("(") + l.count("[") + l.count("{")
        d -= l.count(")") + l.count("]") + l.count("}")
    return out


def enclosing_assignment_checked(lines, depths, i):
    """
    Truy vấn nằm LỒNG trong một câu lệnh, và phần kiểm lỗi ở ngay SAU câu
    lệnh đó. Ba hình dạng đang dùng trong dự án:

        const [aRes, bRes] = await Promise.all([
          supabase.from("a").select(...),          ← chỗ bị soi
          supabase.from("b").select(...),
        ])
        const qErr = [aRes, bRes].find((r) => r?.error)?.error   ← kiểm ở đây

        const res = await fetchAllForAggregate((from, to) =>
          supabase.from("x").select(..., { count: "exact" }).range(from, to)
        )                                          ← truy vấn là ĐỐI SỐ
        if (res.error) console.error(...)          ← kiểm ở đây

        Promise.all([
          supabase.from("a").select(...),
        ]).then(([aRes, bRes]) => {
          const vErr = aRes.error || bRes.error    ← kiểm trong THÂN handler
        })

    ⚠ Hình dạng thứ hai là thứ đã làm cổng này đỏ suốt 30 commit. Nó xuất
    hiện khi các trang báo cáo chuyển sang `fetchAllForAggregate` để lấy đủ
    dòng; phần kiểm lỗi vẫn còn nguyên, chỉ là máy dò không nhìn thấy. 35
    trong 38 cảnh báo lúc đó là BÁO NHẦM — và chính vì chúng mà cái cổng
    này bị bỏ mặc, kéo theo 3 lỗi THẬT nằm lẫn trong đống báo nhầm.
    """
    for j in ancestors(lines, depths, i):
        names = assigned_names(lines, j)
        # `const { data, error } = …` — đã kiểm ngay tại chỗ gán.
        if "error" in names:
            return True
        end = statement_end(lines, depths, j)
        if names and trailing_checked(lines, end, names):
            return True
        # Không có phép gán: phần nhận kết quả có thể là handler `.then(…)`,
        # và khi đó chỗ kiểm lỗi nằm TRONG thân handler chứ không phải sau
        # câu lệnh — `end` lúc này đã trỏ ra tận sau dấu `})` đóng handler.
        if not names:
            for k in range(j, end):
                if ".then(" not in lines[k] or "=>" not in lines[k]:
                    continue
                params = handler_params(lines, k)
                if params and trailing_checked(lines, k + 1, params):
                    return True
                break
    return False


def ancestors(lines, depths, i, limit=120):
    """
    Các dòng MỞ khối đang bao quanh dòng `i`, từ trong ra ngoài.

    Dòng j bao quanh dòng i khi ngoặc nó mở vẫn còn mở tại i — tức
    `depths[j]` nhỏ hơn mọi độ sâu trong khoảng (j, i]. Đây là chỗ cách làm
    trước đó sai: nó nhận cả những câu lệnh ANH EM đứng trên (cùng độ sâu,
    đã đóng xong), rồi mượn phần kiểm lỗi của chúng.
    """
    m = depths[i]
    for j in range(i - 1, max(-1, i - limit), -1):
        if depths[j] < m:
            m = depths[j]
            yield j


CONT_ENDINGS = ("=", "=>", "&&", "||", "(", "[", ",")


def assigned_names(lines, start):
    """
    Tên các biến được gán cho câu lệnh mở ở dòng `start`, hoặc [].

    Phải gom NGƯỢC lên nhiều dòng vì phần `const … =` hay nằm cách chỗ mở
    ngoặc:

        const [                       ← tên biến bắt đầu ở đây
          orderList,
          expensesRes,
        ] = await Promise.all([       ← còn đây mới là dòng mở khối

    Điều kiện dừng: dòng phía trên không kết thúc bằng dấu nối tiếp. Nhờ vậy
    `Promise.all([` đứng ngay dưới `setLoading(true)` KHÔNG mượn được tên
    của `const supabase = createClient()` ở xa hơn nữa.
    """
    text = lines[start]
    j = start
    while start - j < 20:
        m = re.search(r"=(?!=|>)", text)
        if m and re.search(r"\b(?:const|let|var)\b", text[: m.start()]):
            return [
                w
                for w in re.findall(r"[A-Za-z_$][\w$]*", text[: m.start()])
                if w not in ("const", "let", "var", "await")
            ]
        if j == 0 or not lines[j - 1].rstrip().endswith(CONT_ENDINGS):
            return []
        j -= 1
        text = lines[j] + "\n" + text
    return []


def handler_params(lines, close_line):
    """
    Tham số của `.then((…) => {` nằm ở dòng ĐÓNG của câu lệnh.

        }).then(([balRes, prodRes]) => {

    Không có phép gán nào, nhưng `balRes` / `prodRes` chính là chỗ nhận kết
    quả — kiểm lỗi nằm trong thân handler ngay dưới.
    """
    if close_line < 0 or ".then(" not in lines[close_line]:
        return []
    tail = lines[close_line].split(".then(", 1)[1]
    m = re.match(r"\s*\(?\s*[\[\{]?([^)\]\}]*)", tail)
    if not m:
        return []
    return re.findall(r"[A-Za-z_$][\w$]*", m.group(1))


def trailing_checked(lines, end, names, span=8):
    """
    Vài dòng ngay sau câu lệnh có kiểm lỗi CỦA ĐÚNG BIẾN vừa nhận kết quả
    không?

    ⚠ PHẢI GẮN VỚI TÊN BIẾN, không chỉ "có chữ error đâu đó trong vùng".
    Đã trả giá: route đối soát có

        const { data: taken } = await admin.from("misa_invoice_snapshots")…
        if (taken) return NextResponse.json({ error: "…đã nối rồi" })

    Chữ `error:` ở đây là KHOÁ CỦA JSON TRẢ VỀ, chẳng liên quan gì tới việc
    truy vấn có lỗi hay không — mà truy vấn đó thì thật sự không kiểm. Nới
    tới mức nhận cả nó là bỏ lọt một lỗi thật.
    """
    names = set(names)
    for line in lines[end : end + span]:
        for n in names:
            if re.search(r"\b%s\s*[?.]?\.\s*error\b" % re.escape(n), line):
                return True
            # Cùng MỘT DÒNG: `const qErr = ([aRes] as Array<{ error?… }>)`
            if re.search(r"\b%s\b" % re.escape(n), line) and re.search(r"\berror\b", line):
                return True
        # Bí danh: `const batchRes = results[2]` rồi mới `if (batchRes.error)`.
        m = re.match(r"\s*(?:const|let)\s+(?:\[([^\]]*)\]|([A-Za-z_$][\w$]*))\s*=\s*(.+)", line)
        if m and any(re.search(r"\b%s\b" % re.escape(n), m.group(3)) for n in names):
            names |= set(re.findall(r"[A-Za-z_$][\w$]*", m.group(1) or m.group(2) or ""))
    return False


def statement_end(lines, depths, start):
    """Chỉ số dòng ngay SAU câu lệnh mở ở `start` (theo độ sâu ngoặc)."""
    base = depths[start]
    for k in range(start, min(start + 200, len(lines) - 1)):
        if depths[k + 1] > base:
            continue
        nxt = lines[k + 1].strip()
        # Còn nối chuỗi / còn nhánh ternary thì câu lệnh chưa hết.
        if nxt.startswith((".", "?", ":")):
            continue
        return k + 1
    return min(start + 200, len(lines))


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
    depths = line_depths(lines)
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
        # Cửa sổ soi = ĐÚNG câu lệnh này, không hơn. `span_start` lùi tới đầu
        # câu lệnh nên `const { data, error } =` ở trên vẫn nằm trong.
        #
        # ⚠ Trước đây còn lùi cứng thêm 3 dòng nữa. Ba dòng đó thường thuộc
        # câu lệnh KHÁC, và chỉ cần câu lệnh trên có kiểm lỗi là câu lệnh
        # dưới được ăn theo:
        #     const okRes = await …            ← đã kiểm
        #     if (okRes.error) …               ← chữ `error` nằm đây
        #     const badRes = await supabase…   ← KHÔNG kiểm, mà được tha
        # Chính cái docstring của hàm `checked_after` cảnh báo lỗi này, rồi
        # `analyse` lại tự mắc.
        start = span_start(lines, i)
        window = "\n".join(lines[start:end])
        # Ghi chú `// audit-ok:` thì được phép đứng NGAY TRÊN lời gọi — nó là
        # chú thích của lời gọi, không phải của câu lệnh trên.
        preamble = "\n".join(lines[max(0, i - 3) : start])
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
            or enclosing_assignment_checked(lines, depths, i)
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
        # `[^\S\n]*` chứ KHÔNG phải `\s*`: `\s` gồm cả ký tự xuống dòng, nên
        # `// audit-ok:` bỏ trống vẫn khớp — nó nuốt dấu xuống dòng rồi lấy
        # chữ đầu của DÒNG KẾ TIẾP làm "lý do". Luật "bắt buộc có lý do" khi
        # đó chỉ còn trên giấy.
        if re.search(r"//[^\S\n]*audit-ok:[^\S\n]*\S", preamble + "\n" + window):
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
