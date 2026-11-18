/**
 * Strict TLS for a new, isolated CST-DEV operational E2E candidate.
 *
 * Existing official DEV PR196, PROD and test fixtures retain the prior
 * connection settings unless a deliberately enabled DEV-only flag is set.
 * Never substitute a certificate observed from an unverified TLS connection
 * for the project's authenticated Supabase Dashboard CA download.
 */
import { X509Certificate } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

export const AI_TASK_DEV_CA_PATH = "/run/credentials/ai-task-dev/supabase-ca.pem";
// Verified public Supabase Root 2021 CA DER SHA-256 (not a server leaf cert).
export const AI_TASK_DEV_ROOT_CA_SHA256 = "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa";
const DEV_PROJECT = "xssrfshdrtdfupgqwfdw";
const DEV_ROLE = `ai_task_operational_dev.${DEV_PROJECT}`;
const POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;

type CertificateStat = {
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  size: number;
};

type CertificateProvider = {
  stat: () => CertificateStat;
  read: () => string;
};

function terminalError(code: string): Error {
  // Return only stable codes; never return URL, identity or certificate data.
  return new Error(code);
}

export function resolveAiTaskDbSsl(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
  provider: CertificateProvider = {
    stat: () => lstatSync(AI_TASK_DEV_CA_PATH),
    read: () => readFileSync(AI_TASK_DEV_CA_PATH, "utf8"),
  },
): false | { rejectUnauthorized: boolean; ca?: string; servername?: string } {
  // Original behavior, byte-for-byte equivalent in PROD and existing DEV.
  const legacy = env.DB_SSL === "false" ? false : { rejectUnauthorized: false };
  if (env.NODE_ENV === "production" || env.AI_TASK_DEV_REQUIRE_VERIFIED_TLS !== "true") {
    return legacy;
  }

  if (env.NODE_ENV !== "development" || env.APP_ENV !== "development" || env.DB_SSL === "false") {
    throw terminalError("AI_TASK_DEV_TLS_ENV_NOT_APPROVED");
  }

  let hostname: string;
  try {
    const target = new URL(connectionString);
    const username = decodeURIComponent(target.username);
    if (
      !["postgresql:", "postgres:"].includes(target.protocol) ||
      username !== DEV_ROLE ||
      !POOLER_HOST.test(target.hostname) ||
      target.port !== "6543" ||
      target.pathname !== "/postgres" ||
      target.search || target.hash || !target.password
    ) throw Error("INVALID");
    hostname = target.hostname;
  } catch {
    throw terminalError("AI_TASK_DEV_TLS_TARGET_NOT_APPROVED");
  }

  if (env.AI_TASK_DEV_DB_CA_CERT_PATH !== AI_TASK_DEV_CA_PATH) {
    throw terminalError("AI_TASK_DEV_CA_PATH_NOT_APPROVED");
  }

  let ca: string;
  try {
    const st = provider.stat();
    if (!st.isFile() || st.isSymbolicLink() || st.size < 200 || st.size > 65536) {
      throw Error("INVALID_CA");
    }
    ca = provider.read();
    // Parsing a PEM is not trust: pin the independently checked Supabase
    // Root 2021 CA, and require a CA (never a captured server leaf).
    const certificate = new X509Certificate(ca);
    const actualSha256 = certificate.fingerprint256.replace(/:/g, "").toLowerCase();
    if (!certificate.ca || actualSha256 !== AI_TASK_DEV_ROOT_CA_SHA256) {
      throw Error("UNTRUSTED_CA");
    }
    // Node TLS still validates the server certificate chain and hostname
    // against this pinned public root on every actual connection.
  } catch {
    throw terminalError("AI_TASK_DEV_CA_NOT_VERIFIED_OR_MISSING");
  }

  // Use the previously allowlisted host for SNI and certificate identity.
  // Node TLS will enforce both CA chain and hostname validation.
  return { rejectUnauthorized: true, ca, servername: hostname };
}
