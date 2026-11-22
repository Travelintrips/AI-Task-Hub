#!/usr/bin/env bash
# Exercise the installed event semantics using independent fixture units in /run.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d /run/gpt02-inbox-test-XXXXXXXX)
base=${fixture##*/}
units=/run/systemd/system
package=$fixture/package
delivery=$base-delivery.service
inbox=$base-inbox
cleanup() {
  systemctl stop "$inbox.path" "$inbox.service" "$delivery" 2>/dev/null || true
  systemctl reset-failed "$inbox.path" "$inbox.service" "$delivery" 2>/dev/null || true
  rm -f "$units/$inbox.path" "$units/$inbox.service" "$units/$delivery"
  rm -rf "$fixture"
  systemctl daemon-reload
}
trap cleanup EXIT
for suffix in path service; do
  sed -e "s@/etc/credstore.encrypted/gpt02-task189-preparer@$package@g" \
      -e "s/gpt02-task189-delivery.service/$delivery/g" \
      "$repo/deploy/hostinger/gpt02-task189-inbox.$suffix" > "$units/$inbox.$suffix"
done
cat > "$units/$delivery" <<EOF
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -ec 'grep -Eq "^fixture-[0-9]+$" "$package" && cp "$package" "$fixture/visible"'
ExecStopPost=/usr/bin/rm -f "$fixture/visible"
EOF
systemctl daemon-reload
systemctl start "$inbox.path"
publish() {
  echo "$1" > "$fixture/incoming"
  mv -T "$fixture/incoming" "$package"
}
expect_visible() {
  for _ in {1..100}; do
    if grep -Fqx "$1" "$fixture/visible" 2>/dev/null; then return; fi
    sleep 0.1
  done
  echo "Expected delivery of $1" >&2
  return 1
}
expect_absent() {
  for _ in {1..100}; do
    if [[ ! -e "$fixture/visible" ]]; then return; fi
    sleep 0.1
  done
  echo "Expected withdrawal" >&2
  return 1
}
expect_absent
publish fixture-1
expect_visible fixture-1
publish fixture-2
expect_visible fixture-2
rm "$package"
expect_absent
publish fixture-3
expect_visible fixture-3
publish invalid
expect_absent
publish fixture-4
expect_visible fixture-4
# Completion of the delivery window must not republish the same package.
systemctl stop "$delivery"
sleep 1
expect_absent
systemctl is-active --quiet "$inbox.path"
echo "Task 189 inbox fixture passed"
