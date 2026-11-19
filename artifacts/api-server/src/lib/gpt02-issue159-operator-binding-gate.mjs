/**
 * CST-DEV candidate: explicitly bridge PR196 app-local numeric user id to the
 * EXISTING Issue159 Supabase-auth-user -> Hub public.users TEXT subject mapping.
 *
 * This is an UNMOUNTED, READ-ONLY identity admission contract. Nothing here
 * signs, loads keys, creates a mapping, reads the Issue159 SQLite file, grants
 * DB privileges, starts services, or authorizes dispatch.
 *
 * The trusted resolver MUST come from the existing Issue159 operator-link
 * custody service. Never use req.body, email alone, local user.id or a JWT
 * metadata claim as the Hub operator ID.
 */
import {hasRecentVerifiedGpt02DevGoogleOperator}
 from './gpt02-google-auth-gate.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT=/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===[...fields].sort().join(',');
const boundFields=[
 'source','environment','authSupabaseId','hubOperatorSubject',
 'emailNormalized','hubRole','hubActive','adminRole','adminEnabled',
 'mappingEnabled','observedAt','readOnly','signingPermitted',
 'authorizationGranted','dispatchPermitted','releaseDecision',
];
const refusal=(reason)=>Object.freeze({verified:false,reason,
 signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,
 releaseDecision:'NO_GO'});
export function createGpt02Issue159OperatorBindingGate({
 readTrustedIssue159Mapping,env,clock=Date.now,maxAgeMs=2000,
}={}){
 if(typeof readTrustedIssue159Mapping!=='function'||typeof clock!=='function'||
   !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>2000)
  throw Error('TRUSTED_ISSUE159_OPERATOR_MAPPING_READER_REQUIRED');

 return async function verifyOperatorBinding({session,hubOperatorSubject}={}){
  try{
   const now=clock();
   if(env?.NODE_ENV!=='development'||env?.APP_ENV!=='development'||
      !Number.isSafeInteger(now)||
      !hasRecentVerifiedGpt02DevGoogleOperator(session,env,now)||
      !Number.isSafeInteger(session.id)||session.id<=0||
      session.companyId!=='default'||!UUID.test(session.authSupabaseId)||
      typeof session.email!=='string'||!SUBJECT.test(hubOperatorSubject)||
      hubOperatorSubject==='dev_approval_token')
    return refusal('FRESH_APP_AND_HUB_IDENTITY_REQUIRED');

   // Two non-interchangeable namespaces, both required.
   const emailNormalized=session.email.trim().toLowerCase();
   const lookup=Object.freeze({
     authSupabaseId:session.authSupabaseId,
     emailNormalized,
     hubOperatorSubject,
   });
   const proof=await readTrustedIssue159Mapping(lookup);
   const at=clock();
   if(!Number.isSafeInteger(at)||at<now||at-now>maxAgeMs)
    return refusal('ISSUE159_MAPPING_EVIDENCE_STALE');
   if(!exact(proof,boundFields)||
      proof.source!=='issue159-verified-admin-operator-link'||
      proof.environment!=='DEV'||
      proof.authSupabaseId!==session.authSupabaseId||
      proof.hubOperatorSubject!==hubOperatorSubject||
      proof.emailNormalized!==emailNormalized||
      proof.hubRole!=='super_admin'||proof.hubActive!==true||
      proof.adminRole!=='super_admin'||proof.adminEnabled!==true||
      proof.mappingEnabled!==true||
      !Number.isSafeInteger(proof.observedAt)||
      proof.observedAt>at||at-proof.observedAt>maxAgeMs||
      proof.readOnly!==true||
      proof.signingPermitted!==false||
      proof.authorizationGranted!==false||
      proof.dispatchPermitted!==false||
      proof.releaseDecision!=='NO_GO')
    return refusal('ISSUE159_TRUSTED_MAPPING_MISSING_OR_CHANGED');
   return Object.freeze({
    verified:true,reason:'ISSUE159_MAPPING_BOUND_NO_AUTHORITY',
    hubOperatorSubject,
    signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,
    releaseDecision:'NO_GO',
   });
  }catch{return refusal('ISSUE159_MAPPING_READER_UNAVAILABLE')}
 };
}
