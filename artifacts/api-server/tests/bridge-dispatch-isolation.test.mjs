import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const folder=await mkdtemp(path.join(tmpdir(),'bridge-no-network-'));
try {
 await build({entryPoints:['src/lib/ai-core-execution-bridge.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(folder,'bridge.mjs'),plugins:[{name:'logger-no-io',setup(b){b.onResolve({filter:/^\.\/logger$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const logger={warn(){}}',loader:'js'}));}}],logLevel:'silent'});
 const bridge=await import(pathToFileURL(path.join(folder,'bridge.mjs')).href);
 test('same task identifier and correlation remain deterministic',()=>{
  assert.equal(bridge.buildAiTaskExternalCommandId('default',123),'ai-task:default:123');
  assert.equal(bridge.buildAiTaskExternalCommandId('default',123),bridge.buildAiTaskExternalCommandId('default',123));
 });
 test('dispatch timeout is fail-closed and never retries through a second route',async()=>{
  const prior=globalThis.fetch;const old={NODE_ENV:process.env.NODE_ENV,AI_CORE_DEV_BASE_URL:process.env.AI_CORE_DEV_BASE_URL,AI_TASK_BRIDGE_TOKEN:process.env.AI_TASK_BRIDGE_TOKEN};
  let calls=0;
  try {process.env.NODE_ENV='development';process.env.AI_CORE_DEV_BASE_URL='http://core-ai-dev:3000/api';process.env.AI_TASK_BRIDGE_TOKEN='x'.repeat(40);
   globalThis.fetch=async()=>{calls++;throw new DOMException('timeout','TimeoutError')};
   await assert.rejects(bridge.submitAiTaskChatGptCommand({accountAlias:'GPT02',instruction:'isolated',jobAlias:'TEST',correlationId:'one-fixed-correlation'}),/timeout/i);
   assert.equal(calls,1);
  } finally {globalThis.fetch=prior;for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
 });
 test('HTTP 429 is surfaced without fallback or hidden retry',async()=>{
  const prior=globalThis.fetch;const old={NODE_ENV:process.env.NODE_ENV,AI_CORE_DEV_BASE_URL:process.env.AI_CORE_DEV_BASE_URL,AI_TASK_BRIDGE_TOKEN:process.env.AI_TASK_BRIDGE_TOKEN};let calls=0;
  try {process.env.NODE_ENV='development';process.env.AI_CORE_DEV_BASE_URL='http://core-ai-dev:3000/api';process.env.AI_TASK_BRIDGE_TOKEN='x'.repeat(40);
   globalThis.fetch=async()=>{calls++;return new Response('rate limited',{status:429})};
   await assert.rejects(bridge.submitAiTaskChatGptCommand({accountAlias:'GPT02',instruction:'isolated',correlationId:'fixed'}),/AI_CORE_CHATGPT_COMMAND_HTTP_429/);
   assert.equal(calls,1);
  } finally {globalThis.fetch=prior;for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
 });
} finally {await rm(folder,{recursive:true,force:true});}
