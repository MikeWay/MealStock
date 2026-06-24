import { Request, Response, NextFunction } from "express";
import { loadUsers } from "../userStore.js";
import { getEffectivePermissions, Area, AccessLevel } from "../roleStore.js";

export function requirePermission(area: Area, minLevel: "view" | "full") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const email = req.session.userEmail;
    if (!email) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }
    const user = loadUsers().find(u => u.email === email);
    if (!user) {
      res.status(401).json({ success: false, message: "User not found" });
      return;
    }
    const perms = getEffectivePermissions(user.roles ?? []);
    const level: AccessLevel = perms[area];
    const ok = minLevel === "view"
      ? level === "view" || level === "full"
      : level === "full";
    if (!ok) {
      res.status(403).json({ success: false, message: "Insufficient permissions" });
      return;
    }
    next();
  };
}
