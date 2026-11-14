/**
 * DEV-only diagnostic for the dedicated preparer account. PostgreSQL
 * pg_roles/pg_authid data is resolved server-side; never accept client flags.
 * This is not a grant, a Super Admin approval or a worker authorization.
 */
const blocked=(reason)=>Object.freeze({catalogReady:false,reason,dispatchPermitted:false});
export function assessGpt02PreparerCatalog(role,now=Date.now()){
  if(role===null||typeof role!=='object'||Array.isArray(role))
    return blocked('GPT02_PREPARER_ROLE_NOT_FOUND');
  if(role.role!=='gpt02_core_prep_login')
    return blocked('GPT02_PREPARER_ROLE_IDENTITY_MISMATCH');
  for(const k of ['superuser','bypassRls','createRole','createDb','replication','inherit']){
    if(role[k]!==false)return blocked('GPT02_PREPARER_PRIVILEGE_DRIFT');
  }
  if(role.memberships!==0||role.canCreateDatabase!==false)
    return blocked('GPT02_PREPARER_PRIVILEGE_DRIFT');
  if(role.canLogin!==true)
    return blocked('GPT02_PREPARER_LOGIN_LOCKED');
  if(role.passwordVerifierReady!==true)
    return blocked('GPT02_PREPARER_PASSWORD_VERIFIER_MISSING');
  if(role.connectionLimit!==1||role.activeSessions!==0)
    return blocked('GPT02_PREPARER_CONNECTION_LIMIT_NOT_VERIFIED');
  const expires=role.validUntil instanceof Date?role.validUntil.getTime():
    typeof role.validUntil==='string'?Date.parse(role.validUntil):NaN;
  if(!Number.isFinite(now)||!Number.isFinite(expires)||
     expires<=now||expires-now>10*60_000)
    return blocked('GPT02_PREPARER_SHORT_LIVED_LOGIN_REQUIRED');
  return Object.freeze({catalogReady:true,reason:'PREPARER_ACCOUNT_SCOPED_NOT_YET_AUTHENTICATED',
    dispatchPermitted:false});
}
