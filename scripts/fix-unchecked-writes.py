#!/usr/bin/env python3
"""
Thêm `.throwOnError()` vào các thao tác GHI Supabase chưa kiểm lỗi mà
NẰM TRONG khối try/catch.

VÌ SAO: supabase-js KHÔNG ném lỗi — nó trả về { data, error }. Nên một
câu `await supabase.from(...).update(...)` trần trong khối try sẽ TRÔI
QUA ÊM khi thất bại: người dùng thấy "Đã lưu" nhưng dữ liệu không vào
database. `.throwOnError()` làm nó ném thật, rơi vào catch có sẵn và
hiện thông báo lỗi — không phải viết lại luồng xử lý.

CHỈ áp dụng khi lời gọi nằm trong try{} — nếu không có catch thì việc ném
lỗi sẽ thành lỗi chưa bắt, nên những chỗ đó để sửa tay.

Chạy: python3 scripts/fix-unchecked-writes.py [--apply] [file...]
Mặc định là chạy thử (in ra chỗ sẽ sửa, không ghi file).
"""
import json
import re
import subprocess
import sys

WRITE_RE = re.compile(r"\.(insert|update|delete|upsert|rpc)\s*\(")


def expression_end(src: str, start: int) -> int:
    """Trả vị trí kết thúc biểu thức `await supabase...` bắt đầu tại start.
    Bám độ sâu ngoặc và bỏ qua nội dung chuỗi/ghi chú."""
    i, depth = start, 0
    n = len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            quote = c
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
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
        elif depth == 0 and c in ";,":
            return i
        elif depth == 0 and c == "\n":
            # Chuỗi phương thức còn tiếp nếu dòng kế bắt đầu bằng dấu chấm
            j = i + 1
            while j < n and src[j] in " \t\n":
                j += 1
            if j < n and src[j] == ".":
                i = j
                continue
            return i
        i += 1
    return n


def in_try_block(src: str, pos: int) -> bool:
    """Đúng khi vị trí nằm trong một khối try{...} có catch."""
    depth = 0
    for m in re.finditer(r"\btry\s*\{|\}\s*catch\b", src[:pos]):
        depth += 1 if m.group(0).startswith("try") else -1
    return depth > 0


def spans(src: str):
    """Mọi biểu thức `await supabase...` kèm phạm vi dòng của nó."""
    out = []
    for m in re.finditer(r"await\s+supabase\s*(?=[.\n])", src):
        end = expression_end(src, m.start())
        l0 = src[: m.start()].count("\n") + 1
        l1 = src[:end].count("\n") + 1
        out.append((m.start(), end, l0, l1))
    return out


def process(path: str, targets: set, apply: bool):
    src = open(path, encoding="utf-8").read()
    hits = []
    for start, end, l0, l1 in spans(src):
        # Khớp nếu BẤT KỲ dòng nào của biểu thức bị đánh dấu
        if not any(l0 <= t <= l1 for t in targets):
            continue
        m = type("M", (), {"start": lambda self=None, s=start: s})()
        line_no = l0
        expr = src[m.start() : end]
        if not WRITE_RE.search(expr):
            continue
        if ".throwOnError()" in expr:
            continue
        if not in_try_block(src, m.start()):
            hits.append((line_no, "BỎ QUA — không nằm trong try/catch", expr.split("\n")[0][:70]))
            continue
        hits.append((line_no, "THÊM .throwOnError()", expr.split("\n")[0][:70]))

    if not apply:
        return hits

    # Áp dụng từ cuối lên đầu để không lệch vị trí
    edits = []
    for start, end, l0, l1 in spans(src):
        if not any(l0 <= t <= l1 for t in targets):
            continue
        expr = src[start:end]
        if not WRITE_RE.search(expr) or ".throwOnError()" in expr:
            continue
        if not in_try_block(src, start):
            continue
        edits.append(end)

    for end in sorted(edits, reverse=True):
        src = src[:end] + ".throwOnError()" + src[end:]
    open(path, "w", encoding="utf-8").write(src)
    return hits


def main():
    apply = "--apply" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]

    raw = subprocess.run(
        ["python3", "scripts/audit-unchecked-db.py", "--json"],
        capture_output=True, text=True, check=True,
    ).stdout
    found = [f for f in json.loads(raw) if f["op"] == "ghi"]

    by_file = {}
    for f in found:
        if only and f["file"] not in only:
            continue
        by_file.setdefault(f["file"], set()).add(f["line"])

    total_fix = total_skip = 0
    for path, lines in sorted(by_file.items()):
        hits = process(path, lines, apply)
        if not hits:
            continue
        print(f"\n{path}")
        for ln, action, code in hits:
            mark = "+" if action.startswith("THÊM") else "!"
            print(f"  {mark} :{ln} {action}")
            print(f"      {code}")
            if mark == "+":
                total_fix += 1
            else:
                total_skip += 1

    print(f"\n{'[ĐÃ GHI]' if apply else '[chạy thử]'} sửa được {total_fix} · cần sửa tay {total_skip}")


if __name__ == "__main__":
    main()
