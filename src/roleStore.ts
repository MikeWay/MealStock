import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";

const ROLES_DIR = ".auth";
const ROLES_FILE = `${ROLES_DIR}/roles.json`;

export const AREAS = ["tasks", "duplicates", "emailIssues", "minutes", "consents", "users"] as const;
export type Area = typeof AREAS[number];
export type AccessLevel = "none" | "view" | "full";

export const AREA_LABELS: Record<Area, string> = {
  tasks: "SCM Tasks",
  duplicates: "Duplicate Contacts",
  emailIssues: "Email Issues",
  minutes: "Upload Minutes",
  consents: "Photo Consents",
  users: "Manage Users",
};

export interface Role {
  id: string;
  name: string;
  permissions: Record<Area, AccessLevel>;
}

export function loadRoles(): Role[] {
  if (!existsSync(ROLES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ROLES_FILE, "utf-8")) as Role[];
  } catch {
    return [];
  }
}

function saveRoles(roles: Role[]): void {
  if (!existsSync(ROLES_DIR)) mkdirSync(ROLES_DIR, { recursive: true });
  writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2), "utf-8");
}

function buildPermissions(partial: Partial<Record<Area, AccessLevel>>): Record<Area, AccessLevel> {
  const result = {} as Record<Area, AccessLevel>;
  for (const area of AREAS) result[area] = partial[area] ?? "none";
  return result;
}

export function createRole(name: string, permissions: Partial<Record<Area, AccessLevel>>): Role {
  const roles = loadRoles();
  const role: Role = { id: randomBytes(8).toString("hex"), name, permissions: buildPermissions(permissions) };
  roles.push(role);
  saveRoles(roles);
  return role;
}

export function updateRole(id: string, name: string, permissions: Partial<Record<Area, AccessLevel>>): Role | null {
  const roles = loadRoles();
  const idx = roles.findIndex(r => r.id === id);
  if (idx === -1) return null;
  roles[idx] = { id, name, permissions: buildPermissions(permissions) };
  saveRoles(roles);
  return roles[idx];
}

export function deleteRole(id: string): boolean {
  const roles = loadRoles();
  const idx = roles.findIndex(r => r.id === id);
  if (idx === -1) return false;
  roles.splice(idx, 1);
  saveRoles(roles);
  return true;
}

export function createAdminRole(): Role {
  const full: Partial<Record<Area, AccessLevel>> = {};
  for (const area of AREAS) full[area] = "full";
  return createRole("Administrator", full);
}

const LEVEL_ORDER: Record<AccessLevel, number> = { none: 0, view: 1, full: 2 };

export function getEffectivePermissions(roleIds: string[]): Record<Area, AccessLevel> {
  const allRoles = loadRoles();
  const userRoles = allRoles.filter(r => roleIds.includes(r.id));
  const result = {} as Record<Area, AccessLevel>;
  for (const area of AREAS) {
    let best: AccessLevel = "none";
    for (const role of userRoles) {
      const level = role.permissions[area] ?? "none";
      if (LEVEL_ORDER[level] > LEVEL_ORDER[best]) best = level;
    }
    result[area] = best;
  }
  return result;
}
