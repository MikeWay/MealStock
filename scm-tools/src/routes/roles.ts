import { Router } from "express";
import { createRole, updateRole, deleteRole, loadRoles, AREAS, Area, AccessLevel } from "../roleStore.js";
import { addRoleToUser, removeRoleFromUser, loadUsers } from "../userStore.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = Router();

router.get("/api/roles", requirePermission("users", "view"), (_req, res) => {
  res.json({ roles: loadRoles() });
});

router.post("/api/roles", requirePermission("users", "full"), (req, res) => {
  const { name, permissions } = req.body as { name?: string; permissions?: Partial<Record<Area, AccessLevel>> };
  if (!name) { res.status(400).json({ success: false, message: "Name required" }); return; }
  const role = createRole(name, permissions ?? {});
  res.json({ success: true, role });
});

router.put("/api/roles/:id", requirePermission("users", "full"), (req, res) => {
  const { name, permissions } = req.body as { name?: string; permissions?: Partial<Record<Area, AccessLevel>> };
  if (!name) { res.status(400).json({ success: false, message: "Name required" }); return; }
  const role = updateRole(req.params.id as string, name, permissions ?? {});
  if (!role) { res.status(404).json({ success: false, message: "Role not found" }); return; }
  res.json({ success: true, role });
});

router.delete("/api/roles/:id", requirePermission("users", "full"), (req, res) => {
  const ok = deleteRole(req.params.id as string);
  if (!ok) { res.status(404).json({ success: false, message: "Role not found" }); return; }
  res.json({ success: true });
});

router.post("/api/users/:email/roles/:roleId", requirePermission("users", "full"), (req, res) => {
  const result = addRoleToUser(req.params.email as string, req.params.roleId as string);
  res.json(result);
});

router.delete("/api/users/:email/roles/:roleId", requirePermission("users", "full"), (req, res) => {
  const result = removeRoleFromUser(req.params.email as string, req.params.roleId as string);
  res.json(result);
});

export { AREAS };
export default router;
