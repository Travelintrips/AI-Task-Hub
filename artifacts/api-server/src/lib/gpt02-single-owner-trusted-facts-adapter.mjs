/**
 * DEV-only, UNMOUNTED adapter for PR196 createGpt02PreSignFactReader.
 *
 * Converts its independently authenticated TLS, READ ONLY Hub/Core proof to
 * the four-field shape expected by the existing signed approval recorder.
 * Does not trust HTTP-supplied facts, sign, write, issue or dispatch.
 */
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const FIELDS=['prepared','job','core','hubOperator','hubAssignment','observedAt','trustedReadProof'];
const TRUST_FIELDS=['source','environment','hubRole','coreRole','separateBackends',
 'clientTlsVerified','readOnly','signingPermitted','authorizationGranted',
 'dispatchPermitted','releaseDecision'];
const REQUEST_FIELDS=['companyId','hubTaskId','commandCandidateId','attemptId'];
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const deny=code=>{const e=new Error(code);e.code=code;throw e};
const saneObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function createGpt02SingleOwnerTrustedFactAdapter({
 readPreSignFacts,env,clock=Date.now,maxAgeMs=2000
}={}){
 if(typeof readPreSignFacts!=='function'||typeof clock!=='function'||
    !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>2000)
  deny('TRUSTED_FACT_ADAPTER_DEPENDENCIES_REQUIRED');
 return async function readTrustedFacts(identity){
  // Deliberately refuse historical preparations, including immutable Task171.
  if(env?.NODE_ENV!=='development'||env?.APP_ENV!=='development'||
     !exact(identity,REQUEST_FIELDS)||identity.companyId!=='default'||
     !Number.isSafeInteger(identity.hubTaskId)||identity.hubTaskId<=171||
     !UUID.test(identity.commandCandidateId)||!UUID.test(identity.attemptId)||
     identity.commandCandidateId===identity.attemptId)
   deny('FRESH_DEV_TASK_BINDING_REQUIRED');
  const proof=await readPreSignFacts(Object.freeze({...identity}));
  if(!exact(proof,FIELDS)||!exact(proof.trustedReadProof,TRUST_FIELDS)||
     proof.trustedReadProof.source!=='gpt02-issue159-presign-reader'||
     proof.trustedReadProof.environment!=='DEV'||
     proof.trustedReadProof.hubRole!=='gpt02_hub_evidence_reader'||
     proof.trustedReadProof.coreRole!=='gpt02_core_evidence_reader'||
     !['separateBackends','clientTlsVerified','readOnly'].every(k=>proof.trustedReadProof[k]===true)||
     !['signingPermitted','authorizationGranted','dispatchPermitted'].every(k=>proof.trustedReadProof[k]===false)||
     proof.trustedReadProof.releaseDecision!=='NO_GO')
   deny('INDEPENDENT_READONLY_PROOF_REQUIRED');
  const now=clock();
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(proof.observedAt)||
     proof.observedAt>now||now-proof.observedAt>maxAgeMs)
   deny('TRUSTED_READ_EXPIRED');
  const {prepared:p,job:j,core:c,hubOperator:u,hubAssignment:a}=proof;
  if(![p,j,c,u,a].every(saneObject)||
     p.companyId!==identity.companyId||p.hubTaskId!==identity.hubTaskId||
     p.commandCandidateId!==identity.commandCandidateId||
     p.attemptId!==identity.attemptId||p.expiresAt<=now||
     j.companyId!==p.companyId||j.taskId!==p.hubTaskId||
     j.executionId!==p.hubExecutionId||j.status!=='prepared'||
     j.commandId!==null||j.workerCommandCount!==0||j.dispatchStarted!==false||
     c.taskId!==p.coreTaskId||c.commandCandidateId!==p.commandCandidateId||
     c.attemptId!==p.attemptId||c.status!=='PENDING'||
     c.commandCount!==0||c.runCount!==0||
     c.workerId!=='openclaw-dell-chatgpt-wake-dev'||
     u.subject!==p.operatorSubject||u.role!=='super_admin'||u.active!==true||
     a.actorId!==p.operatorSubject||a.actorRole!=='super_admin'||a.actorActive!==true||
     a.action!=='gpt02_pic_assigned'||a.entityId!==String(p.hubTaskId))
   deny('CANONICAL_HUB_CORE_FACTS_NOT_MATCHED');
  // Preserve exact no-extra-field contract used by the signed-link verifier.
  // Every source is supplied by the separately authenticated PR196 reader.
  return Object.freeze({
   prepared:Object.freeze({...p}),job:Object.freeze({...j}),
   core:Object.freeze({...c}),hubOperator:Object.freeze({...u})
  });
 };
}
