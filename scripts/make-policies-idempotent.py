#!/usr/bin/env python3
"""
Chèn `DROP POLICY IF EXISTS ... ;` trước mỗi `CREATE POLICY` chưa có.

VÌ SAO: Postgres không hỗ trợ `CREATE POLICY IF NOT EXISTS`. Nếu migration
tạo policy mà không xoá trước, chạy lại sẽ lỗi "policy already exists" và
DỪNG GIỮA CHỪNG — phần còn lại của migration không được áp dụng. Đây gần
như chắc chắn là lý do database production bị lệch: có người chạy lại
migration, gặp lỗi, và những thay đổi phía sau không bao giờ tới nơi.

An toàn: `DROP POLICY IF EXISTS` rồi `CREATE POLICY` cho ra đúng kết quả
như cũ trên DB trống, và biến migration thành chạy-lại-được trên DB đã có.

Bỏ qua các CREATE POLICY nằm trong khối DO $$ ... $$ vì chúng đã tự bảo vệ
bằng kiểm tra IF NOT EXISTS.

Chạy:  python3 scripts/make-policies-idempotent.py [--dry-run]
"""
import glob
import os
import re
import sys

MIG_DIR = "supabase/migrations"

CREATE_RE = re.compile(
    r'^([ \t]*)CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+((?:\w+\.)?\w+)', re.I | re.M
)


def do_block_ranges(sql: str):
    """Vị trí (đầu, cuối) của các khối DO $$ ... $$ để bỏ qua."""
    ranges = []
    for m in re.finditer(r"DO\s*\$\$", sql, re.I):
        end = sql.find("$$", m.end())
        ranges.append((m.start(), end + 2 if end != -1 else len(sql)))
    return ranges


def in_ranges(pos, ranges):
    return any(a <= pos < b for a, b in ranges)


def process(path: str, dry: bool):
    sql = open(path, encoding="utf-8").read()
    skip = do_block_ranges(sql)
    out, last, added = [], 0, 0

    for m in CREATE_RE.finditer(sql):
        if in_ranges(m.start(), skip):
            continue
        indent, name, table = m.group(1), m.group(2), m.group(3)
        # Đã có DROP cho đúng policy này ở phía trước chưa?
        before = sql[:m.start()]
        if re.search(
            r'DROP\s+POLICY\s+IF\s+EXISTS\s+"' + re.escape(name) + r'"\s+ON\s+' + re.escape(table),
            before, re.I,
        ):
            continue
        out.append(sql[last:m.start()])
        out.append(f'{indent}DROP POLICY IF EXISTS "{name}" ON {table};\n')
        last = m.start()
        added += 1

    if not added:
        return 0
    out.append(sql[last:])
    if not dry:
        open(path, "w", encoding="utf-8").write("".join(out))
    return added


def main():
    dry = "--dry-run" in sys.argv
    total, touched = 0, 0
    for path in sorted(glob.glob(os.path.join(MIG_DIR, "*.sql"))):
        n = process(path, dry)
        if n:
            touched += 1
            total += n
            print(f"  {os.path.basename(path)}: +{n}")
    print(f"\n{'[thử]' if dry else '[đã ghi]'} {total} DROP POLICY IF EXISTS trong {touched} file")


if __name__ == "__main__":
    main()
