/**
 * GPT02 Issue159 persisted intent evidence gate, DEV ONLY and UNMOUNTED.
 * The only trusted source is the EXISTING independent Issue159 approval-intent
 * reader service. This module DOES NOT create an approval intent, access a
 * browser/provider token, load signing keys, write any DB, or authorize work.
 * The HTTP consent request is a binding to an ALREADY committed one-time
 * Super Admin decision; it is not a second human approval.
 */
import {createHash} from 'node:crypto';
import {canonicalApproval,validateApprovalClaims}
 from './gpt02-issuer-store.mjs';

const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const refusal=(reason)=>Object.freeze({verified:false,reason,
  releaseDecision:'NO_GO',authorizationGranted:false,
  signingPermitted:false,issuerLeaseGranted:false,dispatchPermitted:false});
const CLAIM_FIELDS=['v','environment','audience','taskId','commandId','attemptId',
  'nonce','operatorNamespace','superAdminId','companyId','issuedAt','expiresAt'];
const CONSENT_FIELDS=['kind','approved','companyId','taskId','commandId',
  'attemptId','nonce','operatorSubject'];
const SESSION_PROOF_FIELDS=['session','consent'];
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const isSafeFalse=(o,keys)=>keys.every(k=>o[k]===false);

/** 
 * readTrustedClaims must be a server-only reader of the existing Issue159
 * root-owned single-use approved-claims packet (NOT req.body).
 * readTrustedIntent must be the existing vetted Unix approval-reader client,
 * including pinned socket custody and peer credentials. A successful HTTP
 * status or caller-supplied true flag is NOT sufficient.
 */
export function createGpt02Issue159PersistedIntentGate({
  readTrustedClaims,readTrustedIntent,env,clock=Date.now,maxReadAgeMs=2000,
}={}){
  if(typeof readTrustedClaims!=='function'||
     typeof readTrustedIntent!=='function'||typeof clock!=='function'||
     !Number.isSafeInteger(maxReadAgeMs)||maxReadAgeMs<1||maxReadAgeMs>2000)
    throw Error('PERSISTED_INTENT_TRUST_DEPENDENCIES_REQUIRED');
  return async function verifyExistingOneHumanDecision(input){
    try{
      const now=clock();
      if(env?.NODE_ENV!=='development'||env?.APP_ENV!=='development'||
         !Number.isSafeInteger(now)||!exact(input,SESSION_PROOF_FIELDS))
        return refusal('EXISTING_INTENT_DEV_ONLY');
      const {session,consent}=input;
      if(!session||session.role!=='super_admin'||typeof session.id==='undefined'||
         !exact(consent,CONSENT_FIELDS)||consent.approved!==true||
         consent.kind!=='GPT02_DEV_SINGLE_COMMAND_CONSENT_V1'||
         consent.operatorSubject!==String(session.id)||consent.taskId<=171||
         consent.companyId!=='default')
        return refusal('OWNER_CONSENT_NOT_BOUND');
      const claims=await readTrustedClaims(Object.freeze({
        companyId:consent.companyId,taskId:consent.taskId,
        commandId:consent.commandId,attemptId:consent.attemptId,
        operatorSubject:consent.operatorSubject,
      }));
      if(!exact(claims,CLAIM_FIELDS))return refusal('ISSUE159_CLAIMS_NOT_CANONICAL');
      try{validateApprovalClaims(claims,now)}
      catch{return refusal('ISSUE159_CLAIMS_INVALID_OR_EXPIRED')}
      if(claims.taskId!==consent.taskId||claims.taskId<=171||
         claims.commandId!==consent.commandId||
         claims.attemptId!==consent.attemptId||
         claims.nonce!==consent.nonce||
         claims.companyId!==consent.companyId||
         claims.superAdminId!==consent.operatorSubject||
         claims.operatorNamespace!=='ai-task-hub.public.users')
        return refusal('ISSUE159_APPROVAL_CLAIMS_MISMATCH');
      const digest=createHash('sha256').update(canonicalApproval(claims),'utf8').digest('hex');
      const lookup=Object.freeze({
        claimsSha256:digest,taskId:claims.taskId,commandId:claims.commandId,
        attemptId:claims.attemptId,companyId:claims.companyId,
        superAdminId:claims.superAdminId,
      });
      const reader=await readTrustedIntent(Object.freeze({lookup,observedAt:now}));
      if(!reader||reader.ok!==true||reader.environment!=='DEV'||
         reader.approvalReadOnly!==true||reader.decisionCreated!==false||
         reader.releaseDecision!=='NO_GO'||
         !isSafeFalse(reader,['signingPermitted','authorizationGranted','dispatchPermitted']))
        return refusal('ISSUE159_READER_NOT_TRUSTED');
      const evidence=reader.result,decision=evidence?.decision;
      if(evidence?.persistedTrustedReadProven!==true||
         evidence?.approvalBindingMatched!==true||
         evidence?.adminApprovalMatched!==true||
         evidence?.releaseDecision!=='NO_GO'||
         !isSafeFalse(evidence,['signingPermitted','authorizationGranted','dispatchPermitted'])||
         !decision||!UUID.test(decision.decisionId)||
         decision.claimsSha256!==digest||
         decision.actorId!==String(session.id)||
         decision.roleAtDecision!=='super_admin'||
         decision.authMethod!=='supabase_admin_session'||
         decision.decision!=='APPROVE'||
         !Number.isSafeInteger(decision.recordedAt)||
         decision.recordedAt<claims.issuedAt||
         decision.recordedAt>=claims.expiresAt||
         decision.recordedAt>now||
         now-decision.recordedAt>maxReadAgeMs+300000|| // hard expiry also applies below
         claims.expiresAt<=now)
        return refusal('ISSUE159_PERSISTED_OWNER_DECISION_MISSING');
      return Object.freeze({verified:true,reason:'ISSUE159_PERSISTED_DECISION_VERIFIED_ONLY',
        digest,releaseDecision:'NO_GO',authorizationGranted:false,
        signingPermitted:false,issuerLeaseGranted:false,dispatchPermitted:false});
    }catch{return refusal('ISSUE159_PERSISTED_PROOF_UNAVAILABLE')}
  };
}
