#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="task183-attempt2-isolated-$$"
VOL="task183-attempt2-socket-$$"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$VOL" >/dev/null
docker run -d --name "$NAME" --network none --mount "type=volume,src=$VOL,dst=/var/run/postgresql" -e POSTGRES_PASSWORD=synthetic-only postgres:16-alpine -c unix_socket_directories=/var/run/postgresql >/dev/null
ready=false
for i in $(seq 1 50);do
 if docker logs "$NAME" 2>&1 |grep -q 'PostgreSQL init process complete' && docker exec "$NAME" psql -X -U postgres -Atqc 'select 1' >/dev/null 2>&1;then ready=true;break;fi
 sleep 1
done
test "$ready" = true
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -c 'CREATE DATABASE task183_attempt2_isolated' >/dev/null
pg(){ local who="$1";shift;docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$who" -d task183_attempt2_isolated "$@"; }
query(){ local who="$1";shift;pg "$who" -Atqc "$*"; }
pg postgres -q < "$ROOT/scripts/dev/gpt02-task183-attempt2-issuer-isolated.sql"
echo PASS:OFFLINE_POSTGRES16_OWNER_ROLE_AND_FENCES
old='11111111-1111-4111-8111-111111111111'
core='22222222-2222-4222-8222-222222222222'
hub='33333333-3333-4333-8333-333333333333'
candidate='44444444-4444-4444-8444-444444444444'
sha="$(printf '%064d' 1)"
# Verify a freshly signed synthetic Ed25519 Owner approval before inserting
# a TEST receipt. Never access any CST real signer keys or production roles.
fixture="$(node "$ROOT/scripts/dev/gpt02-task183-recovery-issuer-approval.fixture.mjs")"
digest="$(node -e 'const x=JSON.parse(process.argv[1]);if(x.verifiedFixture!==true||x.realOwnerApproved!==false||x.issuerAuthorized!==false||x.signerDomain!=="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"||!/^[a-f0-9]{64}$/.test(x.approvalDigest))process.exit(3);console.log(x.approvalDigest)' "$fixture")"
fp="$(node -e 'const x=JSON.parse(process.argv[1]);if(!/^[a-f0-9]{64}$/.test(x.signerFingerprint))process.exit(3);console.log(x.signerFingerprint)' "$fixture")"
read -r verified_owner verified_ms expires_ms < <(node -e '
 const r=JSON.parse(process.argv[1]);
 if (!/^owner:[A-Za-z0-9_-]+$/.test(r.ownerSubject) ||
     !Number.isSafeInteger(r.verifiedAt) || !Number.isSafeInteger(r.expiresAt) ||
     r.expiresAt <= r.verifiedAt) process.exit(3);
 console.log(r.ownerSubject,r.verifiedAt,r.expiresAt)' "$fixture")
echo PASS:SYNTHETIC_ED25519_RECEIPT_CRYPTOGRAPHICALLY_VERIFIED
receipt='55555555-5555-4555-8555-555555555555'
pg postgres -q -c "INSERT INTO isolated.old_preparations(company_id,hub_task_id,core_task_id,hub_execution_id,attempt_id,command_candidate_id,expires_at) VALUES('default',183,'$core','$hub','$old','$candidate',clock_timestamp()-interval '20 minutes')"
denied(){ local label="$1" actor="$2" sql="$3" term="$4" output; if output="$(query "$actor" "$sql" 2>&1)";then echo "FAIL:$label:accepted";exit 4;fi; [[ "$output" == *"$term"* ]] || { echo "FAIL:$label:$output";exit 4; }; echo "PASS:$label"; }
call="SELECT * FROM isolated.create_attempt2('default',183,'$old','$receipt','$sha')"
denied WITHOUT_SIGNED_OWNER_RECEIPT task183_recovery_issuer "$call" INDEPENDENT_SIGNED_OWNER_RECEIPT_REQUIRED
denied UNSCOPED_APP_CANNOT_ISSUE task183_untrusted_app "$call" 'permission denied'
denied VERIFIER_ROLE_CANNOT_ISSUE task183_recovery_verifier "$call" 'permission denied'
denied APP_CANNOT_INSERT_OWNER_RECEIPT task183_untrusted_app "INSERT INTO isolated.signed_owner_receipts DEFAULT VALUES" 'permission denied'
denied ISSUER_CANNOT_INSERT_OWNER_RECEIPT task183_recovery_issuer "INSERT INTO isolated.signed_owner_receipts DEFAULT VALUES" 'permission denied'
echo PASS:ISSUER_CANNOT_SELF_ASSERT_SIGNED_RECEIPT
denied ISSUER_CANNOT_DIRECTLY_CREATE_HUB task183_recovery_issuer "INSERT INTO isolated.hub_jobs DEFAULT VALUES" 'permission denied'
denied ISSUER_CANNOT_DIRECTLY_CREATE_CORE task183_recovery_issuer "INSERT INTO isolated.core_tasks DEFAULT VALUES" 'permission denied'
pg task183_recovery_verifier -q -c "INSERT INTO isolated.signed_owner_receipts(
 id,company_id,task_id,attempt_number,old_attempt_id,
 verified_original_evidence_sha256,signed_approval_digest,owner_subject,
 signer_public_fingerprint,signer_domain,verified_by,verified_at,expires_at)
 VALUES('$receipt','default',183,2,'$old','$sha','$digest','owner:synthetic-expired',
 '$fp','GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1',
 'independent_ed25519_owner_verifier',clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '8 minutes')"
denied EXPIRED_SIGNED_OWNER_RECEIPT task183_recovery_issuer "$call" INDEPENDENT_SIGNED_OWNER_RECEIPT_REQUIRED
pg postgres -q -c "DELETE FROM isolated.signed_owner_receipts WHERE id='$receipt'"
echo PASS:EXPIRED_SYNTHETIC_RECEIPT_NOT_CONSUMED
pg task183_recovery_verifier -q -c "INSERT INTO isolated.signed_owner_receipts(id,company_id,task_id,attempt_number,old_attempt_id,verified_original_evidence_sha256,signed_approval_digest,owner_subject,signer_public_fingerprint,signer_domain,verified_by,verified_at,expires_at) VALUES('$receipt','default',183,2,'$old','$sha','$digest','$verified_owner','$fp','GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1','independent_ed25519_owner_verifier',to_timestamp($verified_ms/1000.0),to_timestamp($expires_ms/1000.0))"
test "$(query postgres "SELECT count(*) FROM isolated.signed_owner_receipts WHERE id='$receipt' AND owner_subject='$verified_owner' AND expires_at=to_timestamp($expires_ms/1000.0)")" = 1
echo PASS:SIGNED_OWNER_AND_EXPIRY_PRESERVED
echo PASS:INDEPENDENT_VERIFIER_FIXTURE_RECEIPT_ONLY
denied WRONG_OLD_ATTEMPT_DENIED task183_recovery_issuer "SELECT * FROM isolated.create_attempt2('default',183,'$core','$receipt','$sha')" ORIGINAL_PREPARATION_NOT_SAFE
denied WRONG_OWNER_PROOF_DIGEST_DENIED task183_recovery_issuer "SELECT * FROM isolated.create_attempt2('default',183,'$old','$receipt','$digest')" INDEPENDENT_SIGNED_OWNER_RECEIPT_REQUIRED
denied FOREIGN_TENANT_DENIED task183_recovery_issuer "SELECT * FROM isolated.create_attempt2('foreign',183,'$old','$receipt','$sha')" EXACT_ISSUER_SCOPE_REQUIRED
denied WRONG_TASK_DENIED task183_recovery_issuer "SELECT * FROM isolated.create_attempt2('default',184,'$old','$receipt','$sha')" EXACT_ISSUER_SCOPE_REQUIRED
# Hold this isolated transaction past a deliberately short fixture expiry.
pg postgres -q <<'SQL'
CREATE FUNCTION isolated.delay_fixture_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$;
CREATE TRIGGER delay_test BEFORE INSERT ON isolated.core_tasks
FOR EACH ROW EXECUTE FUNCTION isolated.delay_fixture_insert();
SQL
pg postgres -q -c "UPDATE isolated.signed_owner_receipts SET expires_at=clock_timestamp()+interval '1 second' WHERE id='$receipt'"
denied EXPIRY_DURING_PREPARATION task183_recovery_issuer "$call" RECEIPT_CONSUMPTION_LOST
test "$(query postgres 'SELECT (SELECT count(*) FROM isolated.core_tasks)+(SELECT count(*) FROM isolated.hub_jobs)+(SELECT count(*) FROM isolated.issued_attempts)+(SELECT count(*) FROM isolated.signed_owner_receipts WHERE consumed_at IS NOT NULL)')" = 0
echo PASS:MID_TRANSACTION_EXPIRY_ROLLS_BACK_ALL_RECORDS
pg postgres -q -c "DROP TRIGGER delay_test ON isolated.core_tasks; DROP FUNCTION isolated.delay_fixture_insert(); UPDATE isolated.signed_owner_receipts SET expires_at=to_timestamp($expires_ms/1000.0) WHERE id='$receipt'"
for i in 1 2;do (query task183_recovery_issuer "$call" >/tmp/task183-race-"$NAME"-"$i" 2>/tmp/task183-race-"$NAME"-"$i".err || true) & done
wait
successes=0
for i in 1 2;do if test -s /tmp/task183-race-"$NAME"-"$i";then successes=$((successes+1));fi;done
test "$successes" = 1 || { echo "RACE_SUCCESS_COUNT=$successes";cat /tmp/task183-race-"$NAME"-*.err;exit 4; }
rm -f /tmp/task183-race-"$NAME"-*
test "$(query postgres 'SELECT count(*) FROM isolated.core_tasks')" = 1
test "$(query postgres 'SELECT count(*) FROM isolated.hub_jobs')" = 1
test "$(query postgres 'SELECT count(*) FROM isolated.issued_attempts')" = 1
echo PASS:CONCURRENT_ISSUERS_ONE_ATOMIC_CORE_HUB_ATTEMPT
test "$(query postgres "SELECT count(*) FROM isolated.issued_attempts WHERE dispatch_permitted=false")" = 1
test "$(query postgres "SELECT count(*) FROM isolated.hub_jobs WHERE worker_id IS NULL AND command_id IS NULL AND dispatch_started=false")" = 1
test "$(query postgres "SELECT count(*) FROM isolated.core_tasks WHERE worker_id IS NULL AND command_id IS NULL AND status='PENDING'")" = 1
test "$(query postgres "SELECT count(*) FROM isolated.signed_owner_receipts WHERE consumed_at IS NOT NULL")" = 1
echo PASS:NEW_ATTEMPT_PREPARED_ONLY_NO_DISPATCH
denied REPLAY_ISSUER_DENIED task183_recovery_issuer "$call" ORIGINAL_PREPARATION_NOT_SAFE
denied UPDATE_ISSUED_EVIDENCE_DENIED postgres "UPDATE isolated.issued_attempts SET dispatch_permitted=true" APPEND_ONLY_RECOVERY_EVIDENCE
denied DELETE_ISSUED_EVIDENCE_DENIED postgres "DELETE FROM isolated.issued_attempts" APPEND_ONLY_RECOVERY_EVIDENCE
test "$(query postgres 'SELECT count(*) FROM isolated.old_preparations')" = 1
echo PASS:OLD_ATTEMPT_HISTORY_UNCHANGED
echo SYNTHETIC_RECEIPT_ONLY_NOT_A_REAL_OWNER_APPROVAL=TRUE
echo REAL_CST_DEV_AND_PROD_UNCHANGED=TRUE
