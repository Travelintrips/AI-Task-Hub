// The existing Hub session supplies the bearer token; this helper never signs in,
// prepares a challenge, records a decision, or follows a redirected request.
export const OWNER_LEDGER_ORIGIN = "https://dev-ai-task.cstlogistic.co.id";
export const ORIGINAL_OWNER_CHALLENGE_ID = "9c4f21e1-48af-4f7f-9830-931b84e3e846";
export const ORIGINAL_OWNER_LEDGER_PATH = `/api/gpt02-owner-ledger/decision/${ORIGINAL_OWNER_CHALLENGE_ID}`;

const ERROR_MESSAGES = {
  ORIGIN_REQUIRED: "Pembacaan ledger ini hanya tersedia pada CST-DEV yang ditetapkan.",
  OWNER_REQUIRED: "Pembacaan ledger memerlukan sesi Google Super Admin yang cocok dengan Owner aktif.",
  SESSION_REQUIRED: "Sesi Google Owner tidak tersedia atau sudah berakhir. Masuk kembali melalui alur Google yang tersedia.",
  NOT_FOUND: "Receipt challenge asli belum ditemukan atau jalur pembaca belum tersedia.",
  UNAVAILABLE: "Pembaca ledger atau pemeriksa sesi Owner belum tersedia. Hasil belum dapat diverifikasi.",
  RESPONSE_INVALID: "Respons ledger tidak sesuai kontrak baca-saja untuk challenge asli. Receipt tidak ditampilkan.",
  REQUEST_FAILED: "Pembacaan ledger belum berhasil. Tidak ada keputusan baru yang dibuat.",
  TIMEOUT: "Pembacaan ledger melewati batas waktu. Hasil belum dapat diverifikasi.",
} as const;

export class OriginalOwnerLedgerReadError extends Error {
  readonly code: keyof typeof ERROR_MESSAGES;

  constructor(code: keyof typeof ERROR_MESSAGES) {
    super(ERROR_MESSAGES[code]);
    this.name = "OriginalOwnerLedgerReadError";
    this.code = code;
  }
}

export function getOriginalOwnerLedgerErrorMessage(cause: unknown): string {
  return cause instanceof OriginalOwnerLedgerReadError &&
      Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, cause.code)
    ? ERROR_MESSAGES[cause.code]
    : ERROR_MESSAGES.REQUEST_FAILED;
}

export function parseOriginalOwnerLedgerReceipt(value: unknown) {
  const fields = [
    "challengeId", "scope", "status", "decision", "manifestSha256", "decidedAt",
    "readOnly", "executionPermitted", "signingPermitted", "dispatchPermitted", "releaseDecision",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OriginalOwnerLedgerReadError("RESPONSE_INVALID");
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== fields.length || !fields.every((key) => Object.hasOwn(body, key)) ||
    body.challengeId !== ORIGINAL_OWNER_CHALLENGE_ID || body.scope !== "GPT02_RELOCK_CST_DEV" ||
    body.status !== "CONSUMED" || body.decision !== "APPROVED" ||
    typeof body.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.manifestSha256) ||
    typeof body.decidedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.decidedAt) ||
    !Number.isFinite(Date.parse(body.decidedAt)) || new Date(body.decidedAt).toISOString() !== body.decidedAt ||
    body.readOnly !== true || body.executionPermitted !== false || body.signingPermitted !== false ||
    body.dispatchPermitted !== false || body.releaseDecision !== "NO_GO"
  ) {
    throw new OriginalOwnerLedgerReadError("RESPONSE_INVALID");
  }
  // Copy only the validated public receipt. Never retain an untrusted response
  // object, Owner identity, session metadata, or an arbitrary error payload.
  return {
    challengeId: ORIGINAL_OWNER_CHALLENGE_ID,
    scope: "GPT02_RELOCK_CST_DEV",
    status: "CONSUMED",
    decision: "APPROVED",
    manifestSha256: body.manifestSha256,
    decidedAt: body.decidedAt,
    readOnly: true,
    executionPermitted: false,
    signingPermitted: false,
    dispatchPermitted: false,
    releaseDecision: "NO_GO",
  } as const;
}

export async function readOriginalOwnerLedger(
  context: { origin: string; role: string; getToken: () => string | null },
  request: typeof fetch = fetch,
) {
  if (context.origin !== OWNER_LEDGER_ORIGIN) throw new OriginalOwnerLedgerReadError("ORIGIN_REQUIRED");
  if (context.role !== "super_admin") throw new OriginalOwnerLedgerReadError("OWNER_REQUIRED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const token = context.getToken();
    if (!token) throw new OriginalOwnerLedgerReadError("SESSION_REQUIRED");
    const response = await request(ORIGINAL_OWNER_LEDGER_PATH, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      // Never render or retain upstream error bodies, HTML, or diagnostics.
      const code = response.status === 401 ? "SESSION_REQUIRED"
        : response.status === 403 ? "OWNER_REQUIRED"
          : response.status === 404 ? "NOT_FOUND"
            : response.status === 503 ? "UNAVAILABLE" : "REQUEST_FAILED";
      throw new OriginalOwnerLedgerReadError(code);
    }
    const body: unknown = await response.json().catch(() => {
      throw new OriginalOwnerLedgerReadError("RESPONSE_INVALID");
    });
    return parseOriginalOwnerLedgerReceipt(body);
  } catch (cause) {
    if (cause instanceof OriginalOwnerLedgerReadError) throw cause;
    throw new OriginalOwnerLedgerReadError(controller.signal.aborted ? "TIMEOUT" : "REQUEST_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}
