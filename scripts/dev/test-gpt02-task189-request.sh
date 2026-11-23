#!/usr/bin/env bash
# Full local request -> Unix issuer -> systemd encryption -> inbox -> receiver.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
p=$(mktemp -d /run/task189-request-test-XXXXXXXX)
base=${p##*/}
units=/run/systemd/system
broker_pid=
cleanup() {
  [[ -z $broker_pid ]] || kill "$broker_pid" 2>/dev/null || true
  systemctl stop "$base-request.path" "$base-inbox.path" "$base-request.service" \
    "$base-inbox.service" "$base-delivery.service" 2>/dev/null || true
  systemctl reset-failed "$base-request.service" "$base-inbox.service" "$base-delivery.service" 2>/dev/null || true
  rm -f "$units/$base-"{request.path,request.service,inbox.path,inbox.service,delivery.service}
  rm -rf "$p"
  systemctl daemon-reload
}
trap cleanup EXIT
install -d -m 0700 "$p/store" "$p/state" "$p/broker"
install -d -m 0500 -o 1000 -g 1000 "$p/target"
sed -e "s@/var/lib/gpt02-task189-request@$p/state@g" \
    -e "s@/etc/credstore.encrypted@$p/store@g" \
    -e "s@/run/cst-dev-task189-issuer@$p/broker@g" \
    "$repo/scripts/dev/gpt02-task189-request.py" > "$p/request.py"
sed "s@/run/ai-task-dev-scoped-preparation/task189@$p/target@g" \
    "$repo/scripts/dev/gpt02-task189-delivery.py" > "$p/delivery.py"
for unit in request.path request.service inbox.path inbox.service delivery.service; do
  sed -e "s@gpt02-task189-\(request\|inbox\|delivery\)\.@$base-\1.@g" \
      -e "s@/etc/credstore.encrypted@$p/store@g" \
      -e "s@/run/cst-dev-task189-issuer@$p/broker@g" \
      -e "s@/run/ai-task-dev-scoped-preparation/task189@$p/target@g" \
      -e "s@/usr/local/libexec/ai-task189-dev/request-package.py@$p/request.py@g" \
      -e "s@/usr/local/libexec/ai-task189-dev/deliver.py@$p/delivery.py@g" \
      -e "s@^StateDirectory=gpt02-task189-request@ReadWritePaths=$p/state@" \
      -e "s@RuntimeDirectory=ai-task189-delivery@RuntimeDirectory=$base-marker@" \
      "$repo/deploy/hostinger/gpt02-task189-$unit" > "$units/$base-$unit"
done
systemctl daemon-reload
systemctl start "$base-inbox.path" "$base-request.path"
for _ in {1..100}; do [[ -s "$p/state/request.json" ]] && break; sleep 0.1; done
grep -q '"status":"waiting_for_issuer"' "$p/state/request.json"
# Enroll a test-only socket after the durable request already exists.
python3 -IB - "$p" <<'PY' &
import json, os, sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import UnixStreamServer
root=Path(sys.argv[1])
class Grant(BaseHTTPRequestHandler):
    def do_GET(self):
        assert self.path == "/v1/database/creds/gpt02-task189-preparer"
        assert self.headers["X-CST-Request-ID"] == json.loads((root/"state"/"request.json").read_text())["id"]
        with (root/"calls").open("a") as count:
            count.write("1\n")
        body=json.dumps(dict(lease_id=self.path[4:]+"/fixture",lease_duration=120,
                        data=dict(username="gpt02_core_prep_login",password="test-only-#189"))).encode()
        self.send_response(200)
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args): pass
os.umask(0o177)
with UnixStreamServer(str(root/"broker"/"agent.sock"),Grant) as server: server.serve_forever()
PY
broker_pid=$!
for _ in {1..120}; do [[ -s "$p/target/task-preparer.json" ]] && break; sleep 0.1; done
test "$(stat -c '%a:%u:%g' "$p/target/task-preparer.json")" = 400:1000:1000
python3 -IB - "$p" <<'PY'
import json,sys
from pathlib import Path
from urllib.parse import unquote,urlsplit
p=Path(sys.argv[1]); record=json.loads((p/"state"/"request.json").read_bytes())
assert record["status"]=="published"
bundle=json.loads((p/"target"/"task-preparer.json").read_bytes())
dsn=urlsplit(bundle["connectionString"])
assert bundle["taskId"]==189 and bundle["companyId"]=="default" and unquote(dsn.password)=="test-only-#189"
assert b"test-only" not in (p/"store"/"gpt02-task189-preparer").read_bytes()
PY
systemctl start "$base-request.service"
test "$(wc -l < "$p/calls")" -eq 1
systemctl stop "$base-delivery.service"
test ! -e "$p/target/task-preparer.json"
echo 'Task 189 automatic request, issuance, encryption, delivery and replay check passed with an isolated issuer'
