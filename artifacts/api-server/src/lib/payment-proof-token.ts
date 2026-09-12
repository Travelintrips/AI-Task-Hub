import { randomBytes } from "node:crypto";

export const PAYMENT_PROOF_SHORT_LINK_TOKEN_LENGTH = 12;
export const PAYMENT_PROOF_LEGACY_TOKEN_LENGTH = 24;
const PAYMENT_PROOF_TOKEN_MAX_ATTEMPTS = 3;

export function generatePaymentProofToken(): string {
  // 9 bytes encode to exactly 12 unpadded Base64URL characters.
  return randomBytes(9).toString("base64url");
}

export function isPaymentProofTokenFormat(token: string): boolean {
  return (
    /^[A-Za-z0-9_-]{12}$/.test(token) ||
    /^[A-Za-z0-9_-]{24}$/.test(token)
  );
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Reserve a newly generated token, retrying only when the token hash collides
 * with an existing unique value. Other database failures are not transient
 * token collisions and must reach the caller unchanged.
 */
export async function generatePaymentProofTokenWithCollisionRetry(
  reserveToken: (token: string) => Promise<void>,
  tokenFactory: () => string = generatePaymentProofToken,
): Promise<string> {
  for (let attempt = 0; attempt < PAYMENT_PROOF_TOKEN_MAX_ATTEMPTS; attempt += 1) {
    const token = tokenFactory();

    try {
      await reserveToken(token);
      return token;
    } catch (error) {
      if (
        !isUniqueConstraintViolation(error) ||
        attempt === PAYMENT_PROOF_TOKEN_MAX_ATTEMPTS - 1
      ) {
        throw error;
      }
    }
  }

  throw new Error("Unable to create payment proof short link");
}