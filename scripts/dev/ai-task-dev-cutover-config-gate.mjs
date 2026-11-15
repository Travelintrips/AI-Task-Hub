/**
 * Source-only cutover configuration guard for AI Task DEV.
 *
 * This checks presence/equality of env values but never returns credentials.
 * "CONFIG_PASS" is not Google OAuth, reader login, or worker handoff proof.
 * A live cutover still requires a separately approved ordered stop/start.
 */
const DEV_ORIGIN = "https://dev-ai-task.cstlogistic.co.id";
const DEV_SUPABASE = "https://xssrfshdrtdfupgqwfdw.supabase.co";

const handoffEqual = [
  "SESSION_SECRET",
  "SUPABASE_DATABASE_URL_DEV",
  "SUPABASE_URL_DEV",
  "SUPABASE_SERVICE_ROLE_KEY_DEV",
  "AI_CORE_DEV_BASE_URL",
  "AI_CORE_DEV_CHECKPOINT_PUBLIC_KEY_DER_B64",
  "AI_CORE_JOB_WA_API_TOKEN",
  "AI_CORE_JOB_WA_GATEWAY_URL",
];

/** Release preflight: the *actually served* login bundle must strip OAuth
 * URL fragments before its first async Google token exchange. This is scoped
 * to the known AI Task Vite bundle shape and fails closed on unknown shapes.
 * No token or credential is present in the JS asset.
 */
export function googleOauthFragmentIsClearedBeforeExchange(bundle) {
  if (typeof bundle !== "string") return false;
  const marker = '.get("access_token")';
  const first = bundle.indexOf(marker);
  if (first < 0 || bundle.indexOf(marker, first + marker.length) !== -1)
    return false;
  const bootstrap = bundle.slice(first, first + 750);
  const cleared = bootstrap.indexOf("history.replaceState(");
  const exchanged = bootstrap.indexOf("await ");
  return cleared > 0 && exchanged > 0 && cleared < exchanged;
}

