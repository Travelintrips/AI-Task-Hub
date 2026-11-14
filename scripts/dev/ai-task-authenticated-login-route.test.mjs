import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const router = readFileSync(new URL("../../artifacts/ai-task-center/src/App.tsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../../artifacts/ai-task-center/src/pages/login.tsx", import.meta.url), "utf8");

test("authenticated /login redirects to dashboard instead of falling through to NotFound", () => {
  assert.match(router, /import \{[^}]*Redirect[^}]*\} from "wouter"/);
  assert.match(router, /window\.location\.pathname === "\/login"/);
  assert.match(router, /<Redirect to="\/" replace \/>/);
  const unauth = router.indexOf("if (!isAuthenticated)");
  const redirect = router.indexOf('window.location.pathname === "/login"');
  const layout = router.indexOf("<AppLayout>");
  assert.ok(unauth >= 0 && unauth < redirect && redirect < layout);
});

test("signed-out users still see Login and existing Google/email entrypoints", () => {
  assert.match(router, /if \(!isAuthenticated\) \{\s*return <Login \/>;/);
  assert.match(login, /window\.location\.assign\("\/api\/auth\/google\/start"\)/);
  assert.match(login, /await login\(email, isDevPasswordless \? "" : password\)/);
});

test("the public login route does not bypass login or protect GPT02 endpoints", () => {
  assert.match(router, /<AuthProvider>/);
  assert.match(router, /<Route path="\/ai-tasks\/:id" component=\{AiTaskDetail\} \/>/);
  assert.match(router, /<Route component=\{NotFound\} \/>/);
});
