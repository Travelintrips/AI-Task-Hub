/**
 * GPT02 DEV-only HTTP adapter CANDIDATE — NOT mounted in the API router.
 * Requires upstream authenticated app req.user. No cookie/JWT parsing here.
 * The browser submits only explicit one-command consent, NEVER signing keys,
 * credentials, signatures, trust roots, issuer leases, or trusted DB facts.
 * Fail closed until the separately approved server-side signer is attached.
 */
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const deny=(reason)=>Object.freeze({recorded:false,reason,releaseDecision:'NO_GO',
 authorizationGranted:false,issuerLeaseGranted:false,dispatchPermitted:false,commandCreated:false});
const CLOSED_BODY=Object.freeze({recorded:false,reason:'APPROVAL_ENDPOINT_NOT_ACTIVATED',
 releaseDecision:'NO_GO',authorizationGranted:false,issuerLeaseGranted:false,
 dispatchPermitted:false,commandCreated:false});
const CONSENT_FIELDS=['kind','approved','companyId','taskId','commandId','attemptId','nonce','operatorSubject'];
const JSON_CONTENT_TYPE=/^application\/json(?:\s*;\s*charset=utf-8)?$/i;
export function createGpt02SingleOwnerApprovalHttpCandidate({
 env=process.env,recordOneConsent,readSignedProof,inspectRequestOrigin,verifyFreshGoogleOperator,
}={}){
 if(typeof recordOneConsent!=='function'||typeof readSignedProof!=='function'||
    typeof inspectRequestOrigin!=='function'||typeof verifyFreshGoogleOperator!=='function')
   throw Error('SERVER_HTTP_DEPENDENCIES_REQUIRED');
 return async function candidate(req,res){
  const respond=(status,body)=>{res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.status(status).json(body);};
  if(env.NODE_ENV!=='development'||env.APP_ENV!=='development')
    return respond(404,deny('DEV_ONLY'));
  // This switch is deliberately absent from deployed DEV and is NOT
  // a release authorization on its own. No signer/attestor is mounted.
  if(env.GPT02_SINGLE_OWNER_APPROVAL_HTTP_ENABLED!=='true')
    return respond(503,CLOSED_BODY);
  // The caller MUST be authenticated by existing verified app middleware.
  if(!req.user)return respond(401,deny('AUTHENTICATION_REQUIRED'));
  if(req.user.role!=='super_admin')return respond(403,deny('SUPER_ADMIN_REQUIRED'));
  // Authenticate step-up BEFORE calling the independent signer provider.
  // Supply the existing PR196 hasRecentVerifiedGpt02DevGoogleOperator as
  // server dependency, never a client-supplied boolean or role assertion.
  if(verifyFreshGoogleOperator(req.user,env)!==true)
    return respond(403,deny('FRESH_GOOGLE_SUPER_ADMIN_REQUIRED'));
  if(req.method!=='POST')return respond(405,deny('POST_ONLY'));
  if(!JSON_CONTENT_TYPE.test(String(req.headers?.['content-type']??'')))
    return respond(415,deny('JSON_ONLY'));
  if(inspectRequestOrigin(req)!==true)return respond(403,deny('ORIGIN_NOT_VERIFIED'));
  // Explicit, exact consent only; no proof, keys, signer choice, role, JWT,
  // credential, or approval digest may enter through the HTTP body.
  if(!exact(req.body,['consent'])||!exact(req.body.consent,CONSENT_FIELDS))
    return respond(400,deny('EXACT_CONSENT_ONLY'));
  const consent=req.body.consent;
  if(consent.kind!=='GPT02_DEV_SINGLE_COMMAND_CONSENT_V1'||consent.approved!==true||
     consent.operatorSubject!==String(req.user.id))
    return respond(400,deny('EXPLICIT_OWNER_CONSENT_REQUIRED'));
  try{
   // The independent signer service is the ONLY source of signed evidence.
   // Absent service, fail closed. Never use req.body.proof or a client key.
   const proof=await readSignedProof(Object.freeze({
     session:req.user,consent:Object.freeze({...consent})
   }));
   if(!proof)return respond(424,deny('TRUSTED_SIGNER_UNAVAILABLE'));
   const result=await recordOneConsent({session:req.user,consent,proof});
   if(result?.recorded!==true||result.releaseDecision!=='NO_GO'||
      result.authorizationGranted!==false||result.issuerLeaseGranted!==false||
      result.dispatchPermitted!==false||result.commandCreated!==false)
     return respond(409,deny('APPROVAL_EVIDENCE_NOT_RECORDED'));
   return respond(202,Object.freeze({recorded:true,
     reason:'SIGNED_EVIDENCE_RECORDED_ONLY',releaseDecision:'NO_GO',
     authorizationGranted:false,issuerLeaseGranted:false,
     dispatchPermitted:false,commandCreated:false}));
  }catch{return respond(503,deny('APPROVAL_DEPENDENCY_UNAVAILABLE'))}
 };
}
