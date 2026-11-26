import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./gpt02-post-consumption-fence-hosted-inert.sql',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./gpt02-post-consumption-fence.fixture.sql',import.meta.url),'utf8');
const start=fixture.indexOf('CREATE TABLE gpt02_private.post_consumption_fences (');
const end=fixture.indexOf('CREATE FUNCTION gpt02_private.reserve_post_consumption_fence(',start);
test('inert hosted fence DDL is byte-identical to previously tested disposable fence shape',()=>{
 assert.ok(start>0&&end>start);
 assert.ok(source.includes(fixture.slice(start,end).trim()));
});
test('migration requires transaction-scoped scoped-owner guard and rolls back escalation',()=>{
 assert.match(source,/session_user<>'postgres'/);
 assert.match(source,/current_user<>'postgres'/);
 assert.match(source,/gpt02_inert_post_consumption_fence_20261110/);
 assert.match(source,/GPT02_INERT_FENCE_GRANT_GRAPH_CHANGED/);
 assert.match(source,/GPT02_INERT_FENCE_EVIDENCE_SCHEMA_DRIFT/);
 assert.match(source,/GPT02_INERT_FENCE_PREEXISTING_ACTIVITY/);
 assert.match(source,/GRANT gpt02_store_owner TO postgres WITH SET TRUE GRANTED BY postgres/);
 assert.match(source,/REVOKE SET OPTION FOR gpt02_store_owner FROM postgres GRANTED BY postgres RESTRICT/);
 assert.match(source,/GPT02_INERT_FENCE_ROLE_RESTORATION_FAILED/);
 assert.match(source,/GPT02_INERT_FENCE_AUTHORITY_LEAK/);
 assert.doesNotMatch(source,/^(?:BEGIN|COMMIT);$/m);
});
test('fence grants no dispatch, credentials, signed approval or live issuer functions',()=>{
 for(const x of ['dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false)',
  'core_ledger_written boolean NOT NULL DEFAULT false CHECK(core_ledger_written=false)',
  'FORCE ROW LEVEL SECURITY','immutable_post_consumption_fences',
  'REVOKE ALL ON gpt02_private.post_consumption_fences'])assert.ok(source.includes(x),x);
 for(const x of [/^CREATE FUNCTION\b/im,/^ALTER ROLE\b/im,/^GRANT EXECUTE\b/im,
  /^INSERT INTO\b/im,/^UPDATE\b/im,/^DELETE FROM\b/im,/^TRUNCATE\b/im])
  assert.doesNotMatch(source,x);
});
test('re-run must refuse existing fence and no real lifecycle route imports the migration',()=>{
 assert.match(source,/GPT02_INERT_FENCE_ALREADY_EXISTS/);
 assert.match(source,/GPT02_INERT_FENCE_OPERATIONAL_FUNCTION_ALREADY_PRESENT/);
 assert.match(source,/GPT02_INERT_FENCE_ROLE_ACTIVATED/);
 const routes=readFileSync(new URL('../../artifacts/api-server/src/routes/executions.ts',import.meta.url),'utf8');
 assert.equal(routes.includes('gpt02-post-consumption-fence-hosted-inert'),false);
 assert.match(routes,/GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED/);
});
