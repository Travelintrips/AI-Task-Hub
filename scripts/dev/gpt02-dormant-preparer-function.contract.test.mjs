import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url);
const fixture=readFileSync(new URL('./gpt02-core-task-preparation-isolated.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('./gpt02-dormant-preparer-function-locked.sql',import.meta.url),'utf8');
const currentRoute=readFileSync(new URL('../../artifacts/api-server/src/routes/executions.ts',import.meta.url),'utf8');
const match=fixture.match(/CREATE FUNCTION gpt02_stage\.prepare_core_task\([\s\S]*?\nEND \$\$;/);
assert.ok(match,'one exact isolated source function is required');
const body=match[0].replace('CREATE FUNCTION gpt02_stage.prepare_core_task(', 'CREATE FUNCTION gpt02_stage.prepare_core_task_dormant(');
test('dormant SQL contains byte-identical previously tested Hub+Core logic',()=>{
 assert.equal(migration.split(body).length,2);
 assert.ok(migration.includes('Function-body SHA256: '+createHash('sha256').update(body).digest('hex')));
 assert.match(body,/p_task<=136/);
 assert.match(body,/INSERT INTO ai_platform\.ai_coding_tasks/);
 assert.match(body,/INSERT INTO public\.ai_execution_jobs/);
 assert.match(body,/INSERT INTO gpt02_stage\.core_preparations/);
 assert.match(body,/HUB_TASK_ALREADY_EXECUTED_NO_REPREPARE/);
 assert.match(body,/productionAllowed',false/);
});
test('code generator will fail CI if tested source diverges from checked-in migration',()=>{
 const out=spawnSync(process.execPath,[new URL('./generate-gpt02-dormant-preparer.cjs',import.meta.url).pathname,'--check'],{encoding:'utf8'});
 assert.equal(out.status,0,out.stderr||out.stdout);
});
test('stored definition cannot be executed by app, preparer, anon or service role',()=>{
 for(const x of [
 'REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text) FROM PUBLIC;',
 'REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text) FROM gpt02_core_prep_login;',
 'REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text) FROM anon,authenticated,service_role;',
 "has_function_privilege('postgres',f.oid,'EXECUTE')",
 "has_function_privilege('gpt02_core_prep_login',f.oid,'EXECUTE')",
 "has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')",
 'GPT02_DORMANT_PREPARER_FUNCTION_ACCESS_NOT_LOCKED'
 ]) assert.ok(migration.includes(x),x);
 assert.equal((migration.match(/SECURITY DEFINER SET search_path=pg_catalog/g)||[]).length,1);
 assert.doesNotMatch(migration,/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+gpt02_stage\.prepare_core_task\(/i);
});
test('one transaction restores owner authorization and never grants parent table writes',()=>{
 assert.doesNotMatch(migration,/^(BEGIN|COMMIT);$/m);
 const fixture=readFileSync(new URL('./test-gpt02-dormant-preparer-function-pg17.sh',import.meta.url),'utf8');
 assert.match(fixture,/run_migration\(\)/);
 assert.match(fixture,/printf 'BEGIN;/);
 assert.match(fixture,/printf '\\nCOMMIT;/);
 const set=migration.indexOf('GRANT gpt02_core_prep_owner TO postgres WITH SET TRUE');
 const reset=migration.indexOf('RESET ROLE;');
 const revoke=migration.indexOf('REVOKE gpt02_core_prep_owner FROM postgres GRANTED BY postgres;');
 assert.ok(set>0&&reset>set&&revoke>reset);
 assert.match(migration,/GPT02_DORMANT_PREPARER_OWNER_GRANT_NOT_RESTORED/);
 assert.doesNotMatch(migration,/^GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|REFERENCES|USAGE|CREATE|EXECUTE)\b/im);
 assert.doesNotMatch(migration,/^ALTER\s+(?:USER|ROLE|TABLE\s+public\.|TABLE\s+ai_platform\.)/im);
 assert.doesNotMatch(migration,/^SQL$/m);
});
test('historical Task135 and Task136 or pre-existing approvals reject the operation',()=>{
 assert.match(migration,/gpt02_approvals_future_task_only/);
 assert.match(migration,/task_id>136/);
 assert.match(migration,/gpt02_private\.approvals/);
 assert.match(migration,/gpt02_private\.receipts/);
 assert.match(migration,/SELECT count\(\*\) FROM gpt02_stage\.core_preparations/);
 assert.match(migration,/p_task<=136/);
});
test('existing lifecycle remains fail-closed, and preparer not mounted in live API routes',()=>{
 assert.match(currentRoute,/GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED/);
 assert.match(currentRoute,/GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER/);
 assert.doesNotMatch(currentRoute,/prepare_core_task_dormant|gpt02-dormant-preparer-function-locked/);
});

test('reconciliation migration only attests exact existing definition, never recreates a role or function',()=>{
 const src=readFileSync(new URL('./gpt02-dormant-function-existing-state-attestation.sql',import.meta.url),'utf8');
 assert.match(src,/VERIFICATION-ONLY migration \(NO DDL or business writes\)/);
 assert.match(src,/n\.nspname='gpt02_stage' AND p\.proname='prepare_core_task_dormant'/);
 assert.match(src,/b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4/);
 assert.match(src,/sha256\(convert_to\(p\.prosrc,'UTF8'\)\)/);
 assert.match(src,/GPT02_DORMANT_VERIFICATION_BODY_OR_OWNER_MISMATCH/);
 assert.match(src,/GPT02_DORMANT_VERIFICATION_AUTHORITY_LEAK/);
 assert.match(src,/GPT02_DORMANT_VERIFICATION_PREPARER_NOT_INERT/);
 assert.doesNotMatch(src,/^\s*(?:COMMIT;|ROLLBACK;|CREATE\s|ALTER\s|DROP\s|INSERT\s|UPDATE\s|DELETE\s|TRUNCATE\s|GRANT\s|REVOKE\s)/m);
 assert.doesNotMatch(src,/^BEGIN;$/m);
 assert.match(src,/^DO \$gpt02_attestation\$/m);
});
