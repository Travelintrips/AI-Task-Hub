#!/usr/bin/env python3
"""Task183 exact real schema + real writer isolated integration; NEVER real approvals.

Copies only sqlite_master table/trigger DDL from the live read-only database
into a temporary DB. Inserts synthetic actor mapping and calls the actual
writer operational=False. Verifies immutable outbox matching, replay rejection,
and zero writes to the live approval database.
"""
import importlib.util, sqlite3, tempfile, time, uuid
from pathlib import Path
ROOT=Path("/opt/ai-coding-standalone-dev/qa")
LIVE=Path("/opt/ai-coding-standalone-dev/tasks.db")
p=ROOT/"task183-owner-approval-writer-dev.py"
spec=importlib.util.spec_from_file_location("writer",p)
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
n=0
def check(name,yes):
 global n
 assert yes,name
 n+=1;print("PASS:"+name,flush=True)
with sqlite3.connect("file:"+str(LIVE)+"?mode=ro",uri=True) as read:
 read.execute("PRAGMA query_only=ON")
 tables=["admin_identities","gpt02_issue159_admin_operator_links",
         "gpt02_task183_owner_recovery_decisions","gpt02_task183_owner_recovery_outbox"]
 ddl={t:read.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",(t,)).fetchone()[0] for t in tables}
 triggers=[x[0] for x in read.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('gpt02_task183_owner_recovery_decisions','gpt02_task183_owner_recovery_outbox') AND sql IS NOT NULL")]
 before=tuple(read.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in tables[2:])
check("LIVE_OWNER_TABLES_EMPTY",before==(0,0))
with tempfile.TemporaryDirectory(prefix="task183-real-schema-writer-") as td:
 db=Path(td)/"isolated.sqlite"
 con=sqlite3.connect(db)
 for t in tables:con.execute(ddl[t])
 for sql in triggers:con.execute(sql)
 uid="00000000-1111-4222-8333-000000000183"
 operator="google_synthetic183"
 email="synthetic183@example.invalid"
 admin_columns={row[1] for row in con.execute("PRAGMA table_info(admin_identities)")}
 link_columns={row[1] for row in con.execute("PRAGMA table_info(gpt02_issue159_admin_operator_links)")}
 print("ADMIN_COLUMNS",sorted(admin_columns))
 print("LINK_COLUMNS",sorted(link_columns))
 def insert(name,values):
  cols=list(values)
  con.execute(f"INSERT INTO {name} ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})",[values[c] for c in cols])
 insert("admin_identities",{"user_id":uid,"role":"super_admin","enabled":1})
 insert("gpt02_issue159_admin_operator_links",{"auth_user_id":uid,"hub_operator_id":operator,"email":email,"enabled":1})
 con.commit()
 now=int(time.time()*1000)
 actor={"id":operator,"authSupabaseId":uid,"email":email,"role":"super_admin","companyId":"default","authSource":"supabase_google_identity","authVerifiedAt":now}
 evidence={"requestId":w.REQUEST,"evidenceSha256":w.SHA,"originalCoreTaskId":str(uuid.uuid4()),"originalHubExecutionId":str(uuid.uuid4()),"originalAttemptId":str(uuid.uuid4())}
 try:
  outcome=w.record(actor=actor,evidence=evidence,explicit_action=True,db_path=db,operational=False,now_ms=now,nonce="N"*48)
  check("ACTUAL_WRITER_ATOMIC_DECISION_AND_OUTBOX",outcome["recorded"] and outcome["ownerDecisionStored"])
  rows=con.execute("SELECT COUNT(*) FROM gpt02_task183_owner_recovery_decisions").fetchone()[0],con.execute("SELECT COUNT(*) FROM gpt02_task183_owner_recovery_outbox").fetchone()[0]
  check("ONE_TO_ONE_PERSISTENCE",rows==(1,1))
  reader_path=ROOT/"task183-owner-recovery-decision-reader.py"
  reader_spec=importlib.util.spec_from_file_location("real_reader",reader_path)
  rr=importlib.util.module_from_spec(reader_spec);reader_spec.loader.exec_module(rr)
  lookup={"claimsSha256":outcome["claimsSha256"],"taskId":183,
          "requestId":w.REQUEST,"evidenceSha256":w.SHA,
          "ownerSubject":"owner:"+operator,"nonce":"N"*48,
          "observedAt":now}
  readback=rr.read_decision(lookup,db_path=str(db),operational=False,now=now)
  check("REAL_READER_ACCEPTS_REAL_WRITER_OUTPUT",
        readback.get("ok") is True and readback.get("persistedIndependentOwnerDecision") is True)
  adapter_path=ROOT/"task183-independent-owner-adapter.candidate.py"
  adapter_spec=importlib.util.spec_from_file_location("real_adapter",adapter_path)
  adapter=importlib.util.module_from_spec(adapter_spec);adapter_spec.loader.exec_module(adapter)
  resolved=adapter.authorize_recovery(claims=outcome["claims"],now_ms=now,db_path=db,operational=False)
  check("FULL_CANONICAL_CLAIMS_ACCEPTED_BY_REAL_OWNER_ADAPTER",
        resolved.get("decisionProvenanceVerified") is True and resolved.get("approvalDigest")==outcome["claimsSha256"])
  resolver_path=ROOT/"task183-resolve-approved-claims.readonly.candidate.py"
  resolver_spec=importlib.util.spec_from_file_location("claims_resolver",resolver_path)
  resolver=importlib.util.module_from_spec(resolver_spec);resolver_spec.loader.exec_module(resolver)
  review={"readOnly":True,"evidenceSha256":w.SHA,"evidence":{
   "requestId":w.REQUEST,"coreTaskId":evidence["originalCoreTaskId"],
   "hubExecutionId":evidence["originalHubExecutionId"],
   "originalAttemptId":evidence["originalAttemptId"]}}
  result=resolver.reconstruct(operational=False,approval_path=db,review_packet=review,now_ms=now)
  check("READONLY_APPROVED_CLAIMS_RECONSTRUCTED",result["claims"]==outcome["claims"] and result["claimsSha256"]==outcome["claimsSha256"])
  try:resolver.reconstruct(operational=False,approval_path=db,review_packet={**review,"evidenceSha256":"0"*64},now_ms=now)
  except ValueError:check("MUTATED_REVIEW_EVIDENCE_REJECTED",True)
  else:check("MUTATED_REVIEW_EVIDENCE_REJECTED",False)

  mutated={**outcome["claims"],"originalAttemptId":str(uuid.uuid4())}
  try:adapter.authorize_recovery(claims=mutated,now_ms=now,db_path=db,operational=False)
  except adapter.AuthorizationDenied:check("ALTERED_ORIGINAL_ATTEMPT_DENIED",True)
  else:check("ALTERED_ORIGINAL_ATTEMPT_DENIED",False)


  try:w.record(actor=actor,evidence=evidence,explicit_action=True,db_path=db,operational=False,now_ms=now,nonce="M"*48)
  except Exception:check("REPLAY_REJECTED",True)
  else:check("REPLAY_REJECTED",False)
  check("NO_ISSUER_DISPATCH",outcome["issuerAuthorized"] is False and outcome["dispatchPermitted"] is False)
 finally:con.close()
with sqlite3.connect("file:"+str(LIVE)+"?mode=ro",uri=True) as read:
 read.execute("PRAGMA query_only=ON")
 after=tuple(read.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in tables[2:])
check("LIVE_APPROVAL_DB_UNCHANGED",after==before)
print(f"RESULT={n}/{n} PASS")
print("REAL_OWNER_DECISION_CREATED=FALSE")
