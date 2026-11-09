'use strict';
/**
 * DEV binary-only emergency security overlay for the CURRENT, EXACT deployed
 * GPT02-prepared-Hub/Core held image. Three passive-read guards only.
 * No environment, config, UI, admission, command or database change.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('INPUT_OUTPUT_REQUIRED');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const expected='55eab96b5369c829e5527e284585b0ec4f0cc0bfb241385ce761fdfc0d6a56ce';
const original=fs.readFileSync(path.join(input,'index.mjs'),'utf8');
if(hash(original)!==expected)throw Error('LIVE_DEV_IMAGE_BASELINE_CHANGED');
const source=fs.readFileSync(path.join(__dirname,'../../artifacts/api-server/src/routes/executions.ts'),'utf8');
for(const token of ['if (execution.status === "prepared") return execution;', 'current.status === "prepared"', 'execution.status !== "prepared"','GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER','GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED'])
 if(!source.includes(token))throw Error('TRUSTED_SOURCE_GUARD_MISSING:'+token);
function once(s,old,next,label){if(s.split(old).length!==2)throw Error('PATCH_ANCHOR_NOT_UNIQUE:'+label);return s.replace(old,()=>next)}
let bundle=original;
bundle=once(bundle,
  'async function syncExecution(execution) {\n  if (!aiCoreBridgeConfigured()',
  'async function syncExecution(execution) {\n  if (execution.status === "prepared") return execution;\n  if (!aiCoreBridgeConfigured()',
  'SYNC_ENTRY');
bundle=once(bundle,
  'if (!current || TERMINAL_EXECUTION_STATUSES.has(current.status)) {',
  'if (!current || TERMINAL_EXECUTION_STATUSES.has(current.status) || current.status === "prepared") {',
  'TRACKING_TIMER');
const routeBegin='router75.get("/ai-tasks/:id/execution", requireAuth';
const routeEnd='router75.get("/ai-tasks/:id/recovery-review", requireAuth';
const b=bundle.indexOf(routeBegin),e=bundle.indexOf(routeEnd,b);
if(b<0||e<=b||e-b>6500)throw Error('EXACT_GET_ROUTE_MISSING');
let route=bundle.slice(b,e);
route=once(route,'if (!TERMINAL_EXECUTION_STATUSES.has(execution.status)) {',
  'if (!TERMINAL_EXECUTION_STATUSES.has(execution.status) && execution.status !== "prepared") {',
  'GET_SCHEDULE');
bundle=bundle.slice(0,b)+route+bundle.slice(e);
if(bundle.includes('function syncExecution(execution) {\n  if (!aiCoreBridgeConfigured()'))throw Error('SYNC_PATCH_NOT_EFFECTIVE');
for(const needle of ['GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER',
  'execution.status !== "prepared"','current.status === "prepared"'])if(!bundle.includes(needle))throw Error('REQUIRED_FINAL_INVARIANT_MISSING');
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'index.mjs'),bundle);
const report={mode:'DEV_SECURITY_OVERLAY_ONLY',baselineSha256:expected,outputSha256:hash(bundle),
 originalBytes:Buffer.byteLength(original),updatedBytes:Buffer.byteLength(bundle),
 patches:['SYNC_ENTRY','TRACKING_TIMER','GET_SCHEDULE'],sameRuntimeImageRequired:true,
 changesSourceMapping:false,changesDatabase:false,changesProd:false,deployPerformed:false};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
