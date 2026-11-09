"use strict";
/**
 * DEV-only candidate trusted tenant scope. This is a pure authorization
 * admission decision, NOT a database credential router or RLS authorization.
 * Only pass a server-verified JWT principal from req.user, never req.auth,
 * HTTP headers, request query/body, or the mutable app.company_id GUC.
 * The real DB identity binding is intentionally NOT implemented here.
 */
const COMPANY=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
function scopeFromVerifiedPrincipal(principal, requestedCompanyId, {crossCompanyRead=false}={}) {
 const deny=(reason)=>({allowed:false,reason,dbCredentialRole:null,issuerPermitted:false,dispatchPermitted:false});
 if(!principal||!Number.isSafeInteger(principal.id)||principal.id<=0||
    typeof principal.companyId!=="string"||!COMPANY.test(principal.companyId))
  return deny("VERIFIED_PRINCIPAL_REQUIRED");
 if(typeof principal.role!=="string")return deny("VERIFIED_ROLE_REQUIRED");
 if(requestedCompanyId!==undefined && requestedCompanyId!==null &&
    (typeof requestedCompanyId!=="string"||!COMPANY.test(requestedCompanyId)))
  return deny("INVALID_COMPANY_SELECTOR");
 const isAdmin=principal.role==="super_admin";
 if(requestedCompanyId===undefined||requestedCompanyId===null){
  if(isAdmin&&crossCompanyRead===true)
   return {allowed:true,mode:"CROSS_COMPANY_READ_REQUIRES_DEDICATED_DB_ROLE",
    tenantId:null,dbCredentialRole:null,issuerPermitted:false,dispatchPermitted:false};
  return {allowed:true,mode:"SINGLE_TENANT",tenantId:principal.companyId,
   dbCredentialRole:null,issuerPermitted:false,dispatchPermitted:false};
 }
 if(!isAdmin&&requestedCompanyId!==principal.companyId)return deny("CROSS_TENANT_SELECTOR_FORBIDDEN");
 return {allowed:true,mode:"SINGLE_TENANT",tenantId:requestedCompanyId,
  dbCredentialRole:null,issuerPermitted:false,dispatchPermitted:false};
}
module.exports={scopeFromVerifiedPrincipal};
