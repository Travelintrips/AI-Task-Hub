'use strict';
/** Build-only, exact-baseline overlay: preserves the active PR156 lineage/auth/UI. No deploy. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('INPUT_AND_OUTPUT_REQUIRED');
const baseline=fs.readFileSync(input,'utf8');
const expected='dc4ccc9f018651b4894894f7f1f395232b8bb8e3d8bec6c70da864fd758656a3';
if(crypto.createHash('sha256').update(baseline).digest('hex')!==expected)throw Error('RUNTIME_BASELINE_CHANGED');
const source=fs.readFileSync(path.join(__dirname,'../../artifacts/api-server/src/lib/gpt02-pic-audit-actor.ts'),'utf8');
const helper=esbuild.transformSync(source,{loader:'ts',format:'iife',globalName:'gpt02PicAuditActorRuntime',target:'node24'}).code;
let s=baseline;
function once(text,old,next){if(text.split(old).length!==2)throw Error('PATCH_ANCHOR_NOT_UNIQUE:'+old.slice(0,60));return text.replace(old,next);}
function section(start,end,fn){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<=a)throw Error('SECTION_ABSENT');s=s.slice(0,a)+fn(s.slice(a,b))+s.slice(b);}
section('router75.get("/ai-tasks/:id/gpt02-pic-audit"','router75.post("/ai-tasks/:id/gpt02-assign-pic"',x=>{
 x=once(x,'actorName: auditLogsTable.userName,','actorName: auditLogsTable.userName,\n      actorEmail: auditLogsTable.userEmail,');
 x=once(x,'const auditMatchesCurrent = !!audit8 && audit8.actorId != null &&','const persistedActorId = gpt02PicAuditActorRuntime.readGpt02PicAuditActor(audit8);\n    const auditMatchesCurrent = !!audit8 && persistedActorId !== null &&');
 return once(x,'actorId: audit8?.actorId ?? null,','actorId: audit8?.actorId ?? persistedActorId,');
});
section('router75.post("/ai-tasks/:id/gpt02-assign-pic"','router75.post("/ai-tasks/:id/execution"',x=>{
 x=once(x,'const companyId2 = getCompanyIdForWrite(req);','const companyId2 = getCompanyIdForWrite(req);\n    const auditActor = gpt02PicAuditActorRuntime.createGpt02PicAuditActor(req.user);');
 x=once(x,'userId: req.user.id,','userId: auditActor.legacyUserId,');
 return once(x,'after: JSON.stringify({','after: JSON.stringify({\n          actorIdentity: auditActor.actorIdentity,');
});
section('router75.post("/ai-tasks/:id/execution"','router75.get("/executions/whatsapp-digest/preview"',x=>{
 x=once(x,'actorId: auditLogsTable.userId','actorId: auditLogsTable.userId,\n            actorEmail: auditLogsTable.userEmail');
 return once(x,'!latestAudit || latestAudit.actorId == null ||','!latestAudit || gpt02PicAuditActorRuntime.readGpt02PicAuditActor(latestAudit) === null ||');
});
// Do not use an old source map with a changed bundle.
s=s.replace(/^\/\/# sourceMappingURL=.*$/m,'// Source map omitted for exact-baseline PIC compatibility overlay.');
fs.writeFileSync(output,helper+'\n'+s);
console.log(JSON.stringify({baselineSha256:expected,patchedSections:3,outputSha256:crypto.createHash('sha256').update(helper+'\n'+s).digest('hex'),deploymentPerformed:false}));
