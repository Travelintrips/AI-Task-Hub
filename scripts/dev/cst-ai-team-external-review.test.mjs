import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canRunExternalReview, isExternalReviewStart, parseExternalObservation,
  checkExternalObservation, projectExternalObservations, validatePriorReviewEvidence,
  projectExternalReviewStatus,
  parseExternalReviewFailure, EXTERNAL_REVIEW_STALE_AFTER_MS, EXTERNAL_TEAM_AGENTS,
  EXTERNAL_QA_LOCAL_FALLBACK, externalObservationWorkerId,
  EXTERNAL_REVIEW_PROOF, EXTERNAL_REVIEW_SOURCE,
} from '../../artifacts/api-server/src/lib/cst-ai-team-external-review.ts';

const challenge = 'e1d00000-1111-4111-8111-111111111111';
const body = (role='coding') => ({
  role, host: EXTERNAL_TEAM_AGENTS[role].host, agentId: EXTERNAL_TEAM_AGENTS[role].agentId,
  challenge, result:'BLOCKED', summaryCode:'NO_PERSISTED_HANDOFF',
  responseSha256:'a'.repeat(64), sessionSha256:'b'.repeat(64),
});
const event = role => ({ eventType:'team.external.observed', phase:role,
  status:'observed', workerId:`openclaw:${EXTERNAL_TEAM_AGENTS[role].host}:${EXTERNAL_TEAM_AGENTS[role].agentId}`,
  signatureVerified:false, payload:{ operatorCollected:true, proofLevel:EXTERNAL_REVIEW_PROOF,
    challenge, result:'BLOCKED', summaryCode:'NO_PERSISTED_HANDOFF',
    responseSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64) },
});
const route = readFileSync(new URL('../../artifacts/api-server/src/routes/cst-ai-team.ts', import.meta.url),'utf8');

