#!/usr/bin/env bash
# PR196: exact OCI image + ephemeral real PostgreSQL 17 read-only HTTP E2E.
# CI-only, synthetic identity and database; no live Supabase, WA, PROD or secrets.
set -euo pipefail
test "$GITHUB_EVENT_NAME" = "pull_request"
test "$GITHUB_HEAD_REF" = "test/dev-pr193-pr195-integrated-20261115"
test "$(git rev-parse HEAD)" = "$EXPECTED_HEAD_SHA"
test -s scripts/dev/fixtures/pr196-gpt02-prepared-review.sql
test -n "$GITHUB_RUN_ID"
image=ai-task-pr196:synthetic
net="pr196-review-ci-$GITHUB_RUN_ID"
pg="pr196-review-pg-$GITHUB_RUN_ID"
api="pr196-review-api-$GITHUB_RUN_ID"
docker image inspect "$image" >/dev/null
cleanup() {
  docker rm -f "$api" >/dev/null 2>&1 || true
  docker rm -f "$pg" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal --driver bridge "$net" >/dev/null
test "$(docker network inspect "$net" -f '{{.Internal}}')" = true
if ! docker image inspect postgres:17-alpine >/dev/null 2>&1; then
  docker pull postgres:17-alpine
fi
docker run -d --name "$pg" --network "$net" --network-alias synthetic-pg \
  --restart no --memory 512m --memory-swap 512m --pids-limit 100 \
  --security-opt no-new-privileges \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=256m \
  --env POSTGRES_PASSWORD=fixture_only_not_real_9713d371 \
  --env POSTGRES_DB=smoke \
  postgres:17-alpine >/dev/null
for i in $(seq 1 35); do
  if docker exec "$pg" pg_isready -U postgres -d smoke >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$pg" pg_isready -U postgres -d smoke >/dev/null
docker exec -i "$pg" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d smoke \
  < scripts/dev/fixtures/pr196-gpt02-prepared-review.sql
test -z "$(docker port "$pg")"
echo "SYNTHETIC_PG17_INTERNAL_ONLY_PASS"

docker run -d --name "$api" --network "$net" --restart no \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=32m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 1024m --memory-swap 1024m --cpus 1.5 --pids-limit 128 \
  --env NODE_ENV=development \
  --env APP_ENV=development \
  --env HOST=127.0.0.1 --env PORT=8080 \
  --env SESSION_SECRET=synthetic_pr196_9713d371_fixture_only_no_real_session_xxxxx \
  --env PUBLIC_APP_BASE_URL=https://dev-ai-task.cstlogistic.co.id \
  --env CORS_ALLOWED_ORIGINS=http://127.0.0.1:8080 \
  --env SUPABASE_DATABASE_URL_DEV=postgresql://postgres:fixture_only_not_real_9713d371@synthetic-pg:5432/smoke \
  --env DB_SSL=false --env DB_CONNECTION_TIMEOUT_MS=2000 --env DB_POOL_MAX=2 \
  --env SUPABASE_URL_DEV=https://synthetic.invalid \
  --env DEV_PASSWORDLESS_LOGIN=true \
  --env DISABLE_BACKGROUND_SCHEDULERS=true \
  --env RUN_STARTUP_MIGRATIONS=false \
  --env AI_CORE_JOB_WA_ENABLED=false \
  --env GPT02_CORE_PREPARATION_ENABLED=false \
  --env AI_TASK_DEV_SOURCE_RECONCILE_ENABLED=false \
  --env DISABLE_STORAGE_BUCKET_AUTO_CREATE=true \
  --env VPS_STORAGE_INVENTORY_READONLY_ENABLED=false \
  --env LOG_LEVEL=error \
  "$image" >/dev/null
test "$(docker inspect "$api" -f '{{.HostConfig.ReadonlyRootfs}}')" = true
test "$(docker inspect "$api" -f '{{.HostConfig.NetworkMode}}')" = "$net"
test -z "$(docker port "$api")"
for i in $(seq 1 35); do
  if docker exec "$api" node -e \
    "fetch('http://127.0.0.1:8080/api/readyz',{signal:AbortSignal.timeout(1200)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(2))" >/dev/null 2>&1; then break; fi
  if test "$(docker inspect "$api" -f '{{.State.Running}}')" != true; then
    echo "SYNTHETIC_API_EXITED" >&2
    exit 2
  fi
  sleep 1
done
docker exec "$api" node -e \
  "fetch('http://127.0.0.1:8080/api/readyz',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(2))"
echo "SYNTHETIC_API_DB_READY_PASS"

snapshot() {
  docker exec "$pg" psql -XAtq -U postgres -d smoke -c "
    SELECT md5(
      COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id)::text FROM public.ai_execution_jobs e),'[]')||
      COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.hub_task_id)::text FROM gpt02_stage.core_preparations s),'[]')||
      COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id)::text FROM ai_platform.ai_coding_tasks c),'[]')||
      COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text FROM public.ai_tasks t),'[]')||
      COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM public.audit_logs a),'[]')||
      (SELECT count(*)::text FROM public.ai_execution_events)||
      (SELECT count(*)::text FROM ai_platform.ai_coding_bridge_commands)||
      (SELECT count(*)::text FROM gpt02_private.approvals)||
      (SELECT count(*)::text FROM ai_platform.gpt02_dev_command_archive_20261030)
    );"
}
check() {
  local expected="$1"
  local match_count="$2"
  local technical_expected="$3"
  local expected_link_count="$4"
  docker exec -i "$api" node - "$expected" "$match_count" "$technical_expected" "$expected_link_count" <<'NODE'
const assert=require("node:assert/strict");
const jwt=require("/app/artifacts/api-server/node_modules/jsonwebtoken");
const base="http://127.0.0.1:8080";
const token=(role)=>jwt.sign({
  id:"synthetic-nonexistent-subject",email:"synthetic@example.invalid",
  role,companyId:"default",name:"Synthetic reviewer",
},process.env.SESSION_SECRET,{expiresIn:"2m"});
const path="/api/ai-tasks/171/gpt02-reconciliation?companyId=default";
async function get(url,jwtText,expected) {
  const r=await fetch(base+url,{headers:jwtText?{Authorization:"Bearer "+jwtText}:{},
    redirect:"manual",signal:AbortSignal.timeout(4500)});
  assert.equal(r.status,expected,url);
  return expected===200?r.json():null;
}
(async()=>{
  await get(path,null,401);
  await get(path,token("staff"),403);
  const identityPath="/api/auth/gpt02/operator-session-readiness";
  await get(identityPath,null,401);
  await get(identityPath,token("staff"),403);
  const legacyIdentity=await get(identityPath,token("super_admin"),200);
  assert.equal(legacyIdentity.googleProofFresh,false);
  assert.equal(legacyIdentity.googleProofStatus,"SIGNED_SESSION_GOOGLE_CLAIMS_ABSENT");
  assert.equal(legacyIdentity.requiresFreshGoogleLogin,true);
  assert.equal(legacyIdentity.readOnly,true);
  assert.equal(legacyIdentity.operatorApprovalRecorded,false);
  assert.equal(legacyIdentity.dispatchPermitted,false);
  assert.equal("authSupabaseId" in legacyIdentity,false);
  assert.equal("token" in legacyIdentity,false);
  const googleClaims={
    id:"synthetic-nonexistent-subject",email:"synthetic@example.invalid",
    role:"super_admin",companyId:"default",name:"Synthetic reviewer",
    authSource:"supabase_google_identity",
    authSupabaseId:"12345678-1234-4234-8234-123456789abc",
  };
  const freshGoogle=jwt.sign({...googleClaims,authVerifiedAt:Date.now()},
    process.env.SESSION_SECRET,{expiresIn:"2m"});
  const freshIdentity=await get(identityPath,freshGoogle,200);
  assert.equal(freshIdentity.googleProofFresh,true);
  assert.equal(freshIdentity.googleProofStatus,"SIGNED_SESSION_GOOGLE_PROOF_FRESH");
  assert.equal(freshIdentity.requiresFreshGoogleLogin,false);
  for(const flag of ["readOnly"])assert.equal(freshIdentity[flag],true);
  for(const flag of ["operatorApprovalRecorded","commandBoundConsentVerified",
    "issuerLeaseGranted","dispatchPermitted","resumePermitted","statusChanged"])
    assert.equal(freshIdentity[flag],false,flag);
  const staleGoogle=jwt.sign({...googleClaims,authVerifiedAt:Date.now()-11*60_000},
    process.env.SESSION_SECRET,{expiresIn:"2m"});
  const staleIdentity=await get(identityPath,staleGoogle,200);
  assert.equal(staleIdentity.googleProofFresh,false);
  assert.equal(staleIdentity.googleProofStatus,"SIGNED_SESSION_GOOGLE_PROOF_EXPIRED");
  const invalidGoogle=jwt.sign({...googleClaims,authVerifiedAt:"invalid"},
    process.env.SESSION_SECRET,{expiresIn:"2m"});
  const invalidIdentity=await get(identityPath,invalidGoogle,200);
  assert.equal(invalidIdentity.googleProofStatus,"SIGNED_SESSION_GOOGLE_PROOF_INVALID");
  console.log("PR196_NO_SECRET_GOOGLE_SESSION_STATUS_HTTP_PASS");
  const r=await get(path,token("super_admin"),200);
  assert.equal(r.taskId,171);
  assert.equal(r.status,"prepared");
  assert.equal(r.reviewReason,process.argv[2]);
  assert.equal(r.matchCount,Number(process.argv[3]));
  assert.equal(r.preparationExpired,true);
  assert.equal(r.coreStatus,"PENDING");
  assert.equal(r.independentReviewRequired,true);
  assert.equal(r.evidenceComplete,r.reviewReason==="EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW");
  assert.equal(r.uniqueCommandMatch,false);
  assert.equal(r.archiveChecked,false);
  assert.equal(r.recoveryDecision.technicalEvidenceReviewed,process.argv[4]==="true");
  assert.equal(r.recoveryDecision.historicalReservationPreserved,true);
  assert.equal(r.recoveryDecision.sameTaskRepreparePermitted,false);
  assert.equal(r.recoveryDecision.newTaskCreated,false);
  assert.equal(r.recoveryDecision.approvalRecorded,false);
  assert.equal(r.recoveryDecision.secondHumanAdminApprovalRequired,false);
  assert.equal(r.recoveryDecision.singleOwnerApprovalRequiredForExecution,true);
  assert.equal(r.recoveryDecision.issuerVerificationStillRequired,true);
  assert.equal(r.recoveryDecision.archiveChecked,true);
  assert.equal(r.recoveryDecision.immutableTriggerVerified,true);
  assert.equal(r.recoveryDecision.dispatchPermitted,false);
  assert.equal(r.recoveryDecision.resumePermitted,false);
  assert.equal(r.recoveryDecision.readOnly,true);
  const linkedCount=Number(process.argv[5]);
  assert.equal(r.recoveryDecision.linkedTaskCount,linkedCount);
  assert.equal(r.recoveryDecision.linkedTaskCreatedByThisRead,false);
  if (linkedCount===1) {
    assert.equal(r.recoveryDecision.linkedTaskId,183);
    assert.equal(r.recoveryDecision.linkedTaskNumber,"WA-2611-7669");
    assert.equal(r.recoveryDecision.linkedTaskStatus,"new_inquiry");
    assert.equal(r.recoveryDecision.linkedTaskPicAssigned,false);
    assert.equal(r.recoveryDecision.nextAction,
      r.recoveryDecision.technicalEvidenceReviewed ?
      "LINKED_DEV_TASK_EXISTS_AWAITING_VERIFIED_PIC":"HOLD_NO_REPLAY");
  } else if (linkedCount===2) {
    assert.equal(r.recoveryDecision.linkedTaskId,null);
    assert.equal(r.recoveryDecision.nextAction,
      r.recoveryDecision.technicalEvidenceReviewed ?
      "HOLD_MULTIPLE_LINKED_DEV_TASKS":"HOLD_NO_REPLAY");
  }
  for(const flag of ["readOnly"])assert.equal(r[flag],true);
  for(const flag of ["automaticDispatch","statusChanged","dispatchPermitted",
                     "resumePermitted","operatorApprovalGranted"])
    assert.equal(r[flag],false,flag);
  await get("/api/ai-tasks/171/gpt02-reconciliation?companyId=other",token("super_admin"),404);
  await get("/api/ai-tasks/172/gpt02-reconciliation?companyId=default",token("super_admin"),404);
  // The old 7-day DEV email-only JWT may still exist in a browser. It must
  // NEVER authorize new GPT02 edits, even when role=super_admin is signed.
  // These are isolated JWT fixtures, not a real user's credentials.
  const legacy=token("super_admin");
  for(const endpoint of [
    "/api/ai-tasks/171/gpt02-adopt-existing?companyId=default",
    "/api/ai-tasks/171/gpt02-assign-pic?companyId=default",
    "/api/ai-tasks/171/gpt02-confirm-recovery-pic?companyId=default",
    "/api/ai-tasks/171/gpt02-prepare?companyId=default",
    "/api/ai-tasks/171/gpt02-replace-historical-reference?companyId=default",
  ]) {
    const blocked=await fetch(base+endpoint,{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+legacy},
      body:"{}",redirect:"manual",signal:AbortSignal.timeout(4000),
    });
    assert.equal(blocked.status,403,"Legacy JWT must be denied on "+endpoint);
    const body=await blocked.json();
    assert.equal(body.error,"GPT02_FRESH_GOOGLE_OPERATOR_REQUIRED",endpoint);
    assert.equal(body.dispatchPermitted,false,endpoint);
  }
  console.log("PR196_LEGACY_EMAIL_ONLY_SUPERADMIN_JWT_WRITE_DENIED_PASS");
  // Synthetic authenticated Google-shaped claims prove the gate can admit
  // an identity, while the independent execution status still blocks writes.
  const proven=jwt.sign({
    id:"synthetic-nonexistent-subject",email:"synthetic@example.invalid",
    role:"super_admin",companyId:"default",name:"Synthetic reviewer",
    authSource:"supabase_google_identity",
    authSupabaseId:"12345678-1234-4234-8234-123456789abc",
    authVerifiedAt:Date.now(),
  },process.env.SESSION_SECRET,{expiresIn:"2m"});
  const noReplay=await fetch(base+"/api/ai-tasks/171/gpt02-adopt-existing?companyId=default",{
    method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+proven},
    body:"{}",redirect:"manual",signal:AbortSignal.timeout(4000),
  });
  assert.equal(noReplay.status,409);
  const noReplayResponse=await noReplay.json();
  assert.equal(noReplayResponse.error,"EXECUTION_NOT_ELIGIBLE");
  console.log("PR196_FRESH_GOOGLE_SHAPED_SYNTHETIC_JWT_STILL_CANNOT_REPLAY_PASS");

  const badLogin=await fetch(base+"/api/auth/login",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:"synthetic@example.invalid"}),
    signal:AbortSignal.timeout(4000)});
  assert.equal(badLogin.status,403);
  console.log("PR196_SYNTHETIC_HTTP_PASS_REVIEW="+r.reviewReason+" COMMANDS="+r.matchCount);
})().catch(error=>{console.error("PR196_SYNTHETIC_E2E_FAILED:"+error.message);process.exitCode=1});
NODE
}
before=$(snapshot)
echo "$before" | grep -Eq '^[a-f0-9]{32}$'
check EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW 0 true 1
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c \
  "INSERT INTO gpt02_private.approvals(company_id,task_id) VALUES ('default',171);"
