/**
 * DEV-only independent reader health probe. It NEVER signs, creates a task,
 * prepares a command, reserves a lease, consumes a nonce or dispatches.
 * Sockets are exact Unix paths, not caller-supplied URLs.
 */
import { request } from "node:http";
import { readFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const HUB_SOCKET = "/run/gpt02-reader/reader.sock";
const ISSUER_SOCKET = "/run/gpt02-issuer-reader/reader.sock";
const SIGNER_BASE = "/run";
const ROLES = Object.freeze(["approval","hub","core","issuer"]);

function validHubHealth(x) {
  return x?.ok === true && x?.environment === "DEV" && x?.readerReady === true &&
    x?.hubRole === "gpt02_hub_evidence_reader" &&
    x?.coreRole === "gpt02_core_evidence_reader" &&
    x?.twoSessionsVerified === true &&
    x?.signingPermitted === false && x?.dispatchPermitted === false;
}
function validIssuerHealth(x) {
  return x?.ok === true && x?.environment === "DEV" && x?.readerReady === true &&
    x?.issuerRole === "gpt02_issuer_evidence_reader" &&
    x?.tlsVerified === true && x?.readOnly === true &&
    x?.signingPermitted === false && x?.authorizationGranted === false &&
    x?.dispatchPermitted === false && x?.releaseDecision === "NO_GO";
}
function validSignerState(x,role) {
  return x?.environment === "DEV" && x?.role === role &&
    x?.fingerprintMatched === true &&
    x?.hubCoreReaderOperational === true && x?.issuerReaderOperational === true &&
    x?.trustedReaderConnectivityVerified === true &&
    x?.privateCredentialMounted === true &&
    x?.signingPermitted === false && x?.authorizationGranted === false &&
    x?.dispatchPermitted === false && x?.releaseDecision === "NO_GO";
}
function readJsonHealth(socketPath) {
  return new Promise((resolvePromise,reject) => {
    const req = request({
      socketPath, method: "GET", path: "/health",
      headers: { accept:"application/json" }, timeout: 15000
    }, (res) => {
      let data = "";
      res.on("data",(chunk)=>{
        data += chunk.toString("utf8");
        if (data.length > 4096) req.destroy(new Error("OVERSIZE"));
      });
      res.on("end",()=>{
        if (res.statusCode !== 200) return reject(new Error("HEALTH_UNAVAILABLE"));
        try { resolvePromise(JSON.parse(data)); } catch { reject(new Error("INVALID_JSON")); }
      });
      res.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new Error("TIMEOUT")));
    req.on("error",reject);
    req.end();
  });
}
async function readSignerState(role) {
  if (!ROLES.includes(role)) throw new Error("INVALID_ROLE");
  const path = SIGNER_BASE + "/gpt02-issue159-signer-" + role + "/readiness.json";
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 4096) {
    throw new Error("UNSAFE_READINESS_FILE");
  }
  return JSON.parse(await readFile(path,"utf8"));
}
const safe = async (fn) => {
  try { return await fn(); } catch { return null; }
};

/**
 * Purely observational. All results are always NO_GO, even if every source
 * is healthy, because health is not a task-bound signature/lease.
 */
export async function runNativeReadOnlyPreflight({
  taskId,
  environment="development",
  appEnv="development",
  hubHealth=()=>readJsonHealth(HUB_SOCKET),
  issuerHealth=()=>readJsonHealth(ISSUER_SOCKET),
  signerReadiness=readSignerState
}={}) {
  if (environment !== "development" || appEnv !== "development")
    throw new Error("EXPLICIT_DEV_ONLY");
  if (!Number.isSafeInteger(taskId) || taskId <= 136)
    throw new Error("NEW_TASK_REQUIRED");

  const [hub,issuer,...signers] = await Promise.all([
    safe(hubHealth),safe(issuerHealth),
    ...ROLES.map(role=>safe(()=>signerReadiness(role)))
  ]);
  const roleProofs = Object.fromEntries(ROLES.map((role,i)=>[
    role, validSignerState(signers[i],role)
  ]));
  const hubReaderVerified = validHubHealth(hub);
  const issuerReaderVerified = validIssuerHealth(issuer);
  const allSignersRestrictedAndHealthy = Object.values(roleProofs).every(Boolean);

  return Object.freeze({
    environment:"DEV",
    taskId,
    hubReaderVerified,
    issuerReaderVerified,
    signers: roleProofs,
    independentReaderHealthVerified: hubReaderVerified && issuerReaderVerified,
    signersRestrictedAndHealthy: allSignersRestrictedAndHealthy,
    taskBoundOperatorSignatureVerified:false,
    immutableAttemptBound:false,
    issuerNonceConsumed:false,
    issuerLeaseVerified:false,
    signingPermitted:false,
    authorizationGranted:false,
    dispatchPermitted:false,
    releaseDecision:"NO_GO",
    nextRequiredAction: "AUTHORIZED_SUPER_ADMIN_SIGNATURE_AND_ISSUER_ADMISSION_REQUIRED"
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNativeReadOnlyPreflight({
    taskId: Number(process.argv[2]),
    environment: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV
  }).then(x=>{ process.stdout.write(JSON.stringify(x)+"\n"); })
    .catch(()=>{process.stdout.write(JSON.stringify({
      releaseDecision:"NO_GO", authorizationGranted:false,
      signingPermitted:false, dispatchPermitted:false,
      error:"READONLY_PREFLIGHT_UNAVAILABLE"
    })+"\n");process.exitCode=1;});
}
