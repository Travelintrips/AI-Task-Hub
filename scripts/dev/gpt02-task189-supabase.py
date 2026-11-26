#!/usr/bin/python3
"""Receive one administrator-delivered Supabase response on the Task 189 host."""
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote
from uuid import UUID


def load_requester():
    for name in ("gpt02-task189-request.py", "request-package.py"):
        path = Path(__file__).resolve().with_name(name)
        if path.is_file():
            spec = importlib.util.spec_from_file_location("requester", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise RuntimeError("requester missing")


requester = load_requester()


def gpg(home, args, data=b""):
    return subprocess.run(["/usr/bin/gpg", "--homedir", str(home), "--no-options",
                           "--batch", "--no-tty", "--no-auto-key-retrieve", "--pinentry-mode",
                           "loopback", *args], input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, check=True, timeout=35).stdout


def recipient(home, request_id):
    uid = "CST DEV Task 189 " + request_id
    keys = gpg(home, ["--with-colons", "--list-secret-keys"]).decode().splitlines()
    if not keys:
        gpg(home, ["--passphrase", "", "--quick-generate-key", uid, "rsa3072", "cert", "0"])
        keys = gpg(home, ["--with-colons", "--list-secret-keys"]).decode().splitlines()
    fields = [line.split(":") for line in keys]
    prints = [r[9] for r in fields if r[0] == "fpr"]
    if (len(prints) not in (1, 2) or not all(re.fullmatch(r"[0-9A-F]{40}", f) for f in prints)
            or [r[9] for r in fields if r[0] == "uid"] != [uid]):
        raise ValueError("unexpected recipient")
    # PostgreSQL pgcrypto encrypts to an RSA encryption subkey. Preserve the
    # primary fingerprint if key creation was interrupted between these steps.
    subkeys = [r for r in fields if r[0] == "ssb"]
    if not subkeys:
        gpg(home, ["--passphrase", "", "--quick-add-key", prints[0], "rsa3072", "encr", "0"])
    elif len(subkeys) != 1 or "e" not in subkeys[0][11]:
        raise ValueError("unexpected encryption subkey")
    return {"requestId": request_id, "scope": requester.SCOPE, "fingerprint": prints[0],
            "publicKey": gpg(home, ["--armor", "--export", prints[0]]).decode("ascii")}


def run(action, state, store, stream):
    home = state / "supabase-recipient"
    with (state / "lock").open("ab") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state_file = state / "request.json"
        entry = json.loads(state_file.read_bytes())
        if entry["scope"] != requester.SCOPE or str(UUID(entry["id"])) != entry["id"]:
            raise ValueError("request mismatch")
        receipt = state / "pending.enc"
        if action == "receive" and entry["status"] == "publishing":
            requester.publish_once(store, receipt, state_file, entry)
        if entry["status"] == "published" and action == "receive":
            return {"status": "already_published"}
        if entry["status"] != "waiting_for_issuer":
            raise ValueError("request not pending")
        if action == "request":
            home.mkdir(mode=0o700, exist_ok=True)
        info = home.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError("recipient directory")
        if action == "request":
            descriptor = recipient(home, entry["id"])
            if entry.get("provider") != "supabase-direct":
                entry["provider"] = "supabase-direct"
                requester.write_state(state_file, entry)
            return descriptor
        if entry.get("provider") != "supabase-direct":
            raise ValueError("recipient not enrolled")
        raw = stream.read(24577)
        if len(raw) > 24576:
            raise ValueError("oversize")
        encrypted = base64.b64decode(raw.strip(), validate=True)
        opened = gpg(home, ["--max-output", "8192", "--decrypt"], encrypted)
        response = json.loads(opened)
        if (response.get("requestId") != entry["id"] or response.get("scope") != requester.SCOPE
                or response.get("kind") != ("challenge" if action == "verify" else "lease")):
            raise ValueError("response mismatch")
        if action == "verify":
            nonce = response["nonce"]
            if not re.fullmatch(r"[0-9a-f]{64}", nonce):
                raise ValueError("bad challenge")
            return {"challengeSHA256": hashlib.sha256(nonce.encode("ascii")).hexdigest()}
        if (response.get("role") != requester.ROLE or type(response.get("expiresAt")) is not int
                or not 0 < response["expiresAt"] - time.time() <= requester.MAX_WINDOW):
            raise ValueError("invalid lease")
        password = response["password"]
        if not isinstance(password, str) or not 1 <= len(password.encode()) <= 1024 or "\x00" in password:
            raise ValueError("invalid password")
        if any(os.path.lexists(store / n) for n in
               [requester.NAME, requester.NAME + ".incoming", ".gpt02-task189-received"]):
            raise ValueError("existing delivery")
        dsn = (f"postgresql://{requester.ROLE}.{requester.PROJECT}:{quote(password, safe='')}"
               f"@{requester.HOST}:5432/postgres")
        sealed = requester.encrypt({"companyId": "default", "taskId": 189, "connectionString": dsn})
        if not sealed or len(sealed) > 65536:
            raise ValueError("encryption failed")
        # A crash before the state transition can leave only our own unpublished
        # ciphertext here. The shared request lock excludes both delivery paths.
        with receipt.open("wb") as dest:
            dest.write(sealed)
            dest.flush()
            os.fsync(dest.fileno())
        entry.update(status="publishing", expiresAt=response["expiresAt"],
                     sha256=hashlib.sha256(sealed).hexdigest(), source="supabase-direct")
        requester.write_state(state_file, entry)
        requester.publish_once(store, receipt, state_file, entry)
        return {"status": entry["status"]}


if __name__ == "__main__":
    os.umask(0o077)
    try:
        if os.geteuid() != 0 or sys.argv[1:] not in (["request"], ["verify"], ["receive"]):
            raise ValueError("invalid invocation")
        print(json.dumps(run(sys.argv[1], requester.STATE, requester.STORE, sys.stdin.buffer)))
    except (KeyError, OSError, ValueError, TypeError, RuntimeError, subprocess.SubprocessError):
        sys.exit("Task 189 Supabase exchange unavailable")
