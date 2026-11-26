import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Gpt02CoreTaskPreparer} from '/tmp/gpt02-core-task-preparation.mjs';
if(process.env.GPT02_CORE_FIXTURE_ONLY!=='1')throw Error('FIXTURE_FLAG_REQUIRED');
const require=createRequire('/app/artifacts/api-server/package.json');
const {Pool}=require('pg');
const pool=new Pool({
 host:'127.0.0.1',database:'gpt02_core_preparation_isolated',user:'gpt02_core_prep_login',
 password:'fixture-preparer-only',max:1,connectionTimeoutMillis:4000,
 ssl:{servername:'preparer-fixture',ca:readFileSync('/tmp/preparer-fixture.crt','utf8'),rejectUnauthorized:true}
});
const input={companyId:'default',hubTaskId:137,projectName:'GPT02 DEV coding lifecycle',repository:'Travelintrips/Core-AI-Foundation',branch:'develop',instruction:'PREPARE ONLY, never issue a command.'};
async function checkPreparation(){
 const preparer=new Gpt02CoreTaskPreparer({pool});
 const fresh=new Gpt02CoreTaskPreparer({pool,taskId:189});
 const replacement={...input,hubTaskId:189};
 if(process.argv[2]==='--overlong-login'){
  await assert.rejects(fresh.verifyReadiness(),e=>e.code==='DEV_PREPARER_AUTHENTICATED_ROLE_NOT_SCOPED');
  await assert.rejects(fresh.prepare(replacement),e=>e.code==='DEV_PREPARER_SHORT_LIVED_LOGIN_REQUIRED');
  console.log('PASS:OVERLONG_LOGIN_DENIED_BY_READINESS_AND_PREPARATION');
  return;
 }
 assert.equal((await preparer.verifyReadiness()).verified,true);
 await assert.rejects(fresh.prepare(input),e=>e.code==='GPT02_PREPARER_TASK_SCOPE_MISMATCH');
 const created=await fresh.prepare(replacement);
 assert.equal(created.preparedNew,true);
 assert.equal(created.commandIssued,false);
 assert.equal(created.dispatchPermitted,false);
 const replay=await fresh.prepare(replacement);
 assert.deepEqual(replay,{...created,preparedNew:false});
 console.log('SCOPED_FRESH_PREPARATION_PASS: one isolated reservation, retry preserved all IDs');
 const r=await preparer.prepare(input);
 assert.equal(r.preparedNew,false);assert.equal(r.hubExecutionStatus,'prepared');assert.equal(r.commandIssued,false);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.lifecycleStartPermitted,false);
 assert.equal(r.operatorApprovalRecorded,false);
 for(const key of ['coreTaskId','commandCandidateId','attemptId','hubExecutionId'])assert.match(r[key],/^[0-9a-f-]{36}$/);
 await assert.rejects(preparer.prepare({...input,instruction:'modified after preparation'}),e=>e.code==='CORE_PREPARATION_TRANSACTION_FAILED');
 await assert.rejects(preparer.prepare({...input,hubTaskId:136}),e=>e.code==='OUT_OF_SCOPE_PREPARATION');
 console.log('GPT02_CORE_PREPARATION_REAL_MODULE_ISOLATED_PASS: replay stable, no dispatch, no legacy task');
}
try{await checkPreparation();}finally{await pool.end();}
