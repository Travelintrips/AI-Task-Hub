import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Gpt02CoreTaskPreparer} from '/tmp/gpt02-core-task-preparation.mjs';
if(process.env.GPT02_CORE_FIXTURE_ONLY!=='1')throw Error('FIXTURE_FLAG_REQUIRED');
const require=createRequire('/app/artifacts/api-server/package.json');
const {Pool}=require('pg');
const pool=new Pool({host:'/var/run/postgresql',database:'gpt02_core_preparation_isolated',user:'gpt02_core_prep_login',max:2,connectionTimeoutMillis:4000});
const input={companyId:'default',hubTaskId:137,projectName:'GPT02 DEV coding lifecycle',repository:'Travelintrips/Core-AI-Foundation',branch:'develop',instruction:'PREPARE ONLY, never issue a command.'};
try{
 const diagnosticPool={async connect(){let c;try{c=await pool.connect()}catch(e){console.log('ISOLATED_CONNECT_ERROR',e.code||e.name);throw e}
 return {async query(sql,params){try{return await c.query(sql,params)}catch(e){console.log('ISOLATED_QUERY_ERROR',e.code||e.name,typeof sql==='string'?sql.slice(0,65):'query');throw e}},release:discard=>c.release(discard)};}};
 const preparer=new Gpt02CoreTaskPreparer({pool:diagnosticPool});
 const r=await preparer.prepare(input);
 assert.equal(r.preparedNew,false);assert.equal(r.hubExecutionStatus,'prepared');assert.equal(r.commandIssued,false);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.lifecycleStartPermitted,false);
 assert.equal(r.operatorApprovalRecorded,false);
 for(const key of ['coreTaskId','commandCandidateId','attemptId','hubExecutionId'])assert.match(r[key],/^[0-9a-f-]{36}$/);
 await assert.rejects(preparer.prepare({...input,instruction:'modified after preparation'}),e=>e.code==='CORE_PREPARATION_TRANSACTION_FAILED');
 await assert.rejects(preparer.prepare({...input,hubTaskId:136}),e=>e.code==='OUT_OF_SCOPE_PREPARATION');
 console.log('GPT02_CORE_PREPARATION_REAL_MODULE_ISOLATED_PASS: replay stable, no dispatch, no legacy task');
}finally{await pool.end();}
