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

test("existing DEV email passwordless and PROD password input remain untouched", () => {
  assert.match(loginSource, /await login\(email, isDevPasswordless \? "" : password\)/);
  assert.match(loginSource, /\{!isDevPasswordless && \(\s*<div className="space-y-2">/);
  assert.match(loginSource, /type=\{showPassword \? "text" : "password"\}/);
});

test("Google OAuth fragment is still exchanged for the app session", () => {
  assert.match(authContextSource, /hash\.get\("access_token"\)/);
  assert.match(authContextSource, /apiGoogleLogin\(supabaseAccessToken\)/);
  assert.match(authContextSource, /history\.replaceState/);
  assert.match(authApiSource, /authFetch\("\/api\/auth\/google"/);
});
