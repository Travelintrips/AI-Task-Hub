import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { googleOauthFragmentIsClearedBeforeExchange } from "./ai-task-dev-cutover-config-gate.mjs";

// This executes the actual built API and Vite bundle with deliberately fake
// credentials and an unreachable synthetic DB. Never connect to CST-DEV/PROD.
const appRoot = resolve(import.meta.dirname, "../..");
const entrypoint = resolve(appRoot, "artifacts/api-server/dist/index.mjs");

async function allocateLoopbackPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

test("PR196 built DEV API + Google login bundle run safely without live services", { timeout: 35000 }, async () => {
  const port = await allocateLoopbackPort();
  const origin = "http://127.0.0.1:" + port;
  const env = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || "/tmp",
    NODE_ENV: "development",
    APP_ENV: "development",
    PORT: String(port),
    HOST: "127.0.0.1",
    SESSION_SECRET: "synthetic-test-only-pr196-never-used-for-real-sessions-20261115",
    // Exercise the DEV-only email-login policy without actually routing to the real site.
    PUBLIC_APP_BASE_URL: "https://dev-ai-task.cstlogistic.co.id",
    DEV_PASSWORDLESS_LOGIN: "true",
    CORS_ALLOWED_ORIGINS: origin,
    SUPABASE_DATABASE_URL_DEV: "postgresql://fake:fake@127.0.0.1:65432/smoke",
    DB_SSL: "false",
    DB_CONNECTION_TIMEOUT_MS: "500",
    SUPABASE_URL_DEV: "https://synthetic.invalid",
    AI_CORE_JOB_WA_ENABLED: "false",
    AI_TASK_DEV_SOURCE_RECONCILE_ENABLED: "false",
    GPT02_CORE_PREPARATION_ENABLED: "false",
    DISABLE_BACKGROUND_SCHEDULERS: "true",
    DISABLE_STORAGE_BUCKET_AUTO_CREATE: "true",
    VPS_STORAGE_INVENTORY_READONLY_ENABLED: "false",
    RUN_STARTUP_MIGRATIONS: "false",
    LOG_LEVEL: "error",
  };
  assert.equal(env.AI_CORE_JOB_WA_ENABLED, "false");
  assert.equal(env.DISABLE_BACKGROUND_SCHEDULERS, "true");
  assert.equal(env.RUN_STARTUP_MIGRATIONS, "false");
  assert.equal(env.SUPABASE_URL_DEV, "https://synthetic.invalid");
  const child = spawn(process.execPath, ["--enable-source-maps", entrypoint], {
    cwd: appRoot, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let spawnError = null;
  child.on("error", error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => { output = (output + chunk.toString()).slice(-12000); });
  }
  try {
    let health = null;
    for (let i = 0; i < 60; i++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error("Synthetic API failed to start: " + String(spawnError || output));
      }
      try {
        const response = await fetch(origin + "/api/healthz", {
          signal: AbortSignal.timeout(750),
        });
        if (response.ok) { health = response; break; }
      } catch { /* retry only the loopback endpoint */ }
      await delay(250);
    }
    assert.ok(health, "Synthetic API health failed: " + output);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    for (const emailLoginBody of [
      { email: "nonexistent-readonly-fixture@example.invalid" },
      { email: "nonexistent-readonly-fixture@example.invalid", password: "fixture-not-real" },
    ]) {
      const loginReply = await fetch(origin + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailLoginBody),
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(loginReply.status, 403, "DEV email login must fail before any DB request or JWT minting");
      const body = await loginReply.json();
      assert.equal(body.error, "Verified Google login required on DEV");
      assert.equal("token" in body, false, "No JWT may be issued");
    }
    const googleStart = await fetch(origin + "/api/auth/google/start", {
      redirect: "manual", signal: AbortSignal.timeout(3000),
    });
    assert.equal(googleStart.status, 302, "Existing Google OAuth remains available");
    const loginRedirect = new URL(googleStart.headers.get("location"));
    assert.equal(loginRedirect.hostname, "synthetic.invalid", "Never contact real OAuth during test");
    assert.equal(loginRedirect.searchParams.get("provider"), "google");

    for (const endpoint of ["/api/system/onboarding-status", "/api/system/whatsapp-health"]) {
      const response = await fetch(origin + endpoint, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 401, endpoint + " must require authentication");
    }

    const page = await fetch(origin + "/", { signal: AbortSignal.timeout(3000) });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<!doctype html/i, "Vite UI must be served from the built artifact");
    const scriptPath = html.match(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/i)?.[1];
    assert.ok(scriptPath, "Built login JS asset missing");
    const jsResponse = await fetch(new URL(scriptPath, origin), {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(jsResponse.status, 200);
    const js = await jsResponse.text();
    assert.equal(
      googleOauthFragmentIsClearedBeforeExchange(js),
      true,
      "Google OAuth fragment must be cleared before awaiting exchange",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.race([once(child, "exit").catch(() => {}), delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
