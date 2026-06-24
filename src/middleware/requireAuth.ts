import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.authenticated) { next(); return; }
  res.status(401).json({ success: false, message: "Not authenticated" });
}
