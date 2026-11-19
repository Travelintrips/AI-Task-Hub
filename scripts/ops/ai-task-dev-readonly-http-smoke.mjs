/**
 * Read-only smoke test against the already running, private PR196 DEV API.
 * No login, bearer token, cookies, POST, background jobs, or database writes.
 * Deliberately hard-restricted to loopback to avoid accidental PROD probing.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function runReadonlyDevApiSmoke({ base = "http://127.0.0.1:18296", request = fetch } = {}) {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(base)) {
    throw new Error("AI_TASK_READONLY_SMOKE_LOOPBACK_REQUIRED");
  }
  const port = Number(base.slice(base.lastIndexOf(":") + 1));
  if (port !== 18296) throw new Error("AI_TASK_READONLY_SMOKE_DEV_PORT_REQUIRED");

  const routes = [
    { path: "/api/readyz", status: 200 },
    { path: "/api/ai-tasks/171", status: 401 },
    { path: "/api/ai-tasks/171/gpt02-lineage", status: 401 },
  ];
  const codes = [];
  for (const route of routes) {
    let reply;
    try {
      reply = await request(base + route.path, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      throw new Error("AI_TASK_READONLY_SMOKE_HTTP_UNAVAILABLE");
    }
    if (reply.status !== route.status) {
      throw new Error("AI_TASK_READONLY_SMOKE_STATUS_MISMATCH_" + route.path.replace(/[^a-z0-9]/gi, "_"));
    }
    if (route.path === "/api/readyz") {
      let body;
      try { body = await reply.json(); } catch { throw new Error("AI_TASK_READONLY_SMOKE_READY_BODY_INVALID"); }
      if (body?.status !== "ready" || body?.database !== "ok") {
        throw new Error("AI_TASK_READONLY_SMOKE_DB_NOT_READY");
      }
    } else {
      // Never read or print sensitive response bodies from protected endpoints.
      try { await reply.body?.cancel(); } catch {}
    }
    codes.push(reply.status);
  }
  return { passed: true, statuses: codes };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runReadonlyDevApiSmoke();
    console.log("AI_TASK_DEV_READONLY_HTTP_PASS ready=" + result.statuses[0] +
      " task171=" + result.statuses[1] + " lineage=" + result.statuses[2] +
      " — AUTHENTICATED_E2E_NOT_PROVEN");
  } catch (error) {
    console.error(error?.message?.startsWith("AI_TASK_READONLY_SMOKE_")
      ? error.message : "AI_TASK_READONLY_SMOKE_FAILED");
    process.exitCode = 1;
  }
}
