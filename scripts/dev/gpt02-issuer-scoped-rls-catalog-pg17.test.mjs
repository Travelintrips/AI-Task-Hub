// DEV-only isolated catalog regression. No hosted DB or secrets; no signing/dispatch.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {EXPECTED_SCOPED_ISSUER_EVIDENCE_QUALS} from './gpt02-issuer-reader-readiness.mjs';

const sql=readFileSync(new URL('./gpt02-issuer-evidence-reader-owner-grants.sql',import.meta.url),'utf8');
const begin=sql.indexOf('DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.approvals;');
const finish=sql.indexOf('RESET ROLE;',begin);
assert.ok(begin>=0&&finish>begin,'POLICY_BLOCK_MISSING');
const policies=sql.slice(begin,finish);
assert.ok(!policies.includes('USING (true)'),'UNSCOPED_ISSUER_POLICY_FORBIDDEN');
const tables=['core_identity_receipts','post_consumption_fences','receipts'];
assert.deepEqual(Object.keys(EXPECTED_SCOPED_ISSUER_EVIDENCE_QUALS).sort(),tables);

function docker(args,options={}){
 const out=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:1024*1024,...options});
 assert.equal(out.error,undefined,String(out.error||''));
 assert.equal(out.status,0,'DOCKER_FIXTURE_FAILED: '+args[0]+' '+(out.stderr||'').slice(-700));
 return (out.stdout||'').trim();
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const expected=Object.entries(EXPECTED_SCOPED_ISSUER_EVIDENCE_QUALS)
 .map(([table,expr])=>'('+quote(table)+','+quote(expr)+')').join(',');
const schema=[
 'SET client_min_messages=WARNING;',
 'CREATE SCHEMA gpt02_private;',
 'CREATE ROLE gpt02_issuer_evidence_reader NOLOGIN;',
 'CREATE TABLE gpt02_private.approvals(command_id uuid PRIMARY KEY,nonce text,digest text,company_id text NOT NULL CHECK(company_id=\\'default\\'),task_id int NOT NULL CHECK(task_id>136),claims jsonb NOT NULL);',
 'CREATE TABLE gpt02_private.operator_links(link_id uuid PRIMARY KEY,command_id uuid UNIQUE REFERENCES gpt02_private.approvals(command_id),company_id text NOT NULL CHECK(company_id=\\'default\\'),hub_task_id int NOT NULL CHECK(hub_task_id>136),attempt_id uuid UNIQUE NOT NULL,attempt_number int NOT NULL CHECK(attempt_number=1),hub_execution_id uuid UNIQUE NOT NULL,core_task_id uuid NOT NULL,claims jsonb NOT NULL);',
 'CREATE TABLE gpt02_private.receipts(id uuid PRIMARY KEY,command_id uuid UNIQUE NOT NULL REFERENCES gpt02_private.approvals(command_id),nonce text,digest text,UNIQUE(id,command_id));',
 'CREATE TABLE gpt02_private.core_identity_receipts(receipt_id uuid PRIMARY KEY,command_id uuid UNIQUE NOT NULL,link_id uuid UNIQUE NOT NULL,FOREIGN KEY(receipt_id,command_id) REFERENCES gpt02_private.receipts(id,command_id),FOREIGN KEY(link_id) REFERENCES gpt02_private.operator_links(link_id));',
 'CREATE TABLE gpt02_private.post_consumption_fences(fence_id uuid PRIMARY KEY,receipt_id uuid UNIQUE NOT NULL REFERENCES gpt02_private.core_identity_receipts(receipt_id),command_id uuid UNIQUE NOT NULL REFERENCES gpt02_private.receipts(command_id),link_id uuid UNIQUE NOT NULL REFERENCES gpt02_private.operator_links(link_id),attempt_id uuid UNIQUE NOT NULL,hub_execution_id uuid UNIQUE NOT NULL,core_task_id uuid NOT NULL);',
 'DO $q$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY[\\'approvals\\',\\'operator_links\\',\\'receipts\\',\\'core_identity_receipts\\',\\'post_consumption_fences\\'] LOOP EXECUTE format(\\'ALTER TABLE gpt02_private.%I ENABLE ROW LEVEL SECURITY\\',t); EXECUTE format(\\'ALTER TABLE gpt02_private.%I FORCE ROW LEVEL SECURITY\\',t);END LOOP;END $q$;',
].join('\n');
const query=[
 'WITH expected(tablename,qual) AS (VALUES '+expected+'),',
 "actual AS (SELECT tablename,regexp_replace(qual,'[[:space:]]+',' ','g') AS qual",
 " FROM pg_policies WHERE schemaname='gpt02_private' AND policyname='issuer_evidence_reader_select')",
 "SELECT expected.tablename||':'||CASE WHEN expected.qual=actual.qual THEN 'MATCH' ELSE 'DRIFT' END",
 ' FROM expected JOIN actual USING(tablename) ORDER BY expected.tablename;'
].join('\n');

test('PG17 normalizes scoped issuer policies exactly; never opens runtime authority',async t=>{
 const name='gpt02-rls-pg17-'+process.pid+'-'+randomBytes(3).toString('hex');
 docker(['run','--rm','-d','--network','none','--name',name,
  '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
 t.after(()=>spawnSync('docker',['rm','-f',name],{timeout:20000,stdio:'ignore'}));
 let ready=false;
 for(let i=0;i<100;i++){
  const probe=spawnSync('docker',['exec',name,'psql','-X','-U','postgres','-d','postgres',
   '-Atqc','SELECT 1'],{encoding:'utf8',timeout:3000});
  const logs=spawnSync('docker',['logs',name],{encoding:'utf8',timeout:3000});
  if(probe.status===0&&probe.stdout.trim()==='1'&&
      (logs.stderr||'').includes('PostgreSQL init process complete')){ready=true;break;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.ok(ready,'ISOLATED_PG17_NOT_READY');
 const version=docker(['exec',name,'psql','-X','-U','postgres','-d','postgres','-Atqc','SHOW server_version_num']);
 assert.ok(version.startsWith('17'),'PG17_REQUIRED');
 const result=docker(['exec','-i',name,'psql','-X','-U','postgres','-d','postgres','-Atq',
  '-v','ON_ERROR_STOP=1'],{input:schema+'\n'+policies+'\n'+query});
 assert.deepEqual(result.split('\n'),tables.map(x=>x+':MATCH'),'PG17_SCOPED_RLS_POLICY_DRIFT');
});
