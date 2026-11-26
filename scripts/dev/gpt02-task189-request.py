#!/usr/bin/python3
"""Request one CST-DEV database lease and publish its systemd-encrypted package."""
import fcntl
import hashlib
import http.client
import json
import os
import socket
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import quote

NAME = "gpt02-task189-preparer"
ENDPOINT = "/v1/database/creds/" + NAME
STATE = Path("/var/lib/gpt02-task189-request")
STORE = Path("/etc/credstore.encrypted")
SOCKET = Path("/run/cst-dev-task189-issuer/agent.sock")
PROJECT = "xssrfshdrtdfupgqwfdw"
ROLE = "gpt02_core_prep_login"
HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
MAX_WINDOW = 180
SCOPE = {"project": PROJECT, "companyId": "default", "taskId": 189, "purpose": "prepare-only"}


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_state(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        try:
            tmp.write(json.dumps(value, separators=(",", ":")).encode())
            tmp.flush()
            os.fsync(tmp.fileno())
            os.replace(tmp.name, path)
            sync_dir(path.parent)
        finally:
            Path(tmp.name).unlink(missing_ok=True)


def connect_provider(path, owner):
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != owner or parent.st_mode & 0o022:
        raise ValueError("provider directory")
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != owner or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError("provider socket")
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.settimeout(6)
        for delay in (0.2, 0.5, None):
            try:
                sock.connect(str(path))
                return sock
            except ConnectionRefusedError:
                if delay is None:
                    raise
                time.sleep(delay)
    except BaseException:
        sock.close()
        raise


class IssuerDenied(Exception):
    pass


def fetch_lease(sock, request_id):
    # No token or remote address is accepted from a request. The dedicated local
    # proxy authenticates using its enrolled, role-scoped workload identity.
    conn = http.client.HTTPConnection("localhost")
    conn.sock = sock
    try:
        conn.request("GET", ENDPOINT, headers={"X-Vault-Request": "true",
                     "X-CST-Request-ID": request_id, "Cache-Control": "no-store"})
        response = conn.getresponse()
        if response.status in (401, 403):
            raise IssuerDenied
        if response.status != 200:
            raise ValueError("issuer declined")
        data = response.read(16385)
        if len(data) > 16384:
            raise ValueError("issuer response size")
        grant = json.loads(data)
        prefix = ENDPOINT.removeprefix("/v1/") + "/"
        lease = grant["lease_id"]
        ttl = grant["lease_duration"]
        credential = grant["data"]
        if (not isinstance(lease, str) or not lease.startswith(prefix) or not lease[len(prefix):]
                or type(ttl) is not int or not 0 < ttl <= MAX_WINDOW or credential["username"] != ROLE):
            raise ValueError("issuer scope")
        password = credential["password"]
        if not isinstance(password, str) or not 1 <= len(password.encode()) <= 1024 or "\x00" in password:
            raise ValueError("credential")
        dsn = f"postgresql://{ROLE}.{PROJECT}:{quote(password, safe='')}@{HOST}:5432/postgres"
        return {"taskId": 189, "companyId": "default", "connectionString": dsn}, ttl
    finally:
        conn.close()


def encrypt(bundle):
    # Only the encrypted bytes leave this process and systemd-creds. Plaintext
    # is sent on stdin, never in argv, files, the environment or the journal.
    return subprocess.run(["/usr/bin/systemd-creds", "encrypt", "--with-key=host",
                           "--name=" + NAME, "-", "-"], input=json.dumps(bundle).encode(),
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True,
                          timeout=12).stdout


def publish_once(store, receipt, state_file, entry):
    incoming = store / (NAME + ".incoming")
    def matches(path):
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return False
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            return (stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 65536
                    and hashlib.sha256(stream.read(65537)).hexdigest() == entry["sha256"])

    # The inbox atomically moves our file across these three names. Read them in
    # forward order so a rename cannot hide a publication during crash recovery.
    accepted_paths = (incoming, store / ".gpt02-task189-received", store / NAME)
    for candidate in accepted_paths:
        if matches(candidate):
            entry["status"] = "published"
            write_state(state_file, entry)
            receipt.unlink(missing_ok=True)
            return
    if any(os.path.lexists(path) for path in accepted_paths):
        entry["status"] = "reconciliation_required"
        write_state(state_file, entry)
        receipt.unlink(missing_ok=True)
        return
    if time.time() >= entry["expiresAt"] or not matches(receipt):
        entry["status"] = "reconciliation_required"
        write_state(state_file, entry)
        receipt.unlink(missing_ok=True)
        return
    # Stage on the destination filesystem; never replace another pending grant.
    with tempfile.NamedTemporaryFile(dir=store, prefix=".task189-", delete=False) as tmp:
        try:
            tmp.write(receipt.read_bytes())
            tmp.flush()
            os.fsync(tmp.fileno())
            if time.time() >= entry["expiresAt"]:
                raise ValueError("lease expired")
            os.link(tmp.name, incoming)
            sync_dir(store)
        finally:
            Path(tmp.name).unlink(missing_ok=True)
    entry["status"] = "published"
    write_state(state_file, entry)
    receipt.unlink(missing_ok=True)


def request(state=STATE, store=STORE, provider=SOCKET, *, owner=0, encrypt_package=encrypt):
    state_file, receipt = state / "request.json", state / "pending.enc"
    with (state / "lock").open("ab") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if state_file.exists():
            entry = json.loads(state_file.read_bytes())
            if entry["scope"] != SCOPE:
                raise ValueError("request scope")
        else:
            entry = {"id": str(uuid.uuid4()), "scope": SCOPE, "createdAt": int(time.time()),
                     "status": "waiting_for_issuer"}
            write_state(state_file, entry)
        if entry["status"] == "publishing":
            publish_once(store, receipt, state_file, entry)
        if entry["status"] == "request_sent":
            # A lost response can still have created a real database lease.
            # A new HTTP call would create another one; keep the correlation ID.
            entry["status"] = "reconciliation_required"
            write_state(state_file, entry)
        if entry["status"] != "waiting_for_issuer":
            return entry["status"]
        if any(os.path.lexists(p) for p in (store / NAME, store / (NAME + ".incoming"),
                                            store / ".gpt02-task189-received")):
            entry["status"] = "existing_publication"
            write_state(state_file, entry)
            return entry["status"]
        if entry.get("provider") == "supabase-direct":
            return entry["status"]
        try:
            sock = connect_provider(provider, owner)
        except (FileNotFoundError, ConnectionRefusedError):
            return entry["status"]
        with sock:
            entry["status"] = "request_sent"
            write_state(state_file, entry)
            started = time.time()
            try:
                bundle, ttl = fetch_lease(sock, entry["id"])
                sealed = encrypt_package(bundle)
                if not sealed or len(sealed) > 65536:
                    raise ValueError("invalid encryption result")
                with receipt.open("xb") as dest:
                    dest.write(sealed)
                    dest.flush()
                    os.fsync(dest.fileno())
                entry.update(status="publishing", sha256=hashlib.sha256(sealed).hexdigest(),
                             expiresAt=started + ttl)
                write_state(state_file, entry)
            except IssuerDenied:
                entry["status"] = "issuer_denied"
                write_state(state_file, entry)
                return entry["status"]
            except (ValueError, TypeError, KeyError, OSError, http.client.HTTPException,
                    subprocess.SubprocessError, RecursionError, AttributeError):
                entry["status"] = "reconciliation_required"
                write_state(state_file, entry)
                receipt.unlink(missing_ok=True)
                return entry["status"]
        publish_once(store, receipt, state_file, entry)
        return entry["status"]


if __name__ == "__main__":
    os.umask(0o077)
    try:
        status = request()
        print("Task 189 preparation package:", status)
        raise SystemExit(1 if status in {"issuer_denied", "reconciliation_required"} else 0)
    except (ValueError, TypeError, KeyError, OSError):
        raise SystemExit("Task 189 package request unavailable")
