import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fixture=readFileSync(new URL('./gpt02-operator-link.fixture.sql',import.meta.url),'utf8');
const src=readFileSync(new URL('./gpt02-private-operator-sidecars-inert.sql',import.meta.url),'utf8');
const a=fixture.indexOf('CREATE TABLE gpt02_private.operator_links(');
const b=fixture.indexOf('\nCREATE FUNCTION gpt02_private.valid_operator_link(',a);
test('staged immutable tables and FK are byte-identical to tested operator link fixture',()=>{
 assert.ok(a>0&&b>a);assert.ok(src.includes(fixture.slice(a,b)));
 assert.match(src,/receipt_identity_tuple UNIQUE\(id,command_id\)/);
 assert.match(src,/CHECK\(hub_task_id>136\)/);
 assert.match(src,/CHECK\(may_dispatch_worker=false\)/);
 assert.match(src,/CHECK\(may_issue_grant=false\)/);
});
test('no issuer function, runtime role activation or early COMMIT in schema candidate',()=>{
 assert.doesNotMatch(src,/^(?:BEGIN|COMMIT);$/m);
 assert.doesNotMatch(src,/^CREATE FUNCTION\b|^ALTER ROLE\b|^GRANT EXECUTE\b/im);
 assert.doesNotMatch(src,/^INSERT INTO\b|^UPDATE\b|^DELETE FROM\b/im);
 assert.match(src,/REVOKE SET OPTION FOR gpt02_store_owner/);
 assert.match(src,/GPT02_INERT_EVIDENCE_HISTORY_NOT_EMPTY/);
 assert.match(src,/GPT02_INERT_EVIDENCE_ALREADY_STAGED/);
 assert.match(src,/REVOKE ALL ON gpt02_private.operator_links/);
});
