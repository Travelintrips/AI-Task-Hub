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
  "SUPABASE_ANON_KEY_DEV",
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
    for (const key of handoffEqual) {
      if (!live[key] || !candidate[key] || live[key] !== candidate[key])
        fail("HANDOFF_PARITY_" + key);
    }
  }
  return { ok: failures.length === 0, failures };
}
