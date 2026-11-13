#!/usr/bin/env node
"use strict";
// DEV-only independent job status notifier. Never executes tasks, writes
// application data, or connects the NO_GO GPT02 candidate to WhatsApp.
const fs = require("node:fs");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const { Client } = require("/opt/ai-task-ledger-final-build-a527/artifacts/api-server/node_modules/pg");
const STORE = "/var/lib/ai-core-job-wa-dev-monitor/state.json";
const WATCH_INTERVAL = 60_000;
const ONCE = process.argv.includes("--once");
const PRIME = process.argv.includes("--prime");
const VERIFY = process.argv.includes("--verify");
const DRY = process.argv.includes("--dry-run");
const GUARD_ONLY = process.argv.includes("--guard-only");
const SELF_TEST = process.argv.includes("--self-test");
const expectedLast4 = "7596";
const log = (type, fields = {}) => console.log(JSON.stringify({at:new Date().toISOString(), type, ...fields}));
function guard(message) { throw new Error(message); }
function docker(args) {
  const r = cp.spawnSync("/usr/bin/docker", args, {encoding:"utf8",timeout:7000,maxBuffer:100000});
  if(r.status!==0 || r.error) guard("DEV_DOCKER_CHECK_FAILED");
  return r.stdout.trim();
}
function inspect(name) { return JSON.parse(docker(["inspect",name]))[0]; }
function env(path) {
  const st = fs.statSync(path);
  if(st.mode & 0o077) guard("ENV_FILE_PERMISSIONS_UNSAFE");
  const vals={};
  for(const line of fs.readFileSync(path,"utf8").split(/\r?\n/)){
    const pos=line.indexOf("=");
    if(pos>0 && !line.startsWith("#")) vals[line.slice(0,pos).trim()]=line.slice(pos+1);
  }
  return vals;
}
function preflight() {
  const app=env("/etc/ai-task/development.env");
  const gw=env("/opt/cst-wa-gateway-dev/.env.dev");
  if(gw.APP_ENV!=="development"||!app.SUPABASE_DATABASE_URL_DEV) guard("DEV_CONFIG_REQUIRED");
  const dbEndpoint = new URL(app.SUPABASE_DATABASE_URL_DEV);
  if (!dbEndpoint.username.endsWith(".xssrfshdrtdfupgqwfdw") ||
      !dbEndpoint.hostname.endsWith(".pooler.supabase.com") ||
      !["5432", "6543"].includes(dbEndpoint.port))
    guard("DEV_DATABASE_PROJECT_OR_POOLER_MISMATCH");
  const caPath="/etc/ssl/certs/cst-dev-supabase-root.crt";
  if(!fs.existsSync(caPath))guard("DEV_SUPABASE_CA_NOT_INSTALLED");
  const caCert=new crypto.X509Certificate(fs.readFileSync(caPath));
  const pinned="807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa";
  if(caCert.fingerprint256.replace(/:/g,"").toLowerCase()!==pinned)
    guard("DEV_SUPABASE_CA_PIN_MISMATCH");
  // Official direct IPv6 endpoint; only the DEV project's credentials may be used.
  const directDb=new URL(dbEndpoint.toString());
  directDb.hostname="db.xssrfshdrtdfupgqwfdw.supabase.co";
  directDb.username="postgres";
  directDb.port="5432";
  directDb.searchParams.delete("sslmode");
  const clients=JSON.parse((gw.GATEWAY_API_KEYS_JSON||"").replace(/^'|'$/g,""));
  const key=clients["ai-core-dev"]?.key;
  if(!key||key.length<40||clients["ai-core-dev"].companyId!=="ai-core-dev") guard("DEV_TOKEN_SCOPING_FAILED");
  const api=inspect("cst-wa-gateway-dev-api-dev-1");
  const worker=inspect("cst-wa-gateway-dev-worker-dev-1");
  const candidate=inspect("ai-task-pr156-a43b0a8-normal");
  const old=inspect("ai-task-development");
  for(const c of [api,worker]){
    if(c.Config?.Labels?.["com.docker.compose.project"]!=="cst-wa-gateway-dev"||
       c.State?.Status!=="running") guard("WA_GATEWAY_NOT_ISOLATED_DEV");
  }
  if(candidate.Config?.Labels?.["cst.dev.release_decision"]!=="NO_GO"||
     candidate.Config?.Labels?.["cst.dev.candidate_only"]!=="true")
    guard("GPT02_RELEASE_BOUNDARY_CHANGED");
  if(old.State?.Status==="running") guard("OLD_APP_RUNNING_DUPLICATE_NOTIFIER_RISK");
  const net=docker(["network","inspect","cst-wa-ai-core-dev-private","--format",
    "{{.Internal}} {{range .Containers}}{{.Name}} {{end}}"]);
  if(!net.startsWith("true ")||net.includes("ai-task-pr156-a43b0a8-normal"))
    guard("NO_GO_CANDIDATE_CONNECTED_OR_NETWORK_CHANGED");
  const address=api.NetworkSettings?.Networks?.["cst-wa-gateway-dev_wa-dev"]?.IPAddress;
  if(!/^172\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address||"")) guard("WA_DEV_PRIVATE_IP_INVALID");
  const phone=docker(["exec","cst-wa-gateway-dev-worker-dev-1","node","-e",
    'const c=JSON.parse(require("fs").readFileSync("/data/whatsapp-dev/.devices/ai-core-dev-sender-01/creds.json"));process.stdout.write((c.me?.id||"").split("@")[0].split(":")[0])']);
  if(!/^[0-9]{8,16}$/.test(phone)||!phone.endsWith(expectedLast4))
    guard("LINKED_DEV_SELF_PHONE_MISMATCH");
  return {url:"http://"+address+":8080",token:key,phone,dbUrl:directDb.toString()};
}
function save(s) {
  fs.mkdirSync("/var/lib/ai-core-job-wa-dev-monitor",{recursive:true,mode:0o700});
  fs.writeFileSync(STORE+".new",JSON.stringify(s),{mode:0o600});
  fs.renameSync(STORE+".new",STORE);
}
function load() {
  if(!fs.existsSync(STORE))return null;
  if(fs.statSync(STORE).mode & 0o077)guard("MONITOR_STATE_UNSAFE");
  const s=JSON.parse(fs.readFileSync(STORE,"utf8"));
  if(s.version!==1||!s.seen||!Array.isArray(s.pending)||!Array.isArray(s.history))guard("STATE_INVALID");
  return s;
}
async function fetchJobs(url) {
  const caPath="/etc/ssl/certs/cst-dev-supabase-root.crt";
  const ssl={rejectUnauthorized:true};
  if(fs.existsSync(caPath))ssl.ca=fs.readFileSync(caPath,"utf8");
  const c=new Client({connectionString:url,ssl,connectionTimeoutMillis:6000,
    statement_timeout:8000});
  try {
    await c.connect();
    await c.query("BEGIN TRANSACTION READ ONLY");
    const r=await c.query("SELECT id::text, source, title, worker_id, assigned_client_id, status, started_at, completed_at, created_at, updated_at, callback_verified,attestation_verified,final_ack_verified FROM ai_execution_jobs WHERE source IN ('AI_CORE','AI_TASK') ORDER BY updated_at DESC LIMIT 1500");
    await c.query("COMMIT");
    return r.rows;
  } finally { await c.end().catch(()=>undefined); }
}
const clean=(t,n=15)=>String(t||"—").replace(/[\x00-\x1F\x7F<>]/g," ").replace(/\s+/g," ").trim().slice(0,n)||"—";
function icon(row) {
  const x=String(row.status||"").toLowerCase();
  if(x==="completed"&&row.callback_verified&&row.attestation_verified&&row.final_ack_verified)return "✅";
  if(["completed","verifying"].includes(x))return "🔎";
  if(["processing","running","in_progress"].includes(x))return "🔄";
  if(x==="prepared")return "⏸️";
  if(["queued","received","pending"].includes(x))return "⏳";
  if(x==="failed")return "❌";
  if(["blocked","review_required"].includes(x))return "⚠️";
  if(x==="cancelled")return "🚫";
  return "🔎";
}
function agent(row) {
  const x=String(row.worker_id||row.assigned_client_id||"").toLowerCase();
  if(x.includes("dell"))return "DELL";
  if(x.includes("hp"))return "HP";
  if(x.includes("travel"))return "Travel";
  return "DEV";
}
function dur(row) {
  const from=Date.parse(row.started_at||row.created_at||"");
  const to=Date.parse(row.completed_at||row.updated_at||"");
  if(!Number.isFinite(from)||!Number.isFinite(to))return "—";
  const v=Math.max(0,Math.floor((to-from)/1000));
  return v>3599?Math.floor(v/3600)+"h"+Math.floor(v%3600/60)+"m":
    v>59?Math.floor(v/60)+"m"+v%60+"s":v+"s";
}
function digest(items) {
  const lines=items.map(e=>{
    const r=e.job;
    return icon(r)+" "+r.id.slice(0,6).toUpperCase()+" | "+clean(r.title)+" | "+agent(r)+" | "+dur(r);
  });
  return ["📋 *JOB MONITORING AI CORE · DEV*",
    "_Pemantauan saja; bukan izin menjalankan job._","",
    ...lines,"","Total "+items.length+" perubahan status"].join("\n");
}
const date=()=>new Date().toISOString().slice(0,10);
async function waReady(cfg) {
  const r=await fetch(cfg.url+"/v1/status",{signal:AbortSignal.timeout(5000)});
  if(!r.ok)return false;
  const x=await r.json();
  return x.overallStatus!=="degraded"&&x.onlineWorkers>0&&
   (x.workers||[]).some(w=>w.deviceId==="ai-core-dev-sender-01"&&w.status==="ONLINE");
}
async function send(cfg,message,key) {
  const r=await fetch(cfg.url+"/v1/messages",{method:"POST",headers:{
    Authorization:"Bearer "+cfg.token,"Content-Type":"application/json","Idempotency-Key":key
  },body:JSON.stringify({type:"text",deviceId:"ai-core-dev-sender-01",
    to:cfg.phone,text:message,clientMessageId:key}),signal:AbortSignal.timeout(12000)});
  const x=await r.json();
  return {accepted:r.ok&&["queued","duplicate"].includes(x.status),http:r.status,id:x.messageId||null};
}
async function cycle(){
  if(SELF_TEST){
    const x={id:"12345678-aaaa-bbbb-cccc-dddddddddddd",title:"DEV safe test",status:"completed",
      callback_verified:false,attestation_verified:false,final_ack_verified:false,
      source:"AI_CORE",created_at:new Date(),updated_at:new Date()};
    if(icon(x)!=="🔎") guard("UNVERIFIED_COMPLETED_ICON_INVALID");
    x.callback_verified=x.attestation_verified=x.final_ack_verified=true;
    if(icon(x)!=="✅") guard("VERIFIED_COMPLETED_ICON_INVALID");
    x.status="blocked";
    if(icon(x)!=="⚠️") guard("BLOCKED_ICON_INVALID");
    const msg=digest([{job:x}]);
    if(!msg.includes("JOB MONITORING AI CORE") || !msg.includes("123456") ||
       msg.length>400) guard("MOBILE_DIGEST_INVALID");
    log("self_test_pass",{safeUnverifiedStatus:true,verifiedStatus:true,blockedStatus:true,mobile:true});
    return;
  }
  const cfg=preflight();
  if(GUARD_ONLY){ log("guard_pass",{scopedDevGateway:true,numberEnding:expectedLast4,
    releaseDecision:"NO_GO",nativeNotifierStopped:true});return; }
  const rows=await fetchJobs(cfg.dbUrl);
  if(VERIFY){
    log("verified_read_only",{jobs:rows.length,waOnline:await waReady(cfg),
      recipientMatched:true,releaseDecision:"NO_GO"});
    return;
  }
  let s=load();
  if(!s||PRIME){
    s={version:1,initializedAt:new Date().toISOString(),seen:{},pending:[],history:[],
      rateDay:date(),dayEvents:0,daySends:0,lastSendAt:null,inflight:null};
    for(const r of rows)s.seen[r.id]={status:r.status,updatedAt:r.updated_at};
    if(!DRY)save(s);
    log("baseline_no_replay",{jobs:rows.length,dryRun:DRY});
    return;
  }
  if(s.rateDay!==date()){s.rateDay=date();s.dayEvents=0;s.daySends=0}
  let changes=0;
  for(const r of rows){
    const prev=s.seen[r.id];
    s.seen[r.id]={status:r.status,updatedAt:r.updated_at};
    if(prev&&prev.status===r.status)continue;
    if(s.pending.length>=120||s.dayEvents>=120){log("event_cap");continue}
    s.pending.push({id:r.id+":"+r.updated_at,job:r,createdAt:new Date().toISOString()});
    changes++;s.dayEvents++;
  }
  if(DRY){log("dry_run",{changes,pending:s.pending.length});return}
  save(s);
  if(changes)log("status_changes_detected",{count:changes,pending:s.pending.length});
  if(!s.pending.length||s.daySends>=40)return;
  if(s.lastSendAt&&Date.now()-Date.parse(s.lastSendAt)<WATCH_INTERVAL)return;
  if(!await waReady(cfg)){log("wa_unavailable");return}
  const batch=s.pending.slice(0,6);
  const key="ai-core-jobmon-dev-"+crypto.createHash("sha256").update(batch.map(x=>x.id).join("|")).digest("hex").slice(0,32);
  if(!s.inflight){s.inflight={key,createdAt:new Date().toISOString(),attempts:0};save(s)}
  if(s.inflight.key!==key){log("inflight_mismatch_hold");return}
  try{
    const r=await send(cfg,digest(batch),key);
    s.inflight.attempts++;
    if(r.accepted){
      s.history.push({key,status:"queued_not_delivered",id:r.id,at:new Date().toISOString(),count:batch.length});
      s.pending.splice(0,batch.length);
      s.inflight=null;s.daySends++;s.lastSendAt=new Date().toISOString();
      log("gateway_accepted_not_delivered",{items:batch.length,http:r.http,remaining:s.pending.length});
    }else{
      log("gateway_refused",{http:r.http,attempts:s.inflight.attempts});
      if(s.inflight.attempts>=5){
        s.history.push({key,status:"quarantined",at:new Date().toISOString()});
        s.pending.splice(0,batch.length);s.inflight=null;
      }
    }
  }catch{log("gateway_retry_deferred");s.inflight.attempts++}
  s.history=s.history.slice(-200);
  save(s);
}
async function main(){
  let busy=false;
  async function tick(){
    if(busy)return;busy=true;
    try{await cycle()}catch(e){
      log("guarded_error",{reason:String(e.message||"unknown").slice(0,90)});
      if(ONCE||PRIME||VERIFY||DRY||GUARD_ONLY||SELF_TEST)process.exitCode=1;
    }finally{busy=false}
  }
  await tick();
  if(!ONCE&&!PRIME&&!VERIFY&&!DRY&&!GUARD_ONLY&&!SELF_TEST)setInterval(tick,WATCH_INTERVAL);
}
main().catch(e=>{log("startup_failed",{reason:String(e.message||"unknown").slice(0,90)});process.exitCode=1});
