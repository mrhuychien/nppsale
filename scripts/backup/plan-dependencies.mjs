import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Only PostgreSQL-supplied modules are supported by the plain PG17 target.
const supported = new Set(['unaccent', 'pg_trgm', 'pgcrypto', 'uuid-ossp', 'citext', 'hstore', 'btree_gin', 'btree_gist'])
const schemas = new Set(['extensions', 'public'])
const roles = new Set(['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_admin'])
export function planDependencies(inventory, available) {
  if (inventory?.format !== 1 || !Array.isArray(inventory.extensions) || !Array.isArray(inventory.roles) || !Array.isArray(available)) {
    throw new Error('BACKUP_DEPENDENCY_INVENTORY_INVALID')
  }
  const sql = ['BEGIN;', 'CREATE SCHEMA IF NOT EXISTS extensions;']
  const seen = new Set()
  for (const ext of inventory.extensions) {
    if (!supported.has(ext?.name)) throw new Error('BACKUP_DEPENDENCY_EXTENSION_UNSUPPORTED')
    if (!schemas.has(ext.schema)) throw new Error('BACKUP_DEPENDENCY_SCHEMA_UNSUPPORTED')
    if (typeof ext.version !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(ext.version) || seen.has(ext.name)) {
      throw new Error('BACKUP_DEPENDENCY_INVENTORY_INVALID')
    }
    seen.add(ext.name)
    if (!available.some(a => a.name === ext.name && a.version === ext.version)) {
      throw new Error('BACKUP_DEPENDENCY_VERSION_UNAVAILABLE')
    }
    // Exact version/schema from metadata, identifier allowlists above. No
    // CASCADE, relocated fallback, function stubs, ACLs or source SQL execution.
    sql.push(`CREATE EXTENSION "${ext.name}" WITH SCHEMA "${ext.schema}" VERSION '${ext.version}';`)
  }
  const roleNames = new Set()
  for (const role of inventory.roles) {
    if (!roles.has(role?.name) || roleNames.has(role.name)) throw new Error('BACKUP_DEPENDENCY_ROLE_UNSUPPORTED')
    roleNames.add(role.name)
    // Structural policy targets only, never credentials or source privileges.
    sql.push(`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role.name}') THEN CREATE ROLE "${role.name}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $role$;`)
  }
  sql.push('COMMIT;')
  return sql.join('\n') + '\n'
}

const safeCodes = new Set(['BACKUP_DEPENDENCY_INVENTORY_INVALID', 'BACKUP_DEPENDENCY_EXTENSION_UNSUPPORTED', 'BACKUP_DEPENDENCY_SCHEMA_UNSUPPORTED', 'BACKUP_DEPENDENCY_VERSION_UNAVAILABLE', 'BACKUP_DEPENDENCY_ROLE_UNSUPPORTED'])
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const inventory = JSON.parse(readFileSync('out/dependencies.json', 'utf8'))
    const available = JSON.parse(readFileSync('out/available-extensions.json', 'utf8'))
    writeFileSync('out/bootstrap.sql', planDependencies(inventory, available), { mode: 0o600 })
  } catch (error) {
    console.error(safeCodes.has(error?.message) ? error.message : 'BACKUP_DEPENDENCY_INVENTORY_INVALID')
    process.exit(1)
  }
}
