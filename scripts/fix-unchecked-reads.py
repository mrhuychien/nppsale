#!/usr/bin/env python3
"""
Làm các truy vấn ĐỌC Supabase hết "rỗng im lặng".

VẤN ĐỀ: rất nhiều chỗ viết `const { data } = await supabase...select()`
và bỏ qua `error`. Khi truy vấn hỏng (lệch schema, RLS chặn, mất mạng),
`data` là null → giao diện hiện "không có dữ liệu". Người dùng tưởng
không có gì, còn lập trình viên không có manh mối nào để lần ra.

CÁCH SỬA (tối thiểu, an toàn): thêm `error` vào destructure và ghi
console.error kèm tên file. Không đổi luồng xử lý, không đổi giao diện —
nên không thể gây hồi quy, mà lại làm mọi sự cố về sau chẩn đoán được.

Các trang danh sách CHÍNH đã được xử lý kỹ hơn bằng selectResilient
(hiện banner lỗi cho người dùng); script này lo phần đuôi dài còn lại.

Chạy: python3 scripts/fix-unchecked-reads.py [--apply]
"""
import json
import re
import subprocess
import sys

# `const { data } = await supabase` hoặc `const { data: ten } = await supabase`
DESTRUCT_RE = re.compile(
    r"const\s*\{\s*data(?:\s*:\s*(?P<alias>\w+))?\s*\}\s*=\s*await\s+supabase\b"
)


def expression_end(src: str, start: int) -> int:
    i, depth, n = start, 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            qu = c
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == qu:
                    break
                i += 1
        elif c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth < 0:
                return i
        elif depth == 0 and c == "\n":
            j = i + 1
            while j < n and src[j] in " \t\n":
                j += 1
            if j < n and src[j] == ".":
                i = j
                continue
            return i
        i += 1
    return n


def process(path: str, targets: set, apply: bool):
    src = open(path, encoding="utf-8").read()
    tag = path.split("/")[-2] if "/" in path else path
    plan = []

    for m in DESTRUCT_RE.finditer(src):
        l0 = src[: m.start()].count("\n") + 1
        end = expression_end(src, m.start())
        l1 = src[:end].count("\n") + 1
        if not any(l0 <= t <= l1 for t in targets):
            continue
        body = src[m.start() : end]
        if ".select(" not in body:
            continue
        if re.search(r"\berror\b", body):
            continue

        alias = m.group("alias")
        base = (alias or "data")
        errname = re.sub(r"[^A-Za-z0-9_]", "", base) + "Err"
        # Tránh trùng tên trong file
        n = 2
        while re.search(r"\b%s\b" % errname, src):
            errname = re.sub(r"[^A-Za-z0-9_]", "", base) + f"Err{n}"
            n += 1

        indent = re.match(r"[ \t]*", src[src.rfind("\n", 0, m.start()) + 1 :]).group(0)
        plan.append({
            "destruct_end": m.end(),
            "expr_end": end,
            "alias": alias,
            "errname": errname,
            "indent": indent,
            "line": l0,
        })

    if not apply:
        return plan

    for p in sorted(plan, key=lambda x: -x["destruct_end"]):
        log = (
            f'\n{p["indent"]}if ({p["errname"]}) '
            f'console.error("[{tag}] truy vấn lỗi:", {p["errname"]}.message)'
        )
        src = src[: p["expr_end"]] + log + src[p["expr_end"] :]
        # Thêm error vào destructure
        head = src[: p["destruct_end"]]
        head = re.sub(
            r"const\s*\{\s*data(\s*:\s*\w+)?\s*\}(\s*=\s*await\s+supabase)$",
            lambda mm: "const { data%s, error: %s }%s" % (mm.group(1) or "", p["errname"], mm.group(2)),
            head,
        )
        src = head + src[p["destruct_end"] :]

    open(path, "w", encoding="utf-8").write(src)
    return plan


def main():
    apply = "--apply" in sys.argv
    raw = subprocess.run(
        ["python3", "scripts/audit-unchecked-db.py", "--json"],
        capture_output=True, text=True, check=True,
    ).stdout
    reads = [f for f in json.loads(raw) if f["op"] == "doc"]

    by_file = {}
    for f in reads:
        by_file.setdefault(f["file"], set()).add(f["line"])

    total, files = 0, 0
    for path, lines in sorted(by_file.items()):
        plan = process(path, lines, apply)
        if plan:
            files += 1
            total += len(plan)
    print(f"{'[ĐÃ GHI]' if apply else '[chạy thử]'} {total} truy vấn đọc trong {files} file")


if __name__ == "__main__":
    main()
