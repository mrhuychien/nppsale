import { describe, expect, it } from "vitest"
import { planDependencies } from "../scripts/backup/plan-dependencies.mjs"

const inventory = {
  format: 1,
  extensions: [
    { name: "unaccent", schema: "extensions", version: "1.1" },
    { name: "pg_trgm", schema: "extensions", version: "1.6" },
  ],
  roles: [{ name: "authenticated" }],
}
const available = [{ name: "unaccent", version: "1.1" }, { name: "pg_trgm", version: "1.6" }]
describe("Disposable target dependency plan", () => {
  it("uses real modules, exact inventoried versions and confined policy roles", () => {
    const sql = planDependencies(inventory, available)
    expect(sql).toContain('CREATE EXTENSION "unaccent" WITH SCHEMA "extensions" VERSION \'1.1\';')
    expect(sql).toContain('CREATE EXTENSION "pg_trgm" WITH SCHEMA "extensions" VERSION \'1.6\';')
    expect(sql).toContain('CREATE ROLE "authenticated" NOLOGIN NOSUPERUSER')
    expect(sql).not.toContain("CREATE FUNCTION")
    expect(sql).not.toContain("CASCADE")
  })
  it("blocks unavailable exact versions instead of substituting a default", () => {
    expect(() => planDependencies(inventory, available.slice(0, 1))).toThrow("BACKUP_DEPENDENCY_VERSION_UNAVAILABLE")
  })
  it("blocks unsupported modules instead of installing arbitrary software", () => {
    expect(() => planDependencies({ ...inventory, extensions: [{ name: "DUMMY_PRIVATE", version: "1", schema: "extensions" }] }, available))
      .toThrow("BACKUP_DEPENDENCY_EXTENSION_UNSUPPORTED")
  })
  it("blocks arbitrary schema identifiers without reflecting them", () => {
    expect(() => planDependencies({ ...inventory, extensions: [{ ...inventory.extensions[0], schema: "DUMMY_PRIVATE" }] }, available))
      .toThrow("BACKUP_DEPENDENCY_SCHEMA_UNSUPPORTED")
  })
  it("blocks arbitrary roles and SQL injection", () => {
    expect(() => planDependencies({ ...inventory, roles: [{ name: "DUMMY_PRIVATE" }] }, available)).toThrow("BACKUP_DEPENDENCY_ROLE_UNSUPPORTED")
    expect(() => planDependencies({ ...inventory, extensions: [{ ...inventory.extensions[0], version: "1';DROP TABLE x;--" }] }, available))
      .toThrow("BACKUP_DEPENDENCY_INVENTORY_INVALID")
  })
  it("rejects malformed or duplicated inventory", () => {
    expect(() => planDependencies(null, available)).toThrow("BACKUP_DEPENDENCY_INVENTORY_INVALID")
    expect(() => planDependencies({ ...inventory, extensions: [inventory.extensions[0], inventory.extensions[0]] }, available))
      .toThrow("BACKUP_DEPENDENCY_INVENTORY_INVALID")
  })
})
