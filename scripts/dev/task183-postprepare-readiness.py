#!/usr/bin/env python3
"""Read-only CST-DEV Task183 post-preparation release gate, no secrets or writes.

This checker deliberately refuses to infer any Owner approval from PREPARED.
It never refreshes expiry, grants a signer, or dispatches a command.
"""
import json,os,subprocess,sys

CONTAINER='ai-task-dev-main-directdb-qa-20261121'
JS=r"""
const{Client}=require('/app/artifacts/api-server/node_modules/pg');
const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,connectionTimeoutMillis:7000,query_timeout:7000,application_name:'task183-readonly-postprepare-gate'});
(async()=>{
try{
 await c.connect(); await c.query('BEGIN READ ONLY');
 await c.query('SET LOCAL statement_timeout=6000');
 const rows=await c.query(`
 WITH p AS (
  SELECT hub_task_id,core_task_id,hub_execution_id,command_candidate_id,
         attempt_id,expires_at,created_at
  FROM gpt02_stage.core_preparations WHERE hub_task_id=$1
 ), q AS (
  SELECT count(*)::int AS prepared_count FROM p
 )
 SELECT
  (SELECT prepared_count FROM q) AS preparations,
  (SELECT count(*)::int FROM public.ai_execution_jobs WHERE task_id=$1) AS hub_jobs,
  (SELECT count(*)::int FROM public.ai_execution_jobs e JOIN p ON e.id=p.hub_execution_id AND e.task_id=p.hub_task_id AND e.status='prepared') AS matching_hub_prepared,
  (SELECT count(*)::int FROM ai_platform.ai_coding_tasks t JOIN p ON t.id=p.core_task_id AND t.status='PENDING') AS matching_core_pending,
  (SELECT count(*)::int FROM ai_platform.ai_coding_bridge_commands cmd JOIN p ON cmd.id=p.command_candidate_id AND cmd.task_id=p.core_task_id) AS official_command,
  (SELECT count(*)::int FROM ai_platform.ai_coding_critical_approvals a JOIN p ON a.task_id=p.core_task_id AND a.command_id=p.command_candidate_id AND lower(a.status)='approved' AND a.expires_at>clock_timestamp()) AS valid_command_approvals,
  (SELECT count(*)::int FROM ai_platform.dev_gpt02_task_attempt_binding_claims b JOIN p ON b.hub_ai_task_id=p.hub_task_id AND b.hub_execution_job_id=p.hub_execution_id AND b.attempt_id=p.attempt_id AND b.binding_verified IS TRUE) AS verified_bindings,
  (SELECT bool_and(expires_at>clock_timestamp()) FROM p) AS reservation_current,
  (SELECT min(expires_at) FROM p) AS reservation_expiry_utc,
  (SELECT NOT rolcanlogin AND rolconnlimit=0 FROM pg_roles WHERE rolname='gpt02_core_prep_login') AS preparer_locked,
  (SELECT count(*)::int FROM pg_stat_activity WHERE usename='gpt02_core_prep_login') AS preparer_sessions
 `,[183]);
 await c.query('ROLLBACK');
 console.log(JSON.stringify(rows.rows[0]));
}catch(e){
 console.log(JSON.stringify({probe_error: e.code||e.name||'UNKNOWN'}));
 process.exitCode=3;
}finally{await c.end().catch(()=>{})}
})();
"""

def classify(r):
    if 'probe_error' in r:return 'NO_GO_QUERY_UNAVAILABLE'
    required=('preparations','hub_jobs','matching_hub_prepared','matching_core_pending',
              'official_command','valid_command_approvals','verified_bindings',
              'reservation_current','preparer_locked','preparer_sessions')
    if any(k not in r for k in required):return 'NO_GO_MISSING_PROOF'
    if r['preparer_locked'] is not True or r['preparer_sessions']!=0:
        return 'NO_GO_PREPARER_NOT_RELOCKED'
    if r['preparations']!=1 or r['hub_jobs']!=1 or r['matching_hub_prepared']!=1 or r['matching_core_pending']!=1:
        return 'NO_GO_PREPARATION_LINEAGE_MISMATCH'
    if r['reservation_current'] is not True:return 'NO_GO_RESERVATION_EXPIRED'
    if r['official_command']!=1:return 'NO_GO_OFFICIAL_COMMAND_MISSING'
    if r['verified_bindings']!=1:return 'NO_GO_IMMUTABLE_ATTEMPT_BINDING_MISSING'
    if r['valid_command_approvals']!=1:return 'NO_GO_COMMAND_BOUND_OWNER_APPROVAL_MISSING'
    return 'READY_FOR_INDEPENDENT_ISSUER_CHECK_ONLY'

def main():
    if os.geteuid()!=0:
        print('NO_GO_ROOT_REQUIRED');return 3
    proc=subprocess.run(['docker','exec',CONTAINER,'node','-e',JS],capture_output=True,text=True,timeout=22)
    try:
        r=json.loads(proc.stdout)
    except Exception:
        r={'probe_error':'INVALID_OR_MISSING_READBACK'}
    status=classify(r)
    print(json.dumps({'project':'CST-DEV','hub_task':183,'proof':r,'status':status,
      'dispatch_authorized':False,'owner_approval_created':False,
      'writes_performed':False},indent=2,default=str))
    return 0 if status=='READY_FOR_INDEPENDENT_ISSUER_CHECK_ONLY' and proc.returncode==0 else 2
if __name__=='__main__':sys.exit(main())
