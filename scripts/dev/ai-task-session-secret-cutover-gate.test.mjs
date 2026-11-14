import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../artifacts/api-server/src/index.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const guard = ast.statements.filter(
  (n) => ts.isIfStatement(n) && n.getText(ast).includes("SESSION_SECRET"),
);
function evaluate(env) {
  assert.equal(guard.length, 1, "exactly one source entrypoint secret guard");
  const js = ts.transpileModule(guard[0].getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  new Script(js).runInNewContext({ process: { env } }, { timeout: 1000 });
}
test("JWT fallback guard appears before app.listen and covers normal DEV and PROD", () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.equal(guard.length, 1);
  assert.ok(guard[0].getStart(ast) < source.indexOf("app.listen("));
  assert.match(guard[0].getText(ast), /process\.env\.NODE_ENV === "development"/);
  assert.match(guard[0].getText(ast), /process\.env\.NODE_ENV === "production"/);
});
test("real DEV and PROD reject absent, short, whitespace and known fallback secrets", () => {
  const weak = [undefined, "", "short", " ".repeat(40), "fallback-secret-change-in-production"];
  for (const NODE_ENV of ["development", "production"]) {
    for (const SESSION_SECRET of weak) {
      const env = { NODE_ENV, ...(SESSION_SECRET === undefined ? {} : { SESSION_SECRET }) };
      assert.throws(() => evaluate(env), /SESSION_SECRET must be a non-default/, NODE_ENV);
    }
  }
});
test("real DEV and PROD accept a private long opaque secret", () => {
  for (const NODE_ENV of ["development", "production"]) {
    evaluate({ NODE_ENV, SESSION_SECRET: "test-only-opaque-session-value-42-chars-x" });
  }
});
test("unit and synthetic test modes retain existing behavior", () => {
  evaluate({ NODE_ENV: "test" });
  evaluate({});
});
