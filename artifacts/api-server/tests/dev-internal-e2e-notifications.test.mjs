import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'internal-e2e-noio-'));
try {
  await build({entryPoints:['src/lib/notifications.ts'], bundle:true, platform:'node',format:'esm',outfile:path.join(dir,'module.mjs'),plugins:[{name:'block-io',setup(b){
    b.onResolve({filter:/^@workspace\/db$|^\.\/fonnte$|^\.\/logger$/},a=>({path:a.path,namespace:'noio'}));
    b.onLoad({filter:/.*/,namespace:'noio'},a=>({contents:a.path==='@workspace/db' ? 'export const db={}; export const whatsappNotificationsTable={};' : a.path==='./fonnte' ? 'export async function sendFonnte(){throw Error("Unexpected send");}' : 'export const logger={error(){},warn(){}};',loader:'js'}));
  }}],logLevel:'silent'});
  const m=await import(pathToFileURL(path.join(dir,'module.mjs')).href);
  test('DEV internal test suppresses all four task notification paths before touching I/O',async()=>{
    const old={NODE_ENV:process.env.NODE_ENV,APP_ENV:process.env.APP_ENV,AI_TASK_DEV_SILENT_E2E_ENABLED:process.env.AI_TASK_DEV_SILENT_E2E_ENABLED};
    try {
      process.env.NODE_ENV='development';delete process.env.APP_ENV;process.env.AI_TASK_DEV_SILENT_E2E_ENABLED='true';
      const ctx={taskId:1,taskNumber:'TEST-1',title:'[INTERNAL-E2E] isolated',customerPhone:'628111111111',assignedTo:'Someone',status:'completed',priority:'low',companyId:'test'};
      await m.notifyTaskCreated(ctx);await m.notifyTaskCompleted(ctx);await m.notifyStatusChanged(ctx,'new_inquiry');await m.notifyTaskAssigned(ctx,'628122222222');
      assert.ok(true);
    } finally {for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
  });
}finally{await rm(dir,{recursive:true,force:true});}
