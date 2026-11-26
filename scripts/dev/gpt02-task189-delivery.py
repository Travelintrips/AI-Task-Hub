#!/usr/bin/python3
"""Deliver a credential issued for AI Task #189 to its existing DEV container."""
import json
import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlsplit

BUNDLE = "gpt02-task189-preparer"
DEST = Path("/run/ai-task-dev-scoped-preparation/task189")
LIVE_NAME = "task-preparer.json"
PREPARER = "gpt02_core_prep_login.xssrfshdrtdfupgqwfdw"
POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"


def read_bundle(path):
    with path.open("rb") as source:
        data = source.read(8193)
    if not 0 < len(data) <= 8192:
        raise ValueError("invalid bundle size")
    grant = json.loads(data)
    if not isinstance(grant, dict) or grant.get("companyId") != "default":
        raise ValueError("wrong tenant")
    if type(grant.get("taskId")) is not int or grant["taskId"] != 189:
        raise ValueError("wrong task")
    raw = grant.get("connectionString")
    if not isinstance(raw, str) or not raw.isascii() or any(ord(c) <= 32 or ord(c) == 127 for c in raw):
        raise ValueError("invalid connection target")
    uri = urlsplit(raw)
    if (uri.scheme not in {"postgres", "postgresql"} or uri.hostname != POOLER
            or uri.port != 5432 or uri.username != PREPARER or not uri.password
            or uri.path != "/postgres" or uri.query or uri.fragment or "\\" in raw):
        raise ValueError("wrong connection target")
    # Forward only fields consumed by the application.
    return json.dumps({k: grant[k] for k in ("companyId", "taskId", "connectionString")}).encode()


def same_inode(path, identity):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return (info.st_dev, info.st_ino) == identity


def publish(source, destination, marker, stage_name, owner):
    data = read_bundle(source)
    info = destination.lstat()
    if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o500
            or (info.st_uid, info.st_gid) != owner):
        raise ValueError("invalid destination directory")
    stage = destination / stage_name
    # Use an exclusive staging file and a no-replace link. Another delivery
    # can never overwrite an operator's existing credential.
    with stage.open("xb") as handle:
        file = os.fstat(handle.fileno())
        with marker.open("x", encoding="ascii") as record:
            record.write(f"{file.st_dev} {file.st_ino}")
        os.fchmod(handle.fileno(), 0o400)
        handle.write(data)
        handle.flush()
        os.fchown(handle.fileno(), *owner)
        os.link(stage, destination / LIVE_NAME, follow_symlinks=False)
    stage.unlink()


def withdraw(destination, marker, stage_name):
    # ExecStopPost also runs after a failed start. Preserve other publishers'
    # files; use the inode recorded before the credential became visible.
    try:
        identity = tuple(map(int, marker.read_text(encoding="ascii").split()))
    except FileNotFoundError:
        return
    for name in (LIVE_NAME, stage_name):
        path = destination / name
        if same_inode(path, identity):
            path.unlink()
    marker.unlink()


def main():
    action, = sys.argv[1:]
    invocation = os.environ["INVOCATION_ID"]
    if not re.fullmatch(r"[a-f0-9]{32}", invocation):
        raise ValueError("invalid invocation")
    stage = ".incoming-" + invocation
    marker = Path(os.environ["RUNTIME_DIRECTORY"]) / "delivery-inode"
    if action == "publish":
        publish(Path(os.environ["CREDENTIALS_DIRECTORY"]) / BUNDLE, DEST, marker, stage, (1000, 1000))
    elif action == "withdraw":
        withdraw(DEST, marker, stage)
    else:
        raise ValueError("unknown action")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, RecursionError):
        # Validation and filesystem exceptions can contain input. Never log it.
        sys.exit("Task189 credential delivery unavailable")
