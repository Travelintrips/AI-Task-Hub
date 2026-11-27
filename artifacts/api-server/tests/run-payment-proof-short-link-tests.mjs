import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const artifactDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDir = path.join(artifactDir, "tmp");
const outputFile = path.join(outputDir, "payment-proof-token.test.mjs");

// Regression: 10-character API endpoints such as /api/audit-logs must not
// be mistaken for short payment-proof tokens by the fallback router.
const appSource = await readFile(path.join(artifactDir, "src", "app.ts"), "utf8");
const apiRouteIndex = appSource.indexOf('app.use("/api", router);');
const fallbackIndex = appSource.indexOf('app.use("/api", paymentProofPublicRouter);');
assert.ok(apiRouteIndex !== -1, "Main API router must be mounted");
assert.ok(fallbackIndex !== -1, "Legacy payment-proof fallback must be mounted");
assert.ok(
  apiRouteIndex < fallbackIndex,
  "API routes must run before the 10-character payment-proof fallback",
);

await mkdir(outputDir, { recursive: true });
try {
  await build({
    entryPoints: [path.join(artifactDir, "src/lib/payment-proof-token.test.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outputFile,
    logLevel: "silent",
  });
  await import(pathToFileURL(outputFile).href);
} finally {
  await rm(outputFile, { force: true });
}