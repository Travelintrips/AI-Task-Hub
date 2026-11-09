import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(apiRoot, "dist");
const bundle = readFileSync(join(dist, "index.mjs"), "utf8");
const runtimeResolver = "const outputDir = globalThis.__dirname;";
assert.equal(bundle.split(runtimeResolver).length - 1, 1,
  "Pino worker resolver must use runtime bundle directory exactly once");
assert.doesNotMatch(bundle, /const outputDir = ["']\//,
  "Pino worker resolver must never embed the build host absolute directory");
const map = JSON.parse(readFileSync(join(dist, "index.mjs.map"), "utf8"));
assert.ok(map.sourcesContent.some(x => x?.includes(runtimeResolver)),
  "Source map must not retain stale build-host Pino resolver");
for (const name of ["pino-file.mjs", "pino-pretty.mjs", "pino-worker.mjs",
  "thread-stream-worker.mjs"]) {
  assert.equal(existsSync(join(dist, name)), true, name + " is required in image");
}
console.log("PINO_RELOCATABLE_DOCKER_BUILD_PASS all 4 worker modules, no build-host path");