check PREPARED_RESERVATION_CONFLICTING_EVIDENCE 0 false 1
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c \
  "DELETE FROM gpt02_private.approvals WHERE company_id='default' AND task_id=171;"
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c \
  "INSERT INTO ai_platform.ai_coding_bridge_commands(id,task_id) VALUES ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222');"
check PREPARED_RESERVATION_CONFLICTING_EVIDENCE 1 false 1
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c \
  "DELETE FROM ai_platform.ai_coding_bridge_commands WHERE id='33333333-3333-4333-8333-333333333333';"
check EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW 0 true 1
# An archived command is independent evidence; never mistake zero live
# commands for a clean review if the old command is present in the archive.
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c   "INSERT INTO ai_platform.gpt02_dev_command_archive_20261030(command_id,command_record)
   VALUES ('33333333-3333-4333-8333-333333333333','{}'::jsonb);"
check EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW 0 false 1
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c   "DELETE FROM ai_platform.gpt02_dev_command_archive_20261030;"
check EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW 0 true 1
# Duplicate linked tasks MUST NOT be auto-selected or considered readiness.
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c \
  "INSERT INTO public.ai_tasks(id,company_id,task_number,source,status,title,description)
   VALUES (184,'default','WA-2611-7777','manual','new_inquiry',
   '[INTERNAL-E2E] GPT02 DEV linked Task171 replacement test-duplicate',
   'Synthetic duplicate. Linked historical Task #171 (WA-2611-7621). GPT02_DEV_E2E_LINKED_171_ACK.');"
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c \
  "INSERT INTO public.audit_logs(id,company_id,entity_id,action,module)
   VALUES (1000,'default','184','task_created','tasks');"
check EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW 0 true 2
docker exec "$pg" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d smoke -c \
  "DELETE FROM public.audit_logs WHERE id=1000; DELETE FROM public.ai_tasks WHERE id=184;"
check EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW 0 true 1
after=$(snapshot)
test "$before" = "$after"
echo "PR196_POSTGRES17_BUSINESS_STATE_IDENTICAL_PASS"
echo "PR196_NO_EXTERNAL_NETWORK_NO_PROD_NO_WA_NO_DISPATCH_PASS"
