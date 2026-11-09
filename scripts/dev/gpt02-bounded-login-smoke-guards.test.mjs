import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('./gpt02-cst-dev-bounded-login-smoke.mjs',import.meta.url));
test('retired live probe refuses execution even with the previous enable flag',()=>{
 const run=spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,GPT02_BOUNDED_LOGIN_SMOKE:'1',NODE_ENV:'development'},timeout:3000});
 assert.equal(run.status,2);const result=JSON.parse(run.stderr.trim());
 assert.equal(result.code,'LIVE_CREDENTIAL_ROTATION_SMOKE_RETIRED');
 assert.equal(result.databaseChanges,false);assert.equal(result.workerDispatch,false);assert.equal(result.networkRequests,false);
});
test('retired entry point contains no credential, SQL, fetch, or executable import path',()=>{
 const code=readFileSync(script,'utf8');
 assert.doesNotMatch(code,/\b(?:ALTER ROLE|PASSWORD NULL|pg_terminate_backend|SUPABASE_DATABASE_URL_DEV|fetch\s*\(|import\s|require\s*\()/);
});
test('safe fixture replacement is present and does not inherit live connection secrets',()=>{
 const fixture=readFileSync(new URL('./test-gpt02-issuer-store-isolated.sh',import.meta.url),'utf8');
 assert.match(fixture,/--network none/);assert.doesNotMatch(fixture,/SUPABASE_DATABASE_URL_DEV/);
});
