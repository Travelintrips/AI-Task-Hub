#!/usr/bin/env bash
set -euo pipefail
# Fully isolated PostgreSQL. No network, no CST credentials, no live schema.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-approval-claim-test-$$"
WORK="$(mktemp -d)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=isolated-only postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 60); do
 if ! docker logs "$NAME" 2>&1 | grep -q 'PostgreSQL init process complete'; then sleep 1; continue; fi
 if docker exec "$NAME" psql -X -U postgres -d postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then ready=true; break; fi
 sleep 1
done
if [[ "$ready" != true ]]; then echo ISOLATED_POSTGRES_NOT_READY >&2; exit 2; fi
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q < "$ROOT/scripts/dev/gpt02-approval-nonce-isolated.sql"
C="gpt02_approval_test.consume_once"
cmd='28cbdd95-b19c-45b1-8ec8-ac3b1fef182e'
nonce='rQCfYm6TDsPvxgf9QEM3m8Rdpqba32Py'
call_sql="SELECT $C(136,'$cmd','$nonce','default')"
# Simulated separate restricted session authorization (only superuser test host).
check(){
 local name="$1" role="$2" sql="$3" expected="$4" actual
 actual="$(printf 'SET SESSION AUTHORIZATION %s; %s;\n' "$role" "$sql" |
   docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At | tail -n 1)"
 if [[ "$actual" != "$expected" ]]; then echo "FAIL:$name actual=$actual" >&2; exit 1; fi
 echo "PASS:$name"
}
check DENY_ATTESTOR_CANNOT_CONSUME gpt02_test_attestor "SELECT NOT has_function_privilege(current_user,'gpt02_approval_test.consume_once(integer,uuid,text,text)','EXECUTE')" t
check DENY_WRONG_COMPANY gpt02_test_issuer "SELECT $C(136,'$cmd','$nonce','other')" f
check DENY_WRONG_TASK gpt02_test_issuer "SELECT $C(138,'$cmd','$nonce','default')" f
check DENY_WRONG_COMMAND gpt02_test_issuer "SELECT $C(136,'817b62e6-b7fa-41ea-a4b3-2d1a6aa129d1','$nonce','default')" f
check DENY_TASK_135 gpt02_test_issuer "SELECT $C(135,'$cmd','$nonce','default')" f
check DENY_EXPIRED_APPROVAL gpt02_test_issuer "SELECT $C(137,'817b62e6-b7fa-41ea-a4b3-2d1a6aa129d1','AqZeh5Hx4TLY8CGg6VmHs2e7NpRVcm64','default')" f
check ISSUER_CANNOT_INSERT_APPROVAL gpt02_test_issuer "SELECT NOT has_table_privilege(current_user,'gpt02_approval_test.approved_commands','INSERT')" t
check ISSUER_CANNOT_CHANGE_CLAIM gpt02_test_issuer "SELECT NOT has_table_privilege(current_user,'gpt02_approval_test.nonce_claims','UPDATE')" t
check ATTESTOR_CANNOT_UPDATE_CLAIM gpt02_test_attestor "SELECT NOT has_table_privilege(current_user,'gpt02_approval_test.nonce_claims','UPDATE')" t
check ROLE_CANNOT_SWITCH_TO_ATTESTOR gpt02_test_issuer "SELECT NOT pg_has_role(current_user,'gpt02_test_attestor','MEMBER')" t
# Validate a true PostgreSQL client connection under distinct restricted logins,
# not only a superuser SET SESSION AUTHORIZATION simulation.
direct_issuer="$(docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U gpt02_test_issuer -d postgres -Atqc "SELECT current_user = session_user AND current_user = 'gpt02_test_issuer'")"
[[ "$direct_issuer" == t ]] || { echo "FAIL:DIRECT_ISSUER_LOGIN" >&2; exit 1; }
echo "PASS:DIRECT_ISSUER_LOGIN"
direct_attestor="$(docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U gpt02_test_attestor -d postgres -Atqc "SELECT current_user = session_user AND current_user = 'gpt02_test_attestor'")"
[[ "$direct_attestor" == t ]] || { echo "FAIL:DIRECT_ATTESTOR_LOGIN" >&2; exit 1; }
echo "PASS:DIRECT_ATTESTOR_LOGIN"
direct_privileges="$(docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U gpt02_test_issuer -d postgres -Atqc "SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb FROM pg_roles WHERE rolname=current_user")"
[[ "$direct_privileges" == t ]] || { echo "FAIL:DIRECT_ISSUER_NONPRIVILEGED" >&2; exit 1; }
echo "PASS:DIRECT_ISSUER_NONPRIVILEGED"
# Separate psql processes start as close together as the runtime permits.
for n in 1 2; do
 ( printf "SET SESSION AUTHORIZATION gpt02_test_issuer; %s;\n" "$call_sql" |
   docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At |
   tail -n 1 >"$WORK/result$n" ) &
done
wait
one="$(cat "$WORK/result1")"; two="$(cat "$WORK/result2")"
if [[ "$one$two" != "tf" && "$one$two" != "ft" ]]; then echo "FAIL:ATOMIC_RACE $one/$two" >&2; exit 1; fi
echo "PASS:ATOMIC_ONE_OF_TWO_CLAIMS"
check DENY_NONCE_REPLAY gpt02_test_issuer "$call_sql" f
actual="$(docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "SELECT count(*) FROM gpt02_approval_test.nonce_claims WHERE command_id='$cmd'")"
[[ "$actual" == 1 ]] || { echo "FAIL:CLAIM_LEDGER_DUPLICATE" >&2; exit 1; }
echo "PASS:SINGLE_PERSISTED_CLAIM"
echo "ISOLATED_NONCE_APPROVAL_16_CHECKS_PASS; LIVE_OPERATOR_APPROVAL_NOT_PROVEN; NATIVE_DISPATCH_NO_GO"
