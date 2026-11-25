// DEV-only browser-originated negative test for a distinct, fixed UUID.
// Uses the existing signed Hub session. Never copies a token, reads error bodies,
// creates an approval, or grants execution authority.
import { OWNER_LEDGER_ORIGIN, ORIGINAL_OWNER_CHALLENGE_ID } from "./gpt02-original-owner-ledger.ts";

export const FOREIGN_CHALLENGE_ID = "00000000-0000-4000-8000-000000000000";

export async function verifyForeignChallengeDenied(
  context: { origin: string; role: string; getToken: () => string | null },
  request: typeof fetch = fetch,
): Promise<"DENIED_404"> {
  if (context.origin !== OWNER_LEDGER_ORIGIN || context.role !== "super_admin" ||
      FOREIGN_CHALLENGE_ID === ORIGINAL_OWNER_CHALLENGE_ID) {
    throw new Error("GPT02_NEGATIVE_TEST_CONTEXT_REJECTED");
  }
  const token = context.getToken();
  if (!token) throw new Error("GPT02_NEGATIVE_TEST_SESSION_MISSING");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await request(`/api/gpt02-owner-ledger/decision/${FOREIGN_CHALLENGE_ID}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    // Only 404 is acceptable. No response body is ever read or persisted.
    if (response.status !== 404 ||
        !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
        !(response.headers.get("cache-control") ?? "").includes("no-store")) {
      throw new Error("GPT02_NEGATIVE_TEST_NOT_PROVEN");
    }
    return "DENIED_404";
  } finally {
    clearTimeout(timer);
  }
}
