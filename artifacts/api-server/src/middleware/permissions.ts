import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export type AppRole =
  | "super_admin"
  | "company_admin"
  | "supervisor"
  | "staff"
  | "vendor"
  | "customer";

export interface AuthContext {
  userId?: string;
  role?: AppRole;
  companyId?: string;
  division?: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function extractAuth(req: Request): AuthContext {
  const roleHeader = req.headers["x-user-role"] as string | undefined;
  const userIdHeader = req.headers["x-user-id"] as string | undefined;
  const companyHeader = req.headers["x-company-id"] as string | undefined;
  const divisionHeader = req.headers["x-division"] as string | undefined;
  const nameHeader = req.headers["x-user-name"] as string | undefined;

  return {
    userId: userIdHeader,
    role: (roleHeader as AppRole) ?? undefined,
    companyId: companyHeader ?? "default",
    division: divisionHeader,
    name: nameHeader,
  };
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.auth = extractAuth(req);
  next();
}

export function requireRole(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role || !roles.includes(role)) {
      logger.warn({ role, required: roles, path: req.path }, "Permission denied");
      res.status(403).json({ error: "Akses ditolak. Role tidak memiliki izin untuk aksi ini." });
      return;
    }
    next();
  };
}

export const ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  super_admin: ["*"],
  company_admin: ["read:all", "write:all", "assign:all", "approve:all"],
  supervisor: ["read:division", "write:division", "assign:division"],
  staff: ["read:assigned", "write:assigned", "update:progress"],
  vendor: ["read:vendor_form", "write:vendor_form"],
  customer: ["read:customer_form", "write:customer_form"],
};

export function canAccessCompany(auth: AuthContext | undefined, companyId: string): boolean {
  if (!auth) return false;
  if (auth.role === "super_admin") return true;
  return auth.companyId === companyId;
}

export function canAccessDivision(auth: AuthContext | undefined, division: string): boolean {
  if (!auth) return false;
  if (auth.role === "super_admin" || auth.role === "company_admin") return true;
  if (auth.role === "supervisor") return auth.division === division;
  return false;
}
