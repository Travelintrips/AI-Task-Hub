import fs from "node:fs";
import dns from "node:dns/promises";
import {createRequire} from "node:module";
import {readActiveVpsSuperAdmin,getVpsIdentityReaderConfig} from "/app/src/lib/vps-storage-readonly-db.ts";
const pg=createRequire("/app/package.json")("pg");
const host="aws-1-ap-southeast-2.pooler.supabase.com", ref="xssrfshdrtdfupgqwfdw", username="ai_task_vps_identity_reader_dev."+ref;
const link="postgresql://"+username+":synthetic_only_reader_pass_2026_11_14_very_long@"+host+":5432/postgres";
const caFile="/app/offline-ca.pem";
const env={NODE_ENV:"development",APP_ENV:"development",VPS_STORAGE_INVENTORY_READONLY_ENABLED:"true",AI_TASK_DEV_EXPECTED_PROJECT_ID:ref,VPS_STORAGE_IDENTITY_READER_URL_DEV:link,VPS_STORAGE_IDENTITY_READER_CA_FILE:caFile};
let count=0;
function pass(cond,label){if(!cond)throw Error("ASSERT_"+label); count++; console.log(label+"=PASS");}
async function gate(data,expected,name,overrides={}){const result=await readActiveVpsSuperAdmin(data,{...env,...overrides});pass(result===expected,name);}
try {
 const resolved=await dns.lookup(host);
 pass(resolved.address===process.env.SYNTHETIC_PG_IP,"DNS_PINNED_TO_ONLY_SYNTHETIC_PRIVATE_POSTGRES");
 pass(getVpsIdentityReaderConfig(env)!==null,"EXACT_PR186_READER_CONFIG_ACCEPTS_VALID_SCOPE");
 pass(getVpsIdentityReaderConfig({...env,VPS_STORAGE_IDENTITY_READER_URL_DEV:link.replace(username,"postgres."+ref)})===null,"PRIVILEGED_CONNECTION_FALLBACK_REJECTED");
 const admin={id:"google_synthetic_admin_1",email:"admin@example.invalid",companyId:null,role:"super_admin",name:"offline synthetic"};
 await gate(admin,"unavailable","FEATURE_FLAG_OFF_FAIL_CLOSED",{VPS_STORAGE_INVENTORY_READONLY_ENABLED:"false"});
 await gate(admin,"unavailable","MISSING_CA_FAIL_CLOSED",{VPS_STORAGE_IDENTITY_READER_CA_FILE:"/app/does-not-exist.crt"});
 await gate(admin,"match","REAL_POSTGRES_TLS_LOGIN_RLS_NULL_COMPANY_MATCH");
 await gate({...admin,email:"wrong@example.invalid"},"denied","RLS_WRONG_EMAIL_DENIED");
 await gate({...admin,companyId:5},"denied","RLS_WRONG_COMPANY_DENIED");
 await gate({...admin,id:"unknown-id"},"denied","RLS_UNKNOWN_ID_DENIED");
 await gate({...admin,id:"google_synthetic_inactive",email:"old@example.invalid"},"denied","RLS_INACTIVE_ADMIN_DENIED");
 await gate({...admin,id:"google_synthetic_staff",email:"staff@example.invalid"},"denied","RLS_STAFF_DENIED");
 await gate({...admin,id:"google_synthetic_admin_2",email:"admin2@example.invalid",companyId:2},"match","RLS_INTEGER_COMPANY_MATCH");
 await gate({...admin,companyId:"default"},"unavailable","LEGACY_DEFAULT_COMPANY_REJECTED");
 const c=new pg.Client({connectionString:link,ssl:{ca:fs.readFileSync(caFile,"utf8"),rejectUnauthorized:true},connectionTimeoutMillis:5000});
 try{
 await c.connect();
 pass(c.connection?.stream?.authorized===true,"TRUE_POSTGRES_TLS_CERTIFICATE_VERIFIED");
 const who=await c.query("SELECT current_user AS u,(SELECT rolcanlogin FROM pg_roles WHERE rolname='ai_task_vps_identity_reader_dev') AS source_login");
 pass(who.rows[0]?.u===username&&who.rows[0]?.source_login===false,"OFFLINE_ALIAS_AUTH_KEEPS_SOURCE_READER_NOLOGIN");
 let columnDenied=false;try{await c.query("SELECT password_hash FROM public.users LIMIT 1")}catch(e){columnDenied=e.code==="42501"}
 pass(columnDenied,"SENSITIVE_COLUMN_READ_DENIED");
 let writeDenied=false;try{await c.query("UPDATE public.users SET status='inactive' WHERE id='google_synthetic_admin_1'")}catch(e){writeDenied=e.code==="42501"}
 pass(writeDenied,"USER_DATA_UPDATE_DENIED");
 }finally{await c.end().catch(()=>{})}
 console.log("PASSED_CHECK_COUNT="+count);
 console.log("EXACT_SOURCE_NODE_DRIVER_REAL_SYNTHETIC_POSTGRES_E2E=PASS");
 console.log("NO_REAL_SUPABASE_ACCOUNT_OR_DATABASE_ACCESSED=true");
}catch(e){console.log("E2E_FAILURE="+String(e?.code??e?.message).slice(0,180));process.exitCode=1;}
