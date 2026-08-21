#!/usr/bin/env python3
"""
Thêm kiểm lỗi cho các khối `const [aRes, bRes] = await Promise.all([...])`
chứa truy vấn Supabase.

VẤN ĐỀ: mẫu này rất phổ biến trong các trang phân tích/báo cáo. Mỗi phần
tử trả về { data, error } nhưng code chỉ dùng .data. Truy vấn hỏng → biểu
đồ và bảng hiện rỗng, không một dấu hiệu nào.

CÁCH SỬA: chèn MỘT dòng sau khối Promise.all, gom lỗi đầu tiên trong các
biến kết quả và ghi console.error. Không đổi luồng, không đổi giao diện.

Quy ước nhận biết biến là kết quả Supabase: tên kết thúc bằng `Res`
(customersRes, productsRes, recvRes...) — đúng quy ước đang dùng trong
codebase. Các biến khác (kết quả hàm helper trả mảng) được bỏ qua.

Chạy: python3 scripts/fix-unchecked-promise-all.py [--apply]
"""
import os
import re
import sys

ROOTS = ["src/app", "src/components", "src/hooks", "src/lib"]
BLOCK_RE = re.compile(
    r"(?P<indent>[ \t]*)const\s*\[(?P<names>[^\]]*)\]\s*=\s*await\s+Promise\.all\(\s*\[",
    re.S,
)


def block_end(src: str, start: int) -> int:
    """Vị trí sau dấu `])` đóng của Promise.all."""
    i, depth = start, 0
    while i < len(src):
        c = src[i]
        if c in "\"'`":
            qu = c
            i += 1
            while i < len(src):
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == qu:
                    break
                i += 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def iter_files():
    for root in ROOTS:
        for dirpath, _, names in os.walk(root):
            for n in names:
                if n.endswith((".ts", ".tsx")):
                    yield os.path.join(dirpath, n)


def tag_for(path: str) -> str:
    parts = [
        x for x in path.replace("src/", "").replace("/page.tsx", "")
        .replace(".tsx", "").replace(".ts", "").split("/")
        if x != "(dashboard)"
    ]
    return "/".join(parts[-2:]).replace("[", "").replace("]", "")


def process(path: str, apply: bool) -> int:
    src = open(path, encoding="utf-8").read()
    if "Promise.all" not in src or "supabase" not in src:
        return 0

    edits = []
    for m in BLOCK_RE.finditer(src):
        open_paren = src.index("(", m.end() - 2)
        end = block_end(src, open_paren)
        if end < 0:
            continue
        body = src[m.start():end]
        if "supabase" not in body:
            continue
        names = [n.strip() for n in m.group("names").split(",") if n.strip()]
        res_names = [n for n in names if re.fullmatch(r"\w+Res", n)]
        if not res_names:
            continue
        # Đã kiểm rồi thì bỏ qua
        after = src[end:end + 400]
        if any(re.search(r"\b%s\.error\b" % re.escape(n), after) for n in res_names):
            continue
        if re.search(r"\b%s\b" % re.escape(res_names[0]) + r"[^\n]*\berror\b", body):
            continue
        edits.append((end, m.group("indent"), res_names))

    if not edits:
        return 0
    if not apply:
        return len(edits)

    tag = tag_for(path)
    for end, indent, res_names in sorted(edits, key=lambda e: -e[0]):
        arr = ", ".join(res_names)
        var = "qErr"
        n = 2
        while re.search(r"\b%s\b" % var, src):
            var = f"qErr{n}"
            n += 1
        # Ép kiểu tối thiểu: trong mảng có thể lẫn kết quả hàm helper
        # (không có .error), nên không thể dựa vào kiểu suy ra.
        line = (
            f"\n{indent}const {var} = ([{arr}] as Array<{{ error?: {{ message?: string }} | null }}>)"
            f"\n{indent}  .find((r) => r?.error)?.error"
            f"\n{indent}if ({var}) console.error(\"[{tag}] truy vấn lỗi:\", {var}.message)"
        )
        # Bỏ qua dấu `;` nếu có ngay sau
        j = end
        if j < len(src) and src[j] == ";":
            j += 1
        src = src[:j] + line + src[j:]

    open(path, "w", encoding="utf-8").write(src)
    return len(edits)


def main():
    apply = "--apply" in sys.argv
    total, files = 0, 0
    for p in sorted(iter_files()):
        n = process(p, apply)
        if n:
            files += 1
            total += n
    print(f"{'[ĐÃ GHI]' if apply else '[chạy thử]'} {total} khối Promise.all trong {files} file")


if __name__ == "__main__":
    main()
