#!/usr/bin/env python3
"""
Liệt kê các lời gọi Supabase KHÔNG kiểm tra lỗi.

Hai nhóm, mức nguy hiểm khác hẳn nhau:

  GHI (insert/update/delete/upsert/rpc) — NGUY HIỂM NHẤT.
    Người dùng bấm Lưu, giao diện báo thành công, nhưng dữ liệu KHÔNG vào
    database và không có cảnh báo nào. Mất dữ liệu thật sự.

  ĐỌC (select) — người dùng thấy danh sách rỗng thay vì thấy lỗi, nên
    không thể chẩn đoán. Khó chịu nhưng không mất dữ liệu.

Cách nhận biết "đã kiểm": trong ~12 dòng sau lời gọi có xuất hiện `error`
(destructure `{ error }`, `.error`, hoặc biến kết thúc bằng Err/error).

Chạy: python3 scripts/audit-unchecked-db.py [--json]
"""
import json
import os
import re
import sys

ROOTS = ["src/app", "src/components", "src/hooks", "src/lib"]
WRITE_OPS = ("insert", "update", "delete", "upsert", "rpc")
LOOKAHEAD = 12


def iter_files():
    for root in ROOTS:
        for dirpath, _, names in os.walk(root):
            for n in names:
                if n.endswith((".ts", ".tsx")):
                    yield os.path.join(dirpath, n)


def analyse(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out = []
    for i, line in enumerate(lines):
        if "supabase" not in line and ".from(" not in line and "await" not in line:
            continue
        # Điểm bắt đầu một lời gọi Supabase
        if not re.search(r"(await\s+)?supabase\s*[\.\n]|\.from\(", line):
            continue

        # Cửa sổ phải gồm CẢ phần phía trên: với chuỗi nhiều dòng, phần
        # `const { error } = await supabase` nằm TRƯỚC dòng `.from(...)`,
        # nên chỉ quét xuôi sẽ bỏ sót và báo nhầm là "chưa kiểm lỗi".
        window = "\n".join(lines[max(0, i - 4) : i + LOOKAHEAD])
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

        # Đã kiểm lỗi chưa?
        checked = bool(
            re.search(r"\berror\b", window)
            or re.search(r"\w+Err\b", window)
            or "selectResilient" in window
            or "throwOnError" in window
        )
        if checked:
            continue

        # Bỏ qua khai báo hàm dựng query (build = (select) => ...)
        if re.search(r"const\s+build\s*=", line):
            continue

        out.append({
            "file": path,
            "line": i + 1,
            "op": op,
            "code": line.strip()[:110],
        })
    return out


def main():
    findings = []
    for f in sorted(iter_files()):
        findings += analyse(f)

    # Khử trùng: chỉ giữ 1 phát hiện cho mỗi cụm dòng gần nhau trong 1 file
    dedup, last = [], {}
    for f in findings:
        prev = last.get(f["file"])
        if prev is not None and f["line"] - prev < LOOKAHEAD:
            last[f["file"]] = f["line"]
            continue
        last[f["file"]] = f["line"]
        dedup.append(f)

    if "--json" in sys.argv:
        print(json.dumps(dedup, ensure_ascii=False, indent=1))
        return

    ghi = [f for f in dedup if f["op"] == "ghi"]
    doc = [f for f in dedup if f["op"] == "doc"]
    print(f"GHI không kiểm lỗi (mất dữ liệu): {len(ghi)}")
    print(f"ĐỌC không kiểm lỗi (rỗng im lặng): {len(doc)}")
    print()

    by_file = {}
    for f in ghi:
        by_file.setdefault(f["file"], 0)
        by_file[f["file"]] += 1
    print("Top file có thao tác GHI chưa kiểm:")
    for path, n in sorted(by_file.items(), key=lambda x: -x[1])[:20]:
        print(f"  {n:3d}  {path}")


if __name__ == "__main__":
    main()
