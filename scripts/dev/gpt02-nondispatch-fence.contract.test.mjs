import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fixture=readFileSync(new URL('./gpt02-post-consumption-fence.fixture.sql',import.meta.url),'utf8');
const store=readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs',import.meta.url),'utf8');
const routes=readFileSync(new URL('../../artifacts/api-server/src/routes/executions.ts',import.meta.url),'utf8');
test('only the named disposable issuer database may receive the new fence table',()=>{
 assert.match(fixture,/current_database\(\)<>'gpt02_issuer_isolated'/);
 assert.match(fixture,/NOT a hosted DB migration/);
 assert.match(fixture,/SET LOCAL ROLE gpt02_store_owner/);
 assert.match(fixture,/FORCE ROW LEVEL SECURITY/);
});
test('fence row is immutable, uniquely tied to one prior identity receipt and cannot grant dispatch',()=>{
 for(const x of [
  'receipt_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.core_identity_receipts(receipt_id)',
  'command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.receipts(command_id)',
  'link_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.operator_links(link_id)',
  'hub_execution_id uuid NOT NULL UNIQUE','attempt_id uuid NOT NULL UNIQUE',
  'lease_epoch bigint NOT NULL DEFAULT 1 CHECK(lease_epoch=1)',
  'dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false)',
  'core_ledger_written boolean NOT NULL DEFAULT false CHECK(core_ledger_written=false)',
  'immutable_post_consumption_fences'])assert.ok(fixture.includes(x),x);
});
test('fence issuance is restricted to a dedicated issuer login, after receipt lock and expiry recheck',()=>{
 const start=fixture.indexOf('CREATE FUNCTION gpt02_private.reserve_post_consumption_fence(');
 const fn=fixture.slice(start);
 for(const x of ["session_user<>'dev_gpt02_issuer_evidence'",'FOR UPDATE','FOR SHARE','clock_timestamp()',
   "now_exact+interval '15 seconds'",'ON CONFLICT DO NOTHING','RETURN token;',
   'REVOKE ALL ON FUNCTION','TO dev_gpt02_issuer_evidence'])assert.ok(fn.includes(x),x);
 const lock=fn.indexOf('FOR UPDATE'),now=fn.indexOf('now_exact:=clock_timestamp()');assert.ok(lock>0&&now>lock);
 assert.ok(fn.includes('l.expires_at<=now_exact')&&fn.includes('a.expires_at<=now_exact'));
});
test('fence connector validates Ed25519 origin signatures before database connection',()=>{
 const begin=store.indexOf('async reserveNonDispatchFence(input)'),end=store.indexOf('async recordApproval(envelope)',begin);
 assert.ok(begin>0&&end>begin);
 const fn=store.slice(begin,end);
 for(const x of ['#verifiedLinkedInput','this.#transaction(',"this.#kind!=='issuer'",'INVALID_FENCE_INPUT',
   'FENCE_UNAVAILABLE_OR_ALREADY_RESERVED',"issuerLeaseGranted:false",'dispatchPermitted:false'])assert.ok(fn.includes(x),x);
 assert.ok(fn.indexOf('#verifiedLinkedInput')<fn.indexOf('this.#transaction('));
 assert.match(store,/FENCE_COLUMNS/);assert.match(store,/DIRECT_EVIDENCE_ACCESS_OR_SCHEMA_MISSING/);
});
test('operational GPT02 lifecycle remains held; no fence method imported into the live routes',()=>{
 for(const x of ['reserveNonDispatchFence','reserve_post_consumption_fence','gpt02-post-consumption-fence.fixture'])
  assert.equal(routes.includes(x),false,x);
 assert.match(routes,/GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED/);
 assert.match(routes,/GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER/);
});
