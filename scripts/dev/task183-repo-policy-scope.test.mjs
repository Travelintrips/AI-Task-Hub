import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Source-only verification. No database connection, browser token, signer,
// root credential, approval, or live service activity.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const agents=readFileSync(resolve(root,"AGENTS.md"),"utf8");
const writer=readFileSync(resolve(root,"scripts/dev/task183-read-issuer-receipt.py"),"utf8");
const unit=readFileSync(resolve(root,"scripts/dev/cst-task183-register-receipt@.service"),"utf8");
const scope=readFileSync(resolve(root,"docs/dev/TASK183_RECEIPT_SCHEMA_AND_CUSTODY_SCOPE_20261122.md"),"utf8");

test("existing Supabase database constraint remains intact",()=>{
  assert.match(agents,/ONLY VALID DATABASE:\s*\*\*Supabase PostgreSQL\*\*/);
  assert.match(agents,/NO fallback database implementations/);
  assert.match(agents,/NO mock replacement of DB in production logic/);
});

test("Sport Center scSchema rule is explicitly product-scoped",()=>{
  assert.match(agents,/Sport Center scope only:/);
  assert.match(agents,/new \*\*Sport Center\*\* tables on `scSchema`/);
  assert.match(agents,/\*\*Existing GPT02 operational evidence\*\* uses `gpt02_stage` and `gpt02_private`/);
  assert.doesNotMatch(agents,/Is schema inside `sport_center` namespace\?/);
});

test("no new public schema and no silent GPT02 migration",()=>{
  assert.match(agents,/\*\*no new public tables\*\* without explicit schema\/DDL review/);
  assert.match(agents,/MUST NOT be moved or rewritten/);
  assert.match(scope,/Tidak ada pemindahan atau DDL baru/);
});

test("one-shot native PostgreSQL custody is narrowly named, not generic access",()=>{
  assert.match(agents,/single proposed, review-gated CST-DEV-only exception/);
  assert.match(agents,/scripts\/dev\/task183-read-issuer-receipt\.py --record/);
  assert.match(agents,/cst-task183-register-receipt@\.service/);
  assert.match(agents,/NO-GO for live deployment or receipt writes/);
  assert.match(agents,/Any other native client remains prohibited/);
  assert.match(agents,/not an application persistence fallback/i);
});

test("actual helper still verifies signed receipt before native connection",()=>{
  const verified=writer.indexOf("proof = read_receipt(request_id)");
  const connected=writer.indexOf("psycopg.connect(");
  assert.ok(verified>=0 && connected>verified);
  assert.match(writer,/session_user = 'gpt02_task183_verifier_login'/);
  assert.match(writer,/SET LOCAL ROLE gpt02_task183_receipt_verifier/);
});

test("native helper refuses table-wide grant and requires all five columns",()=>{
  assert.match(writer,/NOT has_table_privilege/);
  assert.equal((writer.match(/has_column_privilege\(/g)||[]).length,5);
  for(const field of ["request_id","approval_sha256","predecessor_attempt_id","signed_at","expires_at"]){
    assert.ok(writer.includes("'"+field+"', 'INSERT'"),field);
  }
  assert.match(writer,/VERIFIER_RECEIPT_INSERT_NOT_GRANTED/);
});

test("systemd root-only credentials and no generic app sender path",()=>{
  assert.match(unit,/LoadCredentialEncrypted=/);
  assert.match(unit,/NoNewPrivileges=yes/);
  assert.match(unit,/ProtectSystem=strict/);
  assert.match(unit,/UMask=0077/);
  assert.match(unit,/task183-read-issuer-receipt\.py %i --record/);
});

test("a policy clarification does not authorize a live signing or dispatch",()=>{
  assert.match(scope,/tanda tangan/i);
  assert.match(scope,/tidak layak di-merge\/deploy/);
  assert.match(agents,/tidak|NOT an application persistence fallback/);
});
