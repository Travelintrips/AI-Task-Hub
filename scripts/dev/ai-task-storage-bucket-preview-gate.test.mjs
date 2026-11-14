import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";

const storageSource = readFileSync(
  new URL("../../artifacts/api-server/src/lib/storage.ts", import.meta.url), "utf8",
);
const supabaseSource = readFileSync(
  new URL("../../artifacts/api-server/src/lib/supabase.ts", import.meta.url), "utf8",
);

function loadSource(source, resolve, env) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: resolve,
    process: { env },
    console,
  };
  new Script(output).runInNewContext(context, { timeout: 1000 });
  return module.exports;
}

function mockedStorage({ buckets = [], disabled = false, listError = null } = {}) {
  const calls = [];
  const warnings = [];
  const client = {
    storage: {
      listBuckets: async () => ({
        data: buckets.map((name) => ({ name })),
        error: listError,
      }),
      createBucket: async (name, options) => {
        calls.push({ name, options });
        return { error: null };
      },
    },
  };
  const logger = {
    warn: (...args) => warnings.push(args),
    info: () => {},
    error: () => {},
  };
  const env = {
    NODE_ENV: "development",
    SUPABASE_SERVICE_ROLE_KEY_DEV: "synthetic-credential-for-test-only",
    ...(disabled ? { DISABLE_STORAGE_BUCKET_AUTO_CREATE: "true" } : {}),
  };
  const supabase = loadSource(supabaseSource, (id) => {
    if (id === "@supabase/supabase-js") return { createClient: () => client };
    if (id === "ws") return {};
    if (id === "./logger") return { logger };
    if (id === "../config") return { config: { supabase: { urlDev: "https://synthetic.invalid" } } };
    throw new Error("Unexpected import " + id);
  }, env);
  const storage = loadSource(storageSource, (id) => {
    if (id === "./logger") return { logger };
    if (id === "./supabase") return supabase;
    throw new Error("Unexpected import " + id);
  }, env);
  return { calls, warnings, supabase, storage };
}

test("isolated candidate never creates any of the three Storage buckets when missing", async () => {
  const m = mockedStorage({ disabled: true });
  await m.storage.ensureExportImportBucket();
  await m.supabase.ensureBucket();
  await assert.rejects(m.supabase.ensurePaymentProofBucket(), /automatic creation disabled/);
  assert.equal(m.calls.length, 0);
});

test("normal DEV preserves the existing auto-create behavior", async () => {
  const m = mockedStorage();
  await m.storage.ensureExportImportBucket();
  await m.supabase.ensureBucket();
  await m.supabase.ensurePaymentProofBucket();
  assert.deepEqual(Array.from(m.calls, (c) => c.name), [
    "exportimport", "ai-task-center-documents", "payment-proofs",
  ]);
});

test("isolated candidate accepts preexisting Storage buckets without writes", async () => {
  const m = mockedStorage({
    disabled: true,
    buckets: ["exportimport", "ai-task-center-documents", "payment-proofs"],
  });
  await m.storage.ensureExportImportBucket();
  await m.supabase.ensureBucket();
  await m.supabase.ensurePaymentProofBucket();
  assert.equal(m.calls.length, 0);
});

test("failed Storage list operation does not cause a candidate create", async () => {
  const m = mockedStorage({ disabled: true, listError: new Error("synthetic list failure") });
  await m.storage.ensureExportImportBucket();
  await assert.rejects(m.supabase.ensurePaymentProofBucket(), /Gagal memeriksa bucket/);
  assert.equal(m.calls.length, 0);
});
