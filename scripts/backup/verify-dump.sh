#!/usr/bin/env bash
# This target is deliberately fixed to the disposable CI service.
# Supabase-specific roles/extensions must NOT be ignored to force a pass.
set +x
set -euo pipefail
umask 077
diagnostic=$(mktemp)
trap 'rm -f "$diagnostic"' EXIT
if ! pg_restore --dbname 'postgresql://postgres@localhost:5433/verify' \
  --no-owner --no-privileges --clean --if-exists \
  --exit-on-error --single-transaction out/dump.pgc >"$diagnostic" 2>&1; then
  # Classify locally using fixed patterns only; never reflect any SQL, names,
  # row contents or raw lines into Actions output/artifacts.
  if grep -Eq 'role .* does not exist|extension .* is not available|could not open extension control file|schema .* does not exist|function .* does not exist|type .* does not exist' "$diagnostic"; then
    printf '::error::BACKUP_RESTORE_TARGET_INCOMPATIBLE (missing dependency; upload blocked)\n'
  else
    printf '::error::BACKUP_RESTORE_FAILED (upload blocked)\n'
  fi
  exit 1
fi
printf 'Restore completed without ignored errors.\n'
