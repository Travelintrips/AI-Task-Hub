'use strict';
// Exact-baseline build artifact only. No environment, credentials, DB access or deployment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {transformSync}=require('esbuild');
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('INPUT_OUTPUT_REQUIRED');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function load(name,expected){const s=fs.readFileSync(path.join(input,name),'utf8');if(hash(s)!==expected)throw Error('BASELINE_CHANGED:'+name);return s;}
let api=load('api.mjs','18b1f48f8fe2b8965d0f4c737d04fdfc45c261b2e0f8e53a58a067b9c5a40ec4');
let ui=load('ui.js','577e1e7bf00534be9ffd45f56705544b2aeffe1054aba0f8ca80e05a335d3dbb');
let html=load('index.html','17634ad0e57c4061c409515244f992a1fbe19609ef9313c2c4a4a5dc8db642b1');
function once(text,a,b){if(text.split(a).length!==2)throw Error('ANCHOR_NOT_UNIQUE:'+a.slice(0,70));return text.replace(a,()=>b);}
const root=path.resolve(__dirname,'../..');
const helper=transformSync(fs.readFileSync(path.join(root,'artifacts/api-server/src/lib/gpt02-execution-outcome.ts'),'utf8'),{loader:'ts',format:'iife',globalName:'gpt02OutcomeReadbackRuntime',target:'node24'}).code;
const source=fs.readFileSync(path.join(root,'artifacts/api-server/src/routes/executions.ts'),'utf8');
const sr=source.indexOf('router.get("/ai-tasks/:id/gpt02-lineage"'),qa=source.indexOf('SELECT t.id AS task_id',sr),qb=source.indexOf('    `);',qa);
if(sr<0||qa<sr||qb<qa)throw Error('SOURCE_QUERY_MISSING');
const query=source.slice(qa,qb).replaceAll('${companyId}','${companyId2}');
const start=api.indexOf('router75.get("/ai-tasks/:id/gpt02-lineage"'),end=api.indexOf('var executions_default = router75;',start);
if(start<0||end<start)throw Error('RUNTIME_SECTION_MISSING');
let route=api.slice(start,end),a=route.indexOf('SELECT t.id AS task_id'),b=route.indexOf('    `);',a);if(a<0||b<a)throw Error('RUNTIME_QUERY_MISSING');
route=route.slice(0,a)+query+route.slice(b);
route=once(route,'res.json(evaluateGpt02LineageEvidence(result.rows[0]));','res.json({ ...evaluateGpt02LineageEvidence(result.rows[0]), executionOutcome: gpt02OutcomeReadbackRuntime.evaluateGpt02ExecutionOutcome(result.rows[0]) });');
api=helper+'\n'+api.slice(0,start)+route+api.slice(end);
api=api.replace(/^\/\/# sourceMappingURL=.*$/m,'// Source map omitted for exact read-only diagnostic overlay.');
const anchor='e.jsxs("p",{className:"font-medium text-amber-800",children:["NO-GO: ",Te.diagnosticReasons.length';
const addition='e.jsx("p",{className:"font-medium",children:Te.executionOutcome?.verified===true?"Hasil eksekusi: Selesai — respons native dan ACK akhir cocok dengan command ini.":"Hasil eksekusi: Bukti lengkap hasil eksekusi belum terverifikasi."}),Te.executionOutcome?.route==="direct_chatgpt_command"&&!Te.coreTaskIdPresent&&e.jsx("p",{children:"Jalur uji ini membuat command ChatGPT langsung, bukan Core coding task. Pencatatan lifecycle tetap belum lengkap."}),';
ui=once(ui,anchor,addition+anchor.replace('"NO-GO: "','"Pencatatan lifecycle — NO-GO: "'));
ui=once(ui,'Hasil ini bukan persetujuan operator, izin resume, atau bukti final native.','Hasil eksekusi dan kelengkapan lifecycle dinilai terpisah. Pemeriksaan ini bukan persetujuan operator, izin resume, atau penutupan bisnis; tidak memberi izin menjalankan ulang.');
const newAsset='index-lineage-'+hash(ui).slice(0,12)+'.js';
html=once(html,'/assets/index-BrYfcuva.js','/assets/'+newAsset);
fs.mkdirSync(path.join(output,'public/assets'),{recursive:true});
fs.writeFileSync(path.join(output,'index.mjs'),api);fs.writeFileSync(path.join(output,'public/assets',newAsset),ui);fs.writeFileSync(path.join(output,'public/index.html'),html);
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({apiSha256:hash(api),uiSha256:hash(ui),asset:newAsset,scope:'GET_DIAGNOSTIC_AND_LABELS_ONLY',sourceGateUntouched:true,dispatchChanged:false},null,2));
console.log(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
