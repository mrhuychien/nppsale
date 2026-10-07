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
    dependency=unknown
    if grep -Eq 'role .* does not exist' "$diagnostic"; then
      dependency=role
    elif grep -Eq 'extension .* is not available|could not open extension control file' "$diagnostic"; then
      dependency=extension
    elif grep -Eq 'schema .* does not exist' "$diagnostic"; then
      dependency=schema
    elif grep -Eq 'function .* does not exist' "$diagnostic"; then
      dependency=function
    elif grep -Eq 'type .* does not exist' "$diagnostic"; then
      dependency=type
    fi
    printf '::error::BACKUP_RESTORE_TARGET_INCOMPATIBLE (missing dependency: %s; upload blocked)\n' "$dependency"
    # Report only fixed public schema names, never arbitrary identifiers.
    if [[ "$dependency" == schema ]]; then
      for schema in public auth storage extensions pg_catalog vault graphql graphql_public; do
        if grep -Fq "schema \"$schema\" does not exist" "$diagnostic"; then
          printf '::notice::Missing restore schema: %s\n' "$schema"
        fi
      done
    fi
    # Only report fixed, public Supabase role names; never print raw errors.
    if [[ "$dependency" == role ]]; then
      for role in anon authenticated service_role authenticator supabase_auth_admin supabase_storage_admin supabase_admin; do
        if grep -Fq "role \"$role\" does not exist" "$diagnostic"; then
          printf '::notice::Missing standard Supabase role: %s\n' "$role"
        fi
      done
    fi
  else
    printf '::error::BACKUP_RESTORE_FAILED (upload blocked)\n'
  fi
  exit 1
fi
printf 'Restore completed without ignored errors.\n'
