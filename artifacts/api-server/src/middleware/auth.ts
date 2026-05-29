import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "@workspace/db";

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  companyId: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.SESSION_SECRET ?? "fallback-secret-change-in-production";

export function signToken(payload: AuthUser): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Soft auth middleware — extracts user from JWT if present.
 * Does NOT block requests without auth; use requireAuth for that.
 */
export function extractUser(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const user = verifyToken(token);
    if (user) req.user = user;
  }
  next();
}

/**
 * Hard auth middleware — blocks with 401 if no valid JWT.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * Role-based access control — requires at minimum the given role level.
 * Roles hierarchy: super_admin > company_admin > supervisor > staff > vendor > customer
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin:   6,
  company_admin: 5,
  supervisor:    4,
  staff:         3,
  vendor:        2,
  customer:      1,
};

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const userLevel = ROLE_HIERARCHY[req.user.role] ?? 0;
    const hasAccess = roles.some((r) => userLevel >= ROLE_HIERARCHY[r]);
    if (!hasAccess) {
      res.status(403).json({
        error: "Insufficient permissions",
        required: roles,
        current: req.user.role,
      });
      return;
    }
    next();
  };
}

/**
 * Returns the companyId to use for DB queries, enforcing multi-company isolation.
 * super_admin can pass ?companyId=xxx to query a specific company.
 * Without ?companyId, super_admin gets null (= no company filter, sees ALL data).
 * All other roles are always scoped to their own company.
 */
export function getCompanyId(req: Request): string | null {
  if (req.user?.role === "super_admin") {
    return (req.query.companyId as string | undefined) ?? null;
  }
  return req.user?.companyId ?? "default";
}

/**
 * Returns the companyId for write operations (INSERT/UPDATE).
 * super_admin without explicit ?companyId defaults to "default".
 */
export function getCompanyIdForWrite(req: Request): string {
  if (req.user?.role === "super_admin") {
    return (req.query.companyId as string | undefined) ??
           req.user.companyId ??
           "default";
  }
  return req.user?.companyId ?? "default";
}
