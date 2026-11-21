#!/usr/bin/env python3
"""CST-DEV single-pass operational audit. Read-only; no secrets, login, dispatch, or task writes."""
import json, subprocess, urllib.request, urllib.error, re, sys
from pathlib import Path

DOMAIN = "https://dev-ai-task.cstlogistic.co.id"
NAMES = {
 "app":"ai-task-dev-main-directdb-qa-20261121",
 "auth":"ai-task-dev-google-direct-authonly-20261121",
 "audit":"ai-task-dev-audit-qa-afc0fda",
 "prepare":"gpt02-task183-dev-native-db-qa-20261121",
 "core":"core-ai-dev",
}
def run(args, timeout=15):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 return p.returncode,p.stdout.strip(),p.stderr.strip()
def http(path):
 try:
  with urllib.request.urlopen(DOMAIN+path, timeout=8) as r:
   return {"http":r.status,"json":"json" in r.headers.get("Content-Type","")}
 except urllib.error.HTTPError as e:
  return {"http":e.code,"json":"json" in e.headers.get("Content-Type","")}
 except Exception:
  return {"http":"UNREACHABLE","json":False}
results={}
for logical,n in NAMES.items():
 status,out,_=run(["docker","inspect",n],timeout=10)
 if status:
  results[logical]={"running":False}
  continue
 x=json.loads(out)[0]
 env=dict(v.split("=",1) for v in x["Config"]["Env"] if "=" in v)
 d=env.get("SUPABASE_DATABASE_URL_DEV","")
 results[logical]={
  "running":x["State"]["Running"],
  "healthy":x["State"].get("Health",{}).get("Status")=="healthy",
  "db_mode":"DIRECT" if "db.xssrfshdrtdfupgqwfdw.supabase.co" in d else "POOLER" if "pooler.supabase.com" in d else "UNKNOWN",
  "background_disabled":env.get("DISABLE_BACKGROUND_SCHEDULERS")=="true",
  "dispatcher_enabled":env.get("AI_DISPATCHER_ENABLED")=="true",
 }
results["public_http"]={p:http(p) for p in [
 "/api/healthz","/api/readyz","/api/auth/me",
 "/api/auth/gpt02/operator-session-readiness",
 "/api/ai-tasks/183/audit",
 "/api/ai-tasks/183/gpt02-preparation-readiness",
]}
code,out,_=run(["systemctl","is-active","gpt02-issue159-relock-catalog-auditor.timer"])
results["watchdog_active"]=code==0 and out=="active"
source=Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id").read_text()
for path,port in [
 ("/api/auth/gpt02/operator-session-readiness",18499),
 ("/api/ai-tasks/183/audit",18505),
 ("/api/ai-tasks/183/gpt02-preparation-readiness",18503),
 ("/api/ai-tasks/183/gpt02-prepare",18503)]:
 # Nginx locations may contain nested limit_except braces. Inspect until
 # the next sibling location declaration rather than the first closing brace.
 pat=r"(?m)^    location = "+re.escape(path)+r" \{"
 m=re.search(pat,source)
 block=source[m.end():] if m else ""
 if m: block=re.split(r"(?m)^    location\s|^    listen\s",block,1)[0]
 results["route_"+path]=bool(m and ("proxy_pass http://127.0.0.1:"+str(port)+";") in block)
js='''const{Client}=require("/app/artifacts/api-server/node_modules/pg");
let c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,connectionTimeoutMillis:7000,query_timeout:7000});
(async()=>{try{await c.connect();await c.query("BEGIN READ ONLY");
let a=await c.query("select rolname,rolcanlogin,rolconnlimit from pg_roles where rolname in ($1,$2)",["gpt02_core_prep_login","gpt02_task183_relock_login"]);
let b=await c.query("select count(*)::int as n from pg_stat_activity where usename=$1",["gpt02_core_prep_login"]);
let q=await c.query("select count(*)::int as n from public.ai_execution_jobs where task_id=$1",[183]);
let t=await c.query("select task_number,status from public.ai_tasks where id=$1",[183]);
console.log(JSON.stringify({roles:a.rows,preparer_sessions:b.rows[0].n,task183_jobs:q.rows[0].n,task183:t.rows[0]||null}));
await c.query("ROLLBACK")}catch(e){console.log(JSON.stringify({error:e.code||"QUERY_FAILED"}));process.exitCode=4}finally{await c.end()}})()'''
code,out,err=run(["docker","exec",NAMES["app"],"node","-e",js],timeout=22)
try: results["database"]=json.loads(out)
except Exception:results["database"]={"probe":"FAILED"}
results["database_probe_pass"]=code==0
results["safe_to_attempt_task183"]=False
results["blockers"]=[]
if results["core"]["db_mode"]!="DIRECT":results["blockers"].append("CORE_AI_STILL_USING_POOLER")
if not results["database_probe_pass"]:results["blockers"].append("DB_PROBE_FAILED")
if not results["watchdog_active"]:results["blockers"].append("WATCHDOG_INACTIVE")
if not all(results[k]["running"] and results[k]["healthy"] for k in ("app","auth","audit","prepare")):results["blockers"].append("API_COMPONENT_UNHEALTHY")
if any(not v for k,v in results.items() if k.startswith("route_")):results["blockers"].append("ROUTING_MISMATCH")
results["blockers"].append("BROWSER_OWNER_COMMAND_BOUND_AUTH_AND_E2E_NOT_VERIFIED")
print(json.dumps(results,indent=2,ensure_ascii=False))
sys.exit(0 if not results["blockers"] else 2)