export function checkDevCutoverConfig({
  live = {}, candidate = {}, mode, oldBackendStopped = false,
  privateInternalNetwork = false, candidatePublishedPorts = 0,
  candidateReadOnlyRoot = false,
  publicLoginBundle, candidateLoginBundle,
  trustedCstDevPublishableKey, cstDevAuthProbe,
  handoffNetworks, devWaGatewayProbe, waBacklogAudit,
} = {}) {
  const failures = [];
  const fail = (code) => failures.push(code);
  if (mode !== "preview" && mode !== "handoff") {
    return { ok: false, failures: ["INVALID_MODE"] };
  }
  for (const [label, env] of [["LIVE", live], ["CANDIDATE", candidate]]) {
    if (env.NODE_ENV !== "development" || env.APP_ENV !== "development")
      fail(label + "_NOT_DEV");
    if (env.GPT02_CORE_PREPARATION_ENABLED === "true")
      fail(label + "_GPT02_ENABLED");
  }
  if (live.PUBLIC_APP_BASE_URL !== DEV_ORIGIN)
    fail("LIVE_ORIGIN_MISMATCH");
  if (live.SUPABASE_URL_DEV !== DEV_SUPABASE)
    fail("LIVE_PROJECT_MISMATCH");
  if (live.DEV_PASSWORDLESS_LOGIN !== "true")
    fail("LIVE_PASSWORDLESS_BASELINE_MISMATCH");
  if (live.AI_CORE_JOB_WA_ENABLED !== "true")
    fail("LIVE_WA_WORKER_BASELINE_MISMATCH");

  if (candidate.RUN_STARTUP_MIGRATIONS !== "false")
    fail("MIGRATIONS_NOT_DISABLED");
  if (candidate.DISABLE_STORAGE_BUCKET_AUTO_CREATE !== "true")
    fail("BUCKET_CREATION_NOT_DISABLED");
  if (candidate.VPS_STORAGE_INVENTORY_READONLY_ENABLED === "true")
    fail("INVENTORY_ENABLED");

  const secret = candidate.SESSION_SECRET;
  if (typeof secret !== "string" || secret.trim().length < 32 ||
      secret === "fallback-secret-change-in-production") {
    fail("CANDIDATE_SESSION_SECRET_INVALID");
  }
  if (mode === "preview") {
    if (candidate.DISABLE_BACKGROUND_SCHEDULERS !== "true")
      fail("PREVIEW_SCHEDULERS_RUNNING");
    if (candidate.AI_CORE_JOB_WA_ENABLED !== "false")
      fail("PREVIEW_WA_WORKER_RUNNING");
    // A disabled scheduler is not a read-only database identity. The hosted
    // Supabase pooler did not enforce PGOPTIONS or URL "options", so previews
    // must use an ephemeral synthetic DB, never a writable CST-DEV connection.
    const syntheticDbHosts = new Set(["synthetic-pg", "qa-postgres"]);
    for (const key of ["SUPABASE_DATABASE_URL_DEV", "SUPABASE_DATABASE_URL", "DATABASE_URL"]) {
      const uri = candidate[key];
      if (uri === undefined || uri === null || uri === "") continue;
      let synthetic = false;
      if (typeof uri === "string") {
        try {
          const parsed = new URL(uri);
          synthetic =
            (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
            syntheticDbHosts.has(parsed.hostname) && parsed.pathname === "/smoke";
        } catch { /* malformed database config must fail closed */ }
      }
      if (!synthetic) fail("PREVIEW_NON_SYNTHETIC_DATABASE_" + key);
    }
    if (candidate.SUPABASE_SERVICE_ROLE_KEY_DEV || candidate.SUPABASE_SERVICE_ROLE_KEY)
      fail("PREVIEW_SERVICE_ROLE_CREDENTIALS_FORBIDDEN");
    if (!privateInternalNetwork || candidatePublishedPorts !== 0 ||
        !candidateReadOnlyRoot)
      fail("PREVIEW_NETWORK_ISOLATION_INCOMPLETE");
  } else {
    // PR189's login-only Nginx overlay is independent of the API container.
    // Backend parity cannot declare a release safe with the old login asset.
    if (!googleOauthFragmentIsClearedBeforeExchange(publicLoginBundle))
      fail("PUBLIC_LOGIN_OVERLAY_OAUTH_STALE");
    if (!googleOauthFragmentIsClearedBeforeExchange(candidateLoginBundle))
      fail("CANDIDATE_LOGIN_OAUTH_STALE");
    if (!oldBackendStopped)
      fail("OLD_WORKER_NOT_STOPPED");
    if (candidate.PUBLIC_APP_BASE_URL !== DEV_ORIGIN)
      fail("HANDOFF_ORIGIN_MISMATCH");
    if (candidate.DEV_PASSWORDLESS_LOGIN !== live.DEV_PASSWORDLESS_LOGIN)
      fail("HANDOFF_PASSWORDLESS_MISMATCH");
    if (candidate.DISABLE_BACKGROUND_SCHEDULERS === "true")
      fail("HANDOFF_SCHEDULERS_DISABLED");
    if (candidate.AI_CORE_JOB_WA_ENABLED !== "true")
      fail("HANDOFF_WA_WORKER_DISABLED");
    // WA Gateway DEV is only reachable over its existing dedicated internal
    // network, not the legacy ai-task-development_default network alone.
    // Never attach the successor to the WA Redis/worker bridge or PROD bridge.
    const requiredNetworks = [
      "ai-task-development_default", "cst-wa-ai-core-dev-private",
    ];
    const receivedNetworks = Array.isArray(handoffNetworks)
      ? new Set(handoffNetworks) : new Set();
    if (receivedNetworks.size !== requiredNetworks.length ||
        requiredNetworks.some(name => !receivedNetworks.has(name)))
      fail("HANDOFF_WA_PRIVATE_NETWORK_REQUIRED");
    if (devWaGatewayProbe?.network !== "cst-wa-ai-core-dev-private" ||
        devWaGatewayProbe?.httpStatus !== 200 ||
        !Number.isInteger(devWaGatewayProbe?.onlineWorkers) ||
        devWaGatewayProbe.onlineWorkers < 1 ||
        devWaGatewayProbe?.overallDegraded !== false)
      fail("HANDOFF_WA_GATEWAY_PROBE_REQUIRED");
    // The live DEV outbox includes a stale, retryable WA_DIGEST. Connecting
    // a new worker to the healthy gateway may auto-send it. Do not replay or
    // mutate that message implicitly as part of a backend swap. Require a
    // separate current, read-only CST-DEV queue audit with zero stale entries.
    if (waBacklogAudit?.projectRef !== "xssrfshdrtdfupgqwfdw" ||
        !Number.isInteger(waBacklogAudit?.staleRetryablePendingCount) ||
        waBacklogAudit.staleRetryablePendingCount !== 0)
      fail("HANDOFF_STALE_WA_OUTBOX_REVIEW_REQUIRED");
    // The active DEV's legacy anon JWT was minted for the wrong Supabase
    // project: do NOT preserve it simply because the old container has it.
    // The operator must pin the official current CST-DEV publishable key from
    // Supabase management, and independently probe the exact CST-DEV Auth
    // endpoint with that key (HTTP 200 and Google enabled) before handoff.
    const validKey =
      typeof trustedCstDevPublishableKey === "string" &&
      trustedCstDevPublishableKey.startsWith("sb_publishable_") &&
      trustedCstDevPublishableKey.length >= 30;
    const liveProof =
      cstDevAuthProbe?.projectRef === "xssrfshdrtdfupgqwfdw" &&
      cstDevAuthProbe?.httpStatus === 200 &&
      cstDevAuthProbe?.googleEnabled === true;
    if (!validKey || !liveProof) {
      fail("HANDOFF_CST_DEV_AUTH_PROOF_REQUIRED");
    } else if (candidate.SUPABASE_ANON_KEY_DEV !== trustedCstDevPublishableKey) {
      fail("HANDOFF_CST_DEV_PUBLISHABLE_KEY_MISMATCH");
    }
    // Keep all other working DEV identities (including the independent
    // service-role key), the same session signer, Core and WA integrations.
    for (const key of handoffEqual) {
      if (!live[key] || !candidate[key] || live[key] !== candidate[key])
        fail("HANDOFF_PARITY_" + key);
    }
  }
  return { ok: failures.length === 0, failures };
}
