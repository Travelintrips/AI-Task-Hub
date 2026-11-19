/**
 * CST-DEV approval recording candidate, intentionally NOT exposed by any route.
 * One explicit human consent; three separately signed proofs are mandatory.
 * The restricted attestor store re-verifies and atomically records the proof.
 * No private key access, issuer lease, execution, dispatch or status transition.
 */
import {hasRecentVerifiedGpt02DevGoogleOperator} from './gpt02-google-auth-gate.mjs';
import {inspectPreparedSignedLink} from './gpt02-prepared-link.mjs';

const exact=(v,fields)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join(',')===[...fields].sort().join(',');
const refusal=reason=>Object.freeze({recorded:false,reason,authorizationGranted:false,
  issuerLeaseGranted:false,dispatchPermitted:false,commandCreated:false,releaseDecision:'NO_GO'});
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

/**
 * Dependencies are server-controlled only: no request may supply trusted facts,
 * trust keys, attestor, session secret, or signer configuration.
 */
export function createGpt02SingleOwnerApprovalRecorder({
  readTrustedFacts,loadTrustedKeys,attestorStore,env,clock=Date.now,
}={}){
  if(typeof readTrustedFacts!=='function'||typeof loadTrustedKeys!=='function'||
    typeof attestorStore?.recordLinkedApproval!=='function'||
    typeof clock!=='function')throw Error('SERVER_APPROVAL_DEPENDENCIES_REQUIRED');
  return async function recordOneConsent({session,consent,proof}={}){
    try{
      const now=clock();
      if(!Number.isSafeInteger(now)||!hasRecentVerifiedGpt02DevGoogleOperator(session,env,now))
        return refusal('FRESH_GOOGLE_SUPER_ADMIN_REQUIRED');
      if(!exact(consent,['kind','approved','companyId','taskId','commandId','attemptId','nonce','operatorSubject'])||
        consent.kind!=='GPT02_DEV_SINGLE_COMMAND_CONSENT_V1'||consent.approved!==true||
        consent.companyId!=='default'||!Number.isSafeInteger(consent.taskId)||
        consent.taskId<=136||!uuid.test(consent.commandId)||!uuid.test(consent.attemptId)||
        typeof consent.nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(consent.nonce)||
        consent.operatorSubject!==String(session.id))
        return refusal('EXPLICIT_EXACT_COMMAND_CONSENT_REQUIRED');
      if(!exact(proof,['approval','operatorLink'])||
        !exact(proof.approval,['claims','signatureBase64url'])||
        !exact(proof.operatorLink,['claims','hubSignatureBase64url','coreSignatureBase64url']))
        return refusal('SIGNED_ENVELOPE_REQUIRED');
      const a=proof.approval.claims;
      if(!exact(a,['v','environment','audience','taskId','commandId','attemptId',
        'nonce','operatorNamespace','superAdminId','companyId','issuedAt','expiresAt'])||
        a.taskId!==consent.taskId||a.commandId!==consent.commandId||
        a.attemptId!==consent.attemptId||a.nonce!==consent.nonce||
        a.companyId!==consent.companyId||a.superAdminId!==consent.operatorSubject)
        return refusal('APPROVAL_CONSENT_BINDING_MISMATCH');
      const facts=await readTrustedFacts(Object.freeze({
        companyId:consent.companyId,hubTaskId:consent.taskId,
        commandCandidateId:consent.commandId,attemptId:consent.attemptId,
      }));
      if(!exact(facts,['prepared','job','core','hubOperator']))
        return refusal('COMPLETE_SERVER_FACTS_REQUIRED');
      const store=loadTrustedKeys();
      if(!store||!exact(store.metadata,['environment','fingerprints'])||
        store.metadata.environment!=='DEV'||store.dispatchPermitted!==false)
        return refusal('TRUSTED_PUBLIC_ROOTS_REQUIRED');
      const publicKeys={
        approvalPublicKeyPem:store.approvalPublicKeyPem,
        hubPublicKeyPem:store.hubPublicKeyPem,
        corePublicKeyPem:store.corePublicKeyPem,
      };
      const verdict=inspectPreparedSignedLink({...facts,proof,publicKeys,now});
      if(verdict.matched!==true||verdict.signatureVerified!==true||
        verdict.dualOriginVerified!==true||verdict.dispatchPermitted!==false)
        return refusal('EXACT_SIGNED_PREPARATION_NOT_VERIFIED');
      // Double-check independent operator identity; never infer it from a JWT
      // role alone or accept request-supplied signed facts.
      if(facts.prepared.operatorSubject!==String(session.id)||
        facts.hubOperator.subject!==String(session.id)||
        verdict.identifiers.hubTaskId!==consent.taskId||
        verdict.identifiers.commandCandidateId!==consent.commandId||
        verdict.identifiers.attemptId!==consent.attemptId)
        return refusal('OPERATOR_BINDING_MISMATCH');
      // Attestor must separately authenticate a dedicated DB session, repeat
      // signature checks and fail closed on expiry/concurrency/database drift.
      const stored=await attestorStore.recordLinkedApproval(proof);
      if(stored?.approvalEvidenceRecorded!==true||
        stored.dualIdentityEvidenceRecorded!==true||
        stored.authorizationGranted!==false||stored.dispatchPermitted!==false)
        return refusal('INDEPENDENT_ATTESTOR_REJECTED');
      return Object.freeze({recorded:true,reason:'SIGNED_EVIDENCE_RECORDED_ONLY',
        authorizationGranted:false,issuerLeaseGranted:false,dispatchPermitted:false,
        commandCreated:false,releaseDecision:'NO_GO'});
    }catch{
      return refusal('TRUSTED_APPROVAL_RECORDING_UNAVAILABLE');
    }
  };
}
