'use strict';
/** Exact runtime-hash overlay to block only unproven DEV GPT02 lifecycle starts.
 * No Core command is sent; the build does not deploy or access business DB. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('INPUT_OUTPUT_REQUIRED');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const expected={
 'index.mjs':'0333104b3322644f1f23c7c2e4843c063aa079583c48ae7798d966504dd02d82',
 'ui.js':'4005e23afa5efa97c176235a789ca57e9e8ce62e9665a7d01bf6206b85c9c5ef',
 'index.html':'57e168e1618dbf4c7a97120a379ab9e05d9a464f7879acb8735f7dc909513196',
};
function read(name){const s=fs.readFileSync(path.join(input,name),'utf8');if(hash(s)!==expected[name])throw Error('RUNTIME_BASELINE_CHANGED:'+name);return s;}
let api=read('index.mjs'),ui=read('ui.js'),html=read('index.html');
function once(s,old,next){if(s.split(old).length!==2)throw Error('PATCH_ANCHOR_NOT_UNIQUE:'+old.slice(0,60));return s.replace(old,()=>next);}
const source=fs.readFileSync(path.join(__dirname,'../../artifacts/api-server/src/routes/executions.ts'),'utf8');
const begin=source.indexOf('    // DEV GPT02 full lifecycle is a different contract');
const end=source.indexOf('    let mode: "chatgpt" | "worker"',begin);
if(begin<0||end<=begin)throw Error('SOURCE_GATE_MISSING');
let guard=source.slice(begin,end).replace(/\n/g,'\n');
// This block is valid JavaScript after TypeScript is stripped. No compiler modifications.
if(!guard.includes('GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED')||!guard.includes('dispatchNotStarted: true'))throw Error('SOURCE_GATE_INVALID');
const apiAnchor='    let mode = body.mode === "chatgpt" ? "chatgpt" : "worker";';
const sectionStart=api.indexOf('router75.post("/ai-tasks/:id/execution"');
const sectionEnd=api.indexOf('var executions_default = router75;',sectionStart);
if(sectionStart<0||sectionEnd<=sectionStart)throw Error('RUNTIME_EXECUTION_SECTION_MISSING');
let route=api.slice(sectionStart,sectionEnd);route=once(route,apiAnchor,guard+apiAnchor);
api=api.slice(0,sectionStart)+route+api.slice(sectionEnd);
api=api.replace(/^\/\/# sourceMappingURL=.*$/m,'// Map omitted after exact lifecycle guard overlay.');
const buttonStart='e.jsxs($,{size:"sm",disabled:!B?.bridgeConfigured';
const bs=ui.indexOf(buttonStart);
const be=ui.indexOf(',children:[rt.isPending?',bs);
if(bs<0||be<=bs||be-bs>900||ui.indexOf('Mulai Lifecycle GPT02',bs)>be+400)throw Error('RUNTIME_BUTTON_NOT_EXACT');
ui=ui.slice(0,bs)+'e.jsxs($,{size:"sm",disabled:!0,"aria-label":"Lifecycle GPT02 DEV belum aktif karena bukti sebelum pengiriman belum lengkap"'+ui.slice(be);
ui=once(ui,'"Mulai Lifecycle GPT02"','"Mulai Lifecycle GPT02 (belum diaktifkan)"');
const grid='e.jsxs("div",{className:"mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3"';
const warning='!B?.execution&&e.jsx("p",{role:"status",className:"mt-2 text-xs text-amber-700",children:"Mode lifecycle GPT02 DEV belum dapat dijalankan: Core Task, persetujuan bertanda tangan, pengikatan percobaan, nonce dan pengaman lease harus terbukti sebelum pengiriman. Hasil uji teks lama tidak diulang."}),';
ui=once(ui,grid,warning+grid);
const asset='index-lifecycle-held-'+hash(ui).slice(0,12)+'.js';
html=once(html,'/assets/index-lineage-4005e23afa5e.js','/assets/'+asset);
fs.mkdirSync(path.join(output,'public/assets'),{recursive:true});
fs.writeFileSync(path.join(output,'index.mjs'),api);
fs.writeFileSync(path.join(output,'public/assets',asset),ui);
fs.writeFileSync(path.join(output,'public/index.html'),html);
const m={imageBase:'ai-task-hub:dev-lineage-outcome-candidate-20261109',sourceGate:'GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED',apiSha256:hash(api),uiSha256:hash(ui),asset,dispatchPathOutsideGuardUnchanged:true,prevExecutionEvidenceUntouched:true,deployPerformed:false};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(m,null,2));
console.log(JSON.stringify(m));
