import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db, publicTokensTable } from "@workspace/db";
import { logger } from "./logger";

export type TokenType = "mini_task" | "customer_data";

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createPublicToken(
  taskId: number,
  tokenType: TokenType,
  createdBy?: string,
  expiresInDays = 30,
): Promise<string> {
  const token = generateSecureToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  await db.insert(publicTokensTable).values({
    token,
    taskId,
    tokenType,
    createdBy: createdBy ?? null,
    expiresAt,
    isRevoked: false,
  });

  logger.info({ taskId, tokenType }, "Public token created");
  return token;
}

export async function validateToken(
  token: string,
  expectedType: TokenType,
): Promise<{ valid: boolean; taskId?: number; error?: string }> {
  const [row] = await db
    .select()
    .from(publicTokensTable)
    .where(and(eq(publicTokensTable.token, token), eq(publicTokensTable.tokenType, expectedType)));

  if (!row) return { valid: false, error: "Token tidak valid" };
  if (row.isRevoked) return { valid: false, error: "Token sudah dicabut" };
  if (row.expiresAt && row.expiresAt < new Date()) return { valid: false, error: "Token sudah kadaluarsa" };

  await db
    .update(publicTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(publicTokensTable.id, row.id));

  return { valid: true, taskId: row.taskId };
}
