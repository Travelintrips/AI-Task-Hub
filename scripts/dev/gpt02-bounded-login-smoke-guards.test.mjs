import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('./gpt02-cst-dev-bounded-login-smoke.mjs',import.meta.url),'utf8');
test('operator-only probe pins existing DEV, known roles, host and CA before mutation',()=>{
 for(const token of ["GPT02_BOUNDED_LOGIN_SMOKE!=='1'","NODE_ENV!=='development'","xssrfshdrtdfupgqwfdw","dev-ai-task.cstlogistic.co.id","CA_PIN_VALIDATION_FAILED","CANDIDATE_BASELINE_CHANGED","NOT_EMPTY_INACTIVE_FOUNDATION","CANDIDATE_SESSIONS_ALREADY_EXIST"])assert.ok(s.includes(token),token);
 assert.ok(s.indexOf('CA_PIN_VALIDATION_FAILED')<s.indexOf('armed=true'));
});
test('temporary credentials expire, no application grants, no evidence writes',()=>{
 assert.match(s,/Date\.now\(\)\+120000/);assert.match(s,/smokeRandomBytes\(32\)/);
 assert.doesNotMatch(s,/query\([`'"]\s*(?:INSERT|UPDATE|DELETE|GRANT|CREATE)\b/i);
 assert.match(s,/BEGIN READ ONLY/);
});
test('cleanup removes passwords, closes logins, and terminates only test-role sessions',()=>{
 for(const token of ['finally','NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL','RELOCK_POSTCONDITION_FAILED','backend_start >= $2::timestamptz','usename=ANY($1::text[])','CRITICAL_RELOCK_REVIEW'])assert.ok(s.includes(token),token);
});
