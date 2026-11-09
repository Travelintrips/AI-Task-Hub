#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-outcome-read-$$"; WORK="$(mktemp -d)"; CREATED=false
trap 'if [[ "$CREATED" == true ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi; rm -rf "$WORK"' EXIT
node - "$ROOT" "$WORK/query.sql" <<'NODE'
const fs=require('node:fs'),path=require('node:path');const root=process.argv[2];const s=fs.readFileSync(path.join(root,'artifacts/api-server/src/routes/executions.ts'),'utf8');const start=s.indexOf('router.get("/ai-tasks/:id/gpt02-lineage"');const a=s.indexOf('SELECT t.id AS task_id',start),b=s.indexOf('    `);',a);if(a<0||b<a)throw Error('EXACT_QUERY_NOT_FOUND');const q=s.slice(a,b).replaceAll('${taskId}','$1').replaceAll('${companyId}','$2');if(/\b(INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\b/i.test(q))throw Error('NOT_READONLY');const fn='CREATE FUNCTION outcome_query(integer,text) RETURNS SETOF jsonb LANGUAGE sql AS $query$ SELECT to_jsonb(x) FROM ('+q+') x $query$;';const fixture=fs.readFileSync(path.join(root,'scripts/dev/gpt02-outcome-fixture.sql'),'utf8');fs.writeFileSync(process.argv[3],fixture.replace('-- QUERY_FUNCTION',()=>fn));
NODE
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=synthetic-only postgres:16-alpine >/dev/null; CREATED=true
ready=false
for i in $(seq 1 35); do
 if docker logs "$NAME" 2>&1 | grep -F 'PostgreSQL init process complete' >/dev/null && docker exec "$NAME" psql -X -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -Fx 1 >/dev/null; then ready=true; break; fi
 sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_POSTGRES_NOT_READY >&2; exit 2; }
docker exec -i "$NAME" psql -X -U postgres -v ON_ERROR_STOP=1 -q < "$WORK/query.sql"
echo 'GPT02_OUTCOME_EXACT_SQL_PASS; NO_LIVE_MUTATION_OR_DISPATCH'
