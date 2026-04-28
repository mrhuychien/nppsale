-- ====================================================================
-- 024_permissions_features
--
-- Loosens role_permissions.module so it can hold either a module name
-- ("orders", "customers", …) OR a finer-grained feature key
-- ("customers.analytics", "purchasing.invoices", …). The default
-- permission map in src/lib/permissions.ts still uses module-level
-- entries, but the UI can now grant or revoke individual menu items.
-- ====================================================================

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_module_check;

-- Replace with a much looser shape check so we still reject obviously
-- bad data without enumerating every feature. Format: lowercase ascii
-- words separated by dots, max 64 chars.
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_module_check
  CHECK (
    char_length(module) BETWEEN 1 AND 64
    AND module ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$'
  );

COMMENT ON COLUMN role_permissions.module IS
  'Feature or module key. Module-level keys ("orders") cover an entire menu group; feature keys ("customers.analytics") override a specific menu item.';
