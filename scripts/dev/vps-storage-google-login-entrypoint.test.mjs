import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const loginFile = new URL("../../artifacts/ai-task-center/src/pages/login.tsx", import.meta.url);
const authContextFile = new URL("../../artifacts/ai-task-center/src/contexts/auth-context.tsx", import.meta.url);
const authApiFile = new URL("../../artifacts/ai-task-center/src/lib/auth-api.ts", import.meta.url);

const loginSource = readFileSync(loginFile, "utf8");
const authContextSource = readFileSync(authContextFile, "utf8");
const authApiSource = readFileSync(authApiFile, "utf8");
const ast = ts.createSourceFile("login.tsx", loginSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("Google OAuth entrypoint remains visible on DEV and PROD", () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const buttons = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "Button" &&
      node.getText(ast).includes("Masuk dengan Google")) buttons.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(buttons.length, 1, "There must be exactly one Google login button");
  const googleButton = buttons[0];
  assert.match(googleButton.getText(ast), /window\.location\.assign\("\/api\/auth\/google\/start"\)/);
  let parent = googleButton.parent;
  while (parent) {
    if ((ts.isJsxExpression(parent) || ts.isBinaryExpression(parent) || ts.isConditionalExpression(parent)) &&
      parent.getText(ast).includes("isDevPasswordless")) {
      assert.fail("Google login must not be gated by DEV passwordless mode");
    }
    parent = parent.parent;
  }
});

test("DEV UI only offers verified Google; PROD password form remains", () => {
  assert.match(loginSource, /await login\(email, password\)/);
  assert.match(loginSource, /\{!isDevPasswordless && \(<\>/);
  assert.match(loginSource, /<form onSubmit=\{handleSubmit\}/);
  assert.match(loginSource, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(loginSource, /Email saja bukan OTP dan tidak memberikan akses/);
  assert.doesNotMatch(loginSource, /isDevPasswordless \? "" : password/);
});

test("Google OAuth fragment is still exchanged for the app session", () => {
  assert.match(authContextSource, /hash\.get\("access_token"\)/);
  assert.match(authContextSource, /apiGoogleLogin\(supabaseAccessToken\)/);
  assert.match(authContextSource, /history\.replaceState/);
  const strippedAt = authContextSource.indexOf("window.history.replaceState(");
  const exchangedAt = authContextSource.indexOf("await apiGoogleLogin(supabaseAccessToken)");
  assert.ok(strippedAt >= 0 && exchangedAt >= 0 && strippedAt < exchangedAt,
    "OAuth fragment must be cleared before the async exchange begins");
  const postExchangeScrub = authContextSource.indexOf("window.history.replaceState(", strippedAt + 1);
  assert.ok(postExchangeScrub > exchangedAt,
    "OAuth fragment must be checked again after an async Google exchange");
  assert.match(authContextSource, /window\.location\.hash\.includes\("access_token="\)/);
  assert.equal(authContextSource.split("window.history.replaceState(").length - 1, 2,
    "OAuth callback uses one early and one conditional final URL scrub");
  assert.match(authApiSource, /authFetch\("\/api\/auth\/google"/);
});
