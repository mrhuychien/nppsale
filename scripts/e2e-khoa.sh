#!/usr/bin/env bash
# Chạy e2e qua KHOÁ: nhiều người / tác tử chạy cùng lúc thì xếp hàng (cổng 54321 / 3100 và .next dùng chung).
exec flock /tmp/npp-e2e.lock npx playwright test "$@"
