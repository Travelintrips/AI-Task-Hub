import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./gpt02-private-preparation-staging-inactive.sql',import.meta.url),'utf8');
const routes=readFileSync(new URL('../../artifacts/api-server/src/routes/executions.ts',import.meta.url),'utf8');
test('private schema migration is only for postgres database with dormant role',()=>{
 for(const s of ["current_database()<>'postgres'","current_user<>'postgres'","transaction_read_only",'GPT02_PREPARER_NOT_DORMANT','NOLOGIN NOINHERIT NOSUPERUSER','CONNECTION LIMIT 0 PASSWORD NULL','GPT02_STAGE_ALREADY_EXISTS_REQUIRE_MANUAL_REVIEW'])assert.ok(source.includes(s),s);
});
test('staging table keeps immutable exact Hub/Core IDs and excludes historical tasks',()=>{
 for(const s of ["CHECK(company_id='default')",'CHECK(hub_task_id>136)','REFERENCES ai_platform.ai_coding_tasks(id)','REFERENCES public.ai_execution_jobs(id)',
  'command_candidate_id uuid NOT NULL UNIQUE','attempt_id uuid NOT NULL UNIQUE','config_sha256 text NOT NULL','PRIMARY KEY(company_id,hub_task_id)',
  'ENABLE ROW LEVEL SECURITY','FORCE ROW LEVEL SECURITY','CREATE POLICY gpt02_owner_only_preparation','APPEND_ONLY_PREPARATION'])assert.ok(source.includes(s),s);
});
test('only SECURITY INVOKER non-operational contract function, no dispatched routine or grants',()=>{
 assert.equal((source.match(/LANGUAGE (?:sql|plpgsql) SECURITY INVOKER/g)||[]).length,2);
 assert.doesNotMatch(source,/SECURITY DEFINER|GRANT EXECUTE|GRANT SELECT|GRANT INSERT|CREATE EXTENSION|ALTER USER|ALTER ROLE|ALTER TABLE public|ALTER TABLE ai_platform/);
 for(const s of ['REVOKE ALL ON ALL TABLES IN SCHEMA gpt02_stage FROM PUBLIC','REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gpt02_stage FROM PUBLIC','REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gpt02_stage FROM gpt02_core_prep_login'])assert.ok(source.includes(s));
 assert.doesNotMatch(source,/CREATE FUNCTION gpt02_stage\.prepare_core_task\(/);
});
test('source contains no credentials, native worker send, or automatic enrollment',()=>{
 for(const s of ['service_role','DATABASE_URL','TOKEN=','PASSWORD \'','submitAiTask','dispatchExternal','FLEET_WA_DEVICE_ID'])assert.ok(!source.includes(s),s);
 assert.match(routes,/GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED/);
 assert.match(routes,/GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER/);
});