test('operator observations disabled outside explicit DEV double flag',()=>{
  const enabled = { NODE_ENV:'development',APP_ENV:'development',
    CST_AI_TEAM_DEV_ENABLED:'true',CST_AI_TEAM_EXTERNAL_EVIDENCE_ENABLED:'true' };
  assert.equal(canRunExternalReview(enabled),true);
  for(const k of ['APP_ENV','NODE_ENV']) assert.equal(canRunExternalReview({...enabled,[k]:'production'}),false);
  for(const k of ['CST_AI_TEAM_DEV_ENABLED','CST_AI_TEAM_EXTERNAL_EVIDENCE_ENABLED'])
    assert.equal(canRunExternalReview({...enabled,[k]:'false'}),false);
});
test('one fixed scenario, with no user-controlled dispatch command',()=>{
  assert.equal(isExternalReviewStart({scenario:'operator_collected_read_only_review'}),true);
  assert.equal(isExternalReviewStart({scenario:'dev_read_only_canary'}),false);
  assert.equal(isExternalReviewStart({scenario:'operator_collected_read_only_review',instruction:'run shell'}),false);
  assert.equal(isExternalReviewStart(null),false);
  assert.equal(isExternalReviewStart([]),false);
});
test('DELL-only approved profile mapping rejects the older Travelintrips coding identity',()=>{
  assert.deepEqual(EXTERNAL_TEAM_AGENTS.coding,{host:'DELL',agentId:'gpt02-dev'});
  assert.deepEqual(Object.values(EXTERNAL_TEAM_AGENTS).map(x=>x.host),
    ['DELL','DELL','DELL','DELL']);
  assert.equal(externalObservationWorkerId(body('coding')),'openclaw:DELL:gpt02-dev');
  assert.equal(parseExternalObservation({...body('coding'),host:'Travelintrips',agentId:'main'}),null);
});
test('only four pinned host / profile tuples accepted; no arbitrary credentials or transcripts',()=>{
  for(const role of Object.keys(EXTERNAL_TEAM_AGENTS)) {
    assert.deepEqual(parseExternalObservation(body(role)),body(role));
    assert.equal(checkExternalObservation(body(role),challenge),true);
    assert.equal(checkExternalObservation(body(role),'d3d00000-1111-4111-8111-111111111111'),false);
    assert.equal(parseExternalObservation({...body(role),agentId:'another'}),null);
    assert.equal(parseExternalObservation({...body(role),host:'PROD'}),null);
    assert.equal(parseExternalObservation({...body(role),rawTranscript:'leak'}),null);
    assert.equal(parseExternalObservation({...body(role),apiKey:'secret'}),null);
    assert.equal(parseExternalObservation({...body(role),responseSha256:'wrong'}),null);
  }
});
test('four untrusted observations are only internally consistent, never verified authority',()=>{
  const records=['coding','infrastructure','security','qa'].map(event);
  const pass=projectExternalObservations(records,challenge);
  assert.equal(pass.internallyConsistent,true);
  assert.equal(pass.qaReviewRecorded,true);
  assert.equal(pass.operationalVerified,false);
  assert.equal(pass.independentFinalAckVerified,false);
  assert.equal(pass.evidenceType,EXTERNAL_REVIEW_PROOF);
  assert.equal(projectExternalObservations([...records,records[0]],challenge).internallyConsistent,false);
  assert.equal(projectExternalObservations(records.slice(0,3),challenge).internallyConsistent,false);
  assert.equal(projectExternalObservations([...records.slice(0,3),{...records[3],signatureVerified:true}],challenge).internallyConsistent,false);
  assert.equal(projectExternalObservations([...records.slice(0,3),{...records[3],workerId:'openclaw:DELL:wrong'}],challenge).internallyConsistent,false);
  assert.equal(projectExternalObservations([...records.slice(0,3),{...records[3],payload:{...records[3].payload,proofLevel:'GPT02_SIGNED'}}],challenge).internallyConsistent,false);
  assert.equal(projectExternalObservations(records,'d3d00000-1111-4111-8111-111111111111').internallyConsistent,false);
});
test('routes are scoped, require auth, fixed sources, single role event id and always fail closed to GPT02',()=>{
  assert.match(route, /router\.post\("\/cst-ai-team\/external-reviews", requireAuth/);
  assert.match(route, /router\.post\("\/cst-ai-team\/external-reviews\/:id\/observations",requireAuth/);
  assert.match(route, /router\.get\("\/cst-ai-team\/external-reviews", requireAuth/);
  assert.match(route, /canRunExternalReview\(\)/);
  assert.match(route, /eq\(jobs\.companyId,company\)/);
  assert.match(route, /EXTERNAL_REVIEW_SOURCE/);
  assert.match(route, /onConflictDoNothing\(\{target:events\.eventId\}\)/);
  assert.match(route, /QA_REQUIRES_THREE_PRIOR_OBSERVATIONS/);
  assert.match(route, /signatureVerified:false/);
  assert.match(route, /operationalVerified:false,independentFinalAckVerified:false/);
  assert.doesNotMatch(route.slice(route.indexOf('router.get("/cst-ai-team/external-reviews"'),route.indexOf('router.post("/cst-ai-team/external-reviews"')),
    /submitAiTaskCommand|signToken\(|dispatchExternalAgentWork|AI_CORE_DEV_BASE_URL/);
  assert.equal(EXTERNAL_REVIEW_SOURCE,'cst-ai-team-dev-external-review');
});

const frontend=readFileSync(new URL('../../artifacts/ai-task-center/src/pages/cst-ai-team-monitor.tsx',import.meta.url),'utf8');
test('dashboard separates operator text observations from live worker and signed Final ACK proof',()=>{
  assert.match(frontend,/Review empat peran — observasi operator DEV/);
  assert.match(frontend,/Observasi OpenClaw dan Ollama lokal diberi label asal berbeda/);
  assert.match(frontend,/\/api\/cst-ai-team\/external-reviews\?companyId=1/);
  assert.match(frontend,/TIDAK TERVERIFIKASI secara kriptografis/);
  assert.match(frontend,/Status operasional: BLOCKED/);
  assert.match(frontend,/Belum ada review operator yang tersimpan/);
  assert.match(frontend,/tidak memberi izin dispatch/);
});

test('unfinished operator review becomes BLOCKED after bounded TTL without inventing QA',()=>{
  const now=Date.parse('2026-11-18T17:00:00Z');
  const created=new Date(now-EXTERNAL_REVIEW_STALE_AFTER_MS);
  assert.deepEqual(projectExternalReviewStatus('processing',created,now),
    {status:'processing',expired:false,failureReason:null});
  const overdue=projectExternalReviewStatus('processing',created,now+1);
  assert.equal(overdue.status,'blocked');
  assert.equal(overdue.expired,true);
  assert.equal(overdue.failureReason,'OPERATOR_REVIEW_TIMEOUT');
  assert.equal(projectExternalReviewStatus('processing',null,now).status,'blocked');
  assert.equal(projectExternalReviewStatus('blocked',created,now).expired,false);
  assert.equal(projectExternalReviewStatus('completed',created,now).status,'completed');
});
test('failure code is allowlisted; no free-form text, credentials or PII in review abort',()=>{
  for(const reason of ['QA_PROVIDER_LIMIT','QA_PROVIDER_AUTH_UNAVAILABLE','REVIEW_INTERRUPTED']){
    assert.equal(parseExternalReviewFailure({reason}),reason);
  }
  assert.equal(parseExternalReviewFailure({reason:'PROD_RESTART'}),null);
  assert.equal(parseExternalReviewFailure({reason:'QA_PROVIDER_LIMIT',accessToken:'private'}),null);
  assert.equal(parseExternalReviewFailure({reason:12}),null);
  assert.equal(parseExternalReviewFailure({}),null);
  assert.equal(parseExternalReviewFailure(null),null);
});
test('only super admin Company1 may close an incomplete review, preserving unsigned status',()=>{
  assert.match(route,/router\.post\("\/cst-ai-team\/external-reviews\/:id\/close",requireAuth/);
  assert.match(route,/const company=allow\(req,res,true\)/);
  assert.match(route,/eq\(jobs\.companyId,company\)/);
  assert.match(route,/eq\(jobs\.source,EXTERNAL_REVIEW_SOURCE\)/);
  assert.match(route,/eq\(jobs\.status,"processing"\)/);
  assert.match(route,/parseExternalReviewFailure\(req\.body\)/);
  assert.match(route,/REVIEW_TERMINAL_OR_EXPIRED/);
  assert.match(route,/projectExternalReviewStatus\(run\.status,run\.createdAt\)\.expired/);
  assert.match(route,/operationalVerified:false/);
});
const ui=readFileSync(new URL('../../artifacts/ai-task-center/src/pages/cst-ai-team-monitor.tsx',import.meta.url),'utf8');
test('dashboard displays missing QA and timeout or failure reason rather than perpetual processing',()=>{
  assert.match(ui,/Status review:/);
  assert.match(ui,/review\.failureReason/);
  assert.match(ui,/review\.expired/);
  assert.match(ui,/Status operasional: BLOCKED/);
});

test('only QA may use the distinct DELL native Ollama diagnostic identity',()=>{
  const local={...body('qa'),...EXTERNAL_QA_LOCAL_FALLBACK};
  assert.deepEqual(parseExternalObservation(local),local);
  assert.equal(checkExternalObservation(local,challenge),true);
  assert.equal(externalObservationWorkerId(local),'ollama-local:DELL:ollama-local-qa');
  const original=body('qa');
  assert.equal(externalObservationWorkerId(original),'openclaw:DELL:dell-browser');
  for(const role of ['coding','infrastructure','security']) {
    assert.equal(parseExternalObservation({...body(role),...EXTERNAL_QA_LOCAL_FALLBACK}),null);
  }
  assert.equal(parseExternalObservation({...local,host:'Travelintrips'}),null);
  assert.equal(parseExternalObservation({...local,agentId:'other-agent'}),null);
  assert.deepEqual(parseExternalObservation({...local,agentId:'dell-browser'}),body('qa'));
});
test('local model QA receipt is separately labeled and never becomes signed Final ACK',()=>{
  const old=event('qa');
  const local={...old,workerId:'ollama-local:DELL:ollama-local-qa'};
  const records=['coding','infrastructure','security'].map(event);
  const valid=projectExternalObservations([...records,local],challenge);
  assert.equal(valid.internallyConsistent,true);
  assert.equal(valid.qaReviewRecorded,true);
  assert.equal(valid.operationalVerified,false);
  assert.equal(valid.independentFinalAckVerified,false);
  assert.equal(projectExternalObservations([...records,{...local,workerId:'openclaw:DELL:ollama-local-qa'}],challenge).internallyConsistent,false);
  assert.equal(projectExternalObservations([...records,{...local,workerId:'ollama-local:DELL:dell-browser'}],challenge).internallyConsistent,false);
  assert.equal(projectExternalObservations([...records,local,old],challenge).internallyConsistent,false);
  assert.match(route,/externalObservationWorkerId\(observation\)/);
  assert.match(route,/sourceKind: \(e\.workerId/);
  assert.match(frontend,/item\.sourceKind/);
});


test('QA prerequisite requires exactly three authentic-format, unsigned, distinct prior-role records',()=>{
  const p=['coding','infrastructure','security'].map(event);
  assert.equal(validatePriorReviewEvidence(p,challenge),true);
  assert.equal(validatePriorReviewEvidence(p.slice(0,2),challenge),false);
  assert.equal(validatePriorReviewEvidence([...p,p[0]],challenge),false);
  assert.equal(validatePriorReviewEvidence([...p.slice(0,2),p[0]],challenge),false);
  assert.equal(validatePriorReviewEvidence([...p,event('qa')],challenge),false);
  assert.equal(validatePriorReviewEvidence(p,'d3d00000-1111-4111-8111-111111111111'),false);
  assert.equal(validatePriorReviewEvidence(p.map((r,i)=>i===0?{...r,signatureVerified:true}:r),challenge),false);
  assert.equal(validatePriorReviewEvidence(p.map((r,i)=>i===1?{...r,workerId:'openclaw:DELL:forged'}:r),challenge),false);
  assert.equal(validatePriorReviewEvidence(p.map((r,i)=>i===2?{...r,payload:{...r.payload,proofLevel:'GPT02_SIGNED'}}:r),challenge),false);
  assert.equal(validatePriorReviewEvidence(p.map((r,i)=>i===2?{...r,payload:{...r.payload,responseSha256:'bad'}}:r),challenge),false);
  assert.equal(validatePriorReviewEvidence(p.map((r,i)=>i===0?{...r,status:'failed'}:r),challenge),false);
  assert.equal(validatePriorReviewEvidence(p.map((r,i)=>i===0?{...r,eventType:'team.external.failed'}:r),challenge),false);
  assert.equal(validatePriorReviewEvidence(p.map((r,i)=>i===0?{...r,payload:null}:r),challenge),false);
  assert.match(route,/validatePriorReviewEvidence\(existing,challenge\)/);
  assert.match(route,/QA_REQUIRES_THREE_PRIOR_OBSERVATIONS/);
});
