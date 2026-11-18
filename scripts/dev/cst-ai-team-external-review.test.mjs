import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canRunExternalReview, isExternalReviewStart, parseExternalObservation,
  checkExternalObservation, projectExternalObservations, EXTERNAL_TEAM_AGENTS,
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
  assert.match(frontend,/Review empat profil OpenClaw — observasi operator DEV/);
  assert.match(frontend,/\/api\/cst-ai-team\/external-reviews\?companyId=1/);
  assert.match(frontend,/TIDAK TERVERIFIKASI secara kriptografis/);
  assert.match(frontend,/Status operasional: BLOCKED/);
  assert.match(frontend,/Belum ada review operator yang tersimpan/);
  assert.match(frontend,/tidak memberi izin dispatch/);
});
