import { createHash } from "node:crypto";
import { config } from "../config";
import { supabaseQueryStrict } from "./supabase-db";
import { PAYMENT_PROOF_BUCKET } from "./supabase";
import {
  generatePaymentProofTokenWithCollisionRetry,
} from "./payment-proof-token";

export const PAYMENT_PROOF_SHORT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

type PaymentProofShortLinkInput = {
  taskId: number | null;
  documentKey: string;
  storageBucket?: string | null;
  storagePath: string;
};

type PaymentProofShortLinkRow = {
  token_hash: string;
  task_id: number | null;
  document_key: string;
  storage_bucket: string;
  storage_path: string;
  expires_at: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function getShortLinkBaseUrl(): string {
  return config.publicBaseUrl;
}

/**
 * Creates a bearer link whose opaque token is unrelated to task IDs and paths.
 * Only the token hash is persisted; the raw token is returned once to the caller.
 */
export async function createPaymentProofShortLink(
  input: PaymentProofShortLinkInput,
): Promise<{ url: string; token: string; expiresAt: Date }> {
  if (input.storageBucket && input.storageBucket !== PAYMENT_PROOF_BUCKET) {
    throw new Error("Payment proof short links only support the payment-proofs bucket");
  }

  const expiresAt = new Date(
    Date.now() + PAYMENT_PROOF_SHORT_LINK_TTL_SECONDS * 1000,
  );
  const storageBucket = PAYMENT_PROOF_BUCKET;

  const token = await generatePaymentProofTokenWithCollisionRetry(
    async (candidate) => {
      await supabaseQueryStrict(
        `INSERT INTO payment_proof_short_links
          (token_hash, task_id, document_key, storage_bucket, storage_path, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          hashToken(candidate),
          input.taskId,
          input.documentKey,
          storageBucket,
          input.storagePath,
          expiresAt,
        ],
      );
    },
  );

  return {
    url: `${getShortLinkBaseUrl()}/p/${token}`,
    token,
    expiresAt,
  };
}

export async function findActivePaymentProofShortLink(
  token: string,
): Promise<PaymentProofShortLinkRow | null> {
  const rows = await supabaseQueryStrict<PaymentProofShortLinkRow>(
    `SELECT token_hash, task_id, document_key, storage_bucket, storage_path, expires_at
       FROM payment_proof_short_links
      WHERE token_hash = $1
        AND storage_bucket = $2
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1`,
    [hashToken(token), PAYMENT_PROOF_BUCKET],
  );
  return rows[0] ?? null;
}