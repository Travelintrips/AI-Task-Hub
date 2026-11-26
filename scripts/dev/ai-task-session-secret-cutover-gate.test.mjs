import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";

const index = readFileSync(new URL("../../artifacts/api-server/src/index.ts", import.meta.url), "utf8");
const source = readFileSync(new URL("../../artifacts/api-server/src/lib/runtime-session-secret.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.ts", index, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function evaluate(env) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  new Script(js).runInNewContext({ process: { env } }, { timeout: 1000 });
}
test("JWT startup guard runs before app import, even before any app startup side effects", () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.ok(ts.isImportDeclaration(ast.statements[0]));
  assert.equal(ast.statements[0].moduleSpecifier.text, "./lib/runtime-session-secret");
  assert.equal(ast.statements[1].moduleSpecifier.text, "./app");
  assert.ok(index.indexOf('import "./lib/runtime-session-secret";') < index.indexOf('import app from "./app";'));
  assert.match(source, /process\.env\.NODE_ENV === "development"/);
  assert.match(source, /process\.env\.NODE_ENV === "production"/);
});
test("DEV and PROD reject absent, short, whitespace-only, and known fallback JWT secret", () => {
  const weak = [undefined, "", "short", " ".repeat(40), "fallback-secret-change-in-production"];
  for (const NODE_ENV of ["development", "production"]) {
    for (const SESSION_SECRET of weak) {
      const env = { NODE_ENV, ...(SESSION_SECRET === undefined ? {} : { SESSION_SECRET }) };
      assert.throws(() => evaluate(env), /SESSION_SECRET must be a non-default/, NODE_ENV);
    }
  }
});
test("DEV and PROD accept a private 32+ character secret without changing JWT behavior", () => {
  for (const NODE_ENV of ["development", "production"]) {
    evaluate({ NODE_ENV, SESSION_SECRET: "test-only-opaque-session-value-42-chars-x" });
  }
});
test("unit and synthetic test modes preserve their previous behavior", () => {
  evaluate({ NODE_ENV: "test" });
  evaluate({});
});
