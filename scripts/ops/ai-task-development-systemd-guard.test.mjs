import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(join(here, "systemd/99-fail-closed-stale-credentials.conf"), "utf8");

test("legacy AI Task standalone service forbids systemctl start until explicit authorized release", () => {
  assert.match(content, /^\[Unit\]/m);
  assert.match(content, /^RefuseManualStart=yes$/m);
  assert.match(content, /^ConditionPathExists=\/etc\/ai-task-dev-authorized-reader-and-release\.ready$/m);
});

test("legacy runtime cannot auto-restart an invalid database credential", () => {
  assert.match(content, /^\[Service\]/m);
  assert.match(content, /^Restart=no$/m);
});

test("a versioned fail-closed drop-in does not replace app binaries or embed credentials", () => {
  assert.doesNotMatch(content, /^ExecStart(?:Pre)?=/m);
  assert.doesNotMatch(content, /^Environment(?:File)?=/m);
  assert.doesNotMatch(content, /(?:postgresql?:\/\/|password\s*=|token\s*=|secret\s*=)/i);
});
