#!/usr/bin/env python3
"""
Repeatable OFFLINE verification using the installed ORIGINAL GPT02 Issue159
read-only SQLite reader and Unix HTTP handler, with a disposable fixture DB.

No live tasks.db access, browser tokens, signer private keys, commands,
systemd actions, grants, issuer leases, or PROD interactions.
"""
from __future__ import annotations
import argparse
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid

EXPECTED_ORIGINAL_HASHES = {
    "gpt02_issue159_approval_intent_reader.py":
        "cb875e6c4bd68a6e1e24297b18e6a54e14719c10d8217222bb5c275c6324a676",
    "gpt02_issue159_approval_reader_runtime.py":
        "935b0e3554fc80e4cc665b4b594296b6e12b15ee2557e3d3e3a47faf0370db79",
    "gpt02_issue159_approval_intent_contract.py":
        "a0981d7be9eebebb8835ccff2a20306becedf40aabd0f3de6d3282b64f48deb1",
    "gpt02_issue159_signer_approval_guard.py":
        "2c5647ae3d1cfbd4d06571ef26d209cd1ee09f0a7c6582dcd039ac7b1e7a283e",
    "gpt02_issue159_approval_intent.py":
        "9086d2ab5a8db3c7b05a0a59ba8201e0f0263454412cbb8b74f7ae0067935758",
}

def imported(source_root: Path, filename: str):
    path = source_root / filename
    name = "fixture_" + filename.replace(".py", "")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("OFFICIAL_SOURCE_NOT_IMPORTABLE")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def test_fixture(source_root: Path, node_test: Path):
    if os.environ.get("GPT02_ORIGINAL_ISSUE159_OFFLINE_ONLY") != "1":
        raise RuntimeError("OFFLINE_ONLY_ADMISSION_REQUIRED")
    if source_root != Path("/opt/ai-coding-standalone-dev"):
        raise RuntimeError("PINNED_SOURCE_PATH_REQUIRED")
    for filename, expected in EXPECTED_ORIGINAL_HASHES.items():
        file = source_root / filename
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise RuntimeError("ISSUE159_ORIGINAL_SOURCE_DRIFT_REQUIRES_REVIEW: " + filename)

    sys.path.insert(0, str(source_root))
    contract = imported(source_root, "gpt02_issue159_approval_intent_contract.py")
    reader = imported(source_root, "gpt02_issue159_approval_intent_reader.py")
    runtime = imported(source_root, "gpt02_issue159_approval_reader_runtime.py")
    signer_guard = imported(source_root, "gpt02_issue159_signer_approval_guard.py")
    writer = imported(source_root, "gpt02_issue159_approval_intent.py")

    with tempfile.TemporaryDirectory(prefix="gpt02-issue159-offline-") as root:
        scratch = Path(root)
        os.chmod(scratch, 0o700)
        db_path = scratch / "synthetic-approval.db"
        socket_path = scratch / "synthetic-approval-reader.sock"
        with sqlite3.connect(db_path) as db:
            db.executescript("""
                CREATE TABLE gpt02_issue159_approval_intents(
                 id TEXT PRIMARY KEY,task_id INTEGER NOT NULL,command_id TEXT NOT NULL,
                 attempt_id TEXT NOT NULL,company_id TEXT NOT NULL,claims_sha256 TEXT NOT NULL,
                 actor_id TEXT NOT NULL,auth_method TEXT NOT NULL,
                 role_at_decision TEXT NOT NULL,decision TEXT NOT NULL,
                 recorded_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,
                 UNIQUE(task_id,command_id,attempt_id),UNIQUE(claims_sha256));
                CREATE TABLE gpt02_issue159_admin_operator_links(
                 auth_user_id TEXT,hub_operator_id TEXT,email TEXT,enabled INTEGER);
                CREATE TABLE admin_identities(
                 user_id TEXT PRIMARY KEY,role TEXT,enabled INTEGER);
            """)
            t0 = int(time.time() * 1000)
            claims = {
                "v": 2, "environment": "DEV",
                "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
                "taskId": 172,
                "commandId": str(uuid.uuid4()),
                "attemptId": str(uuid.uuid4()),
                "nonce": "S" + os.urandom(32).hex()[:44],
                "operatorNamespace": "ai-task-hub.public.users",
                "superAdminId": "synthetic_owner_7",
                "companyId": "default", "issuedAt": t0 - 1000,
                "expiresAt": t0 + 90000,
            }
            checked = contract.validate_approval_claims(claims)
            digest = checked["claimsSha256"]
            lookup = {
                "claimsSha256": digest, "taskId": claims["taskId"],
                "commandId": claims["commandId"], "attemptId": claims["attemptId"],
                "companyId": "default", "superAdminId": claims["superAdminId"],
            }
            db.execute("INSERT INTO admin_identities VALUES (?,?,?)",
                       ("synthetic_auth_user", "super_admin", 1))
            db.execute("INSERT INTO gpt02_issue159_admin_operator_links VALUES (?,?,?,?)",
                       ("synthetic_auth_user", "synthetic_owner_7",
                        "owner@example.invalid", 1))
            db.commit()
            test_token = "test-token-" + "T" * 45
            # Explicitly injected synthetic identity; NEVER a live Supabase
            # login, bypass or assertion of a real Owner's approval.
            def synthetic_identity(token, _db):
                if token != test_token:
                    return None
                return {"userId": "synthetic_owner_7",
                        "role": "super_admin", "enabled": True,
                        "authMethod": "supabase_admin_session"}
            blocked = writer.record_issue159_approval_intent(
                test_token, db, claims, identity_verifier=synthetic_identity,
                now_ms=t0, readiness_gate=lambda _record: False)
            assert blocked["reason"] == "AUTO_CHAIN_PREREQUISITES_NOT_READY"
            assert db.execute("SELECT COUNT(*) FROM gpt02_issue159_approval_intents").fetchone()[0] == 0
            print("1/10 ORIGINAL_WRITER_UNREADY_CHAIN_REJECTS_BEFORE_COMMIT_PASS", flush=True)

            invalid = writer.record_issue159_approval_intent(
                "bad-" + "X" * 45, db, claims,
                identity_verifier=synthetic_identity,
                now_ms=t0, readiness_gate=lambda _record: True)
            assert invalid["reason"] == "ADMIN_IDENTITY_MISMATCH"
            assert db.execute("SELECT COUNT(*) FROM gpt02_issue159_approval_intents").fetchone()[0] == 0
            recorded = writer.record_issue159_approval_intent(
                test_token, db, claims, identity_verifier=synthetic_identity,
                now_ms=t0, readiness_gate=lambda _record: True)
            assert recorded["ok"] is True
            assert recorded["intentRecorded"] is True
            assert recorded["reason"] == "ADMIN_APPROVAL_INTENT_RECORDED_NO_SIGNING_AUTHORITY"
            assert recorded["authorizationGranted"] is False
            assert recorded["dispatchPermitted"] is False
            assert recorded["signingPermitted"] is False
            replay = writer.record_issue159_approval_intent(
                test_token, db, claims, identity_verifier=synthetic_identity,
                now_ms=t0+1, readiness_gate=lambda _record: True)
            assert replay["reason"] == "APPROVAL_INTENT_REPLAY_OR_CONFLICT"
            assert db.execute("SELECT COUNT(*) FROM gpt02_issue159_approval_intents").fetchone()[0] == 1
            row = (recorded["intentId"], 172, claims["commandId"], claims["attemptId"],
                   "default", digest, "synthetic_owner_7",
                   "supabase_admin_session", "super_admin", "APPROVE",
                   recorded["recordedAt"], claims["expiresAt"])
            print("2/10 ORIGINAL_WRITER_SINGLE_INTENT_AND_REPLAY_REJECTION_PASS", flush=True)

        # Exercise the ACTUAL original SQLite code, not a hand-written result.
        positive = reader.read_approval_intent(str(db_path), lookup, t0,
                                               operational=False)
        assert positive["persistedTrustedReadProven"] is True
        assert positive["decision"]["authMethod"] == "supabase_admin_session"
        assert positive["decision"]["actorId"] == claims["superAdminId"]
        assert positive["releaseDecision"] == "NO_GO"
        assert positive["signingPermitted"] is False
        assert positive["dispatchPermitted"] is False
        print("3/10 ORIGINAL_SQLITE_SUPABASE_SESSION_APPROVAL_READ_PASS",flush=True)

        pinned = reader.read_approval_intent(str(db_path), lookup, t0,
                                             operational=True)
        assert pinned["persistedTrustedReadProven"] is False
        assert pinned["reason"] == "OPERATIONAL_DB_PATH_NOT_PINNED"
        print("4/10 ORIGINAL_READER_OPERATIONAL_DB_PIN_PROTECTED_PASS",flush=True)

        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE admin_identities SET enabled=0")
        negative = reader.read_approval_intent(str(db_path), lookup, t0,
                                               operational=False)
        assert negative["persistedTrustedReadProven"] is False
        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE admin_identities SET enabled=1")
        print("5/10 ORIGINAL_READER_DISABLED_SUPER_ADMIN_DENIED_PASS",flush=True)

        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE gpt02_issue159_approval_intents SET expires_at_ms=?",
                       (t0-1,))
        negative = reader.read_approval_intent(str(db_path), lookup, t0,
                                               operational=False)
        assert negative["persistedTrustedReadProven"] is False
        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE gpt02_issue159_approval_intents SET expires_at_ms=?",
                       (claims["expiresAt"],))
        print("6/10 ORIGINAL_READER_EXPIRED_DECISION_DENIED_PASS",flush=True)

        # Real Issue159 SQLite schema has unique digest and (task,command,attempt).
        # The producer already tested replay; prove direct duplicate writes
        # are also rejected by the actual database constraint.
        with sqlite3.connect(db_path) as db:
            row2 = list(row)
            row2[0] = str(uuid.uuid4())
            try:
                db.execute("INSERT INTO gpt02_issue159_approval_intents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           row2)
            except sqlite3.IntegrityError:
                pass
            else:
                raise AssertionError("ORIGINAL_UNIQUE_CONSTRAINT_MISSING")
            assert db.execute("SELECT COUNT(*) FROM gpt02_issue159_approval_intents").fetchone()[0] == 1
        verified = reader.read_approval_intent(str(db_path), lookup, t0, operational=False)
        assert verified["persistedTrustedReadProven"] is True
        print("7/10 ORIGINAL_SQLITE_UNIQUE_DUPLICATE_WRITE_DENIED_PASS",flush=True)

        # Run the EXACT original Unix HTTP server handler on a PRIVATE socket.
        # This never calls serve() on the operational systemd socket.
        runtime._Handler.approval_reader_fn = reader.read_approval_intent
        runtime._Handler.db_path = str(db_path)
        runtime._Handler.operational = False
        server = runtime._UnixServer(str(socket_path), runtime._Handler)
        # Match the original signer guard's actual directory/socket custody.
        # Ownership and modes are changed ONLY inside the disposable tempdir.
        expected_gid = grp.getgrnam(signer_guard.SIGNER_GROUP).gr_gid
        os.chown(scratch, os.getuid(), expected_gid)
        os.chmod(scratch, 0o750)
        os.chown(socket_path, os.getuid(), expected_gid)
        os.chmod(socket_path, 0o660)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        def call_unix(exact_lookup: dict):
            now = int(time.time()*1000)
            payload = json.dumps({"lookup": exact_lookup, "observedAt": now},
                                 separators=(",", ":")).encode()
            request = (
              b"POST /approval-intent HTTP/1.1\r\nHost: localhost\r\n"
              b"Content-Type: application/json\r\nContent-Length: "+
              str(len(payload)).encode()+b"\r\nConnection: close\r\n\r\n"+payload
            )
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
                sock.settimeout(3)
                sock.connect(str(socket_path))
                uid = struct.unpack("3i",sock.getsockopt(
                    socket.SOL_SOCKET,socket.SO_PEERCRED,12))[1]
                assert uid == os.getuid()
                sock.sendall(request)
                chunks=[]
                while True:
                    data=sock.recv(4096)
                    if not data:break
                    chunks.append(data)
                response=b"".join(chunks)
            status_line,_,body=response.partition(b"\r\n\r\n")
            return status_line.split(b"\r\n",1)[0],json.loads(body)

        try:
            status,body=call_unix(lookup)
            assert status.startswith(b"HTTP/1.1 200 ")
            assert body["ok"] is True
            assert body["result"]["persistedTrustedReadProven"] is True
            assert body["approvalReadOnly"] is True
            assert body["decisionCreated"] is False
            assert body["dispatchPermitted"] is False
            wrong={**lookup,"commandId":str(uuid.uuid4())}
            status,no_match=call_unix(wrong)
            assert status.startswith(b"HTTP/1.1 404 ")
            assert no_match["ok"] is False
            assert no_match["releaseDecision"] == "NO_GO"
            print("8/10 ORIGINAL_UNIX_HANDLER_REAL_SQLITE_POSITIVE_AND_NEGATIVE_PASS",flush=True)
            # Exercise the ORIGINAL sign-once guard. This guard does NOT
            # load a private key or sign: it returns only the verified digest.
            now_for_guard = int(time.time()*1000)
            verified_digest = signer_guard.persisted_approval_fresh(
                claims, socket_path=str(socket_path),
                now_ms=now_for_guard, reader_uid=os.getuid())
            assert verified_digest == digest
            try:
                signer_guard.persisted_approval_fresh(
                    {**claims, "nonce":"N"*43}, socket_path=str(socket_path),
                    now_ms=int(time.time()*1000), reader_uid=os.getuid())
            except RuntimeError:
                pass
            else:
                raise AssertionError("ORIGINAL_SIGNER_GUARD_ACCEPTED_FORGED_NONCE")
            print("9/10 ORIGINAL_SIGNER_CUSTODY_PEERCRED_AND_NONCE_GUARD_PASS",flush=True)

            descriptor=scratch/"fixture.json"
            descriptor.write_text(json.dumps({
                "environment":"DEV","synthetic":True,
                "claims":claims,"lookup":lookup,"socketPath":str(socket_path)
            }),encoding="utf-8")
            env={**os.environ,"GPT02_ISSUE159_ORIGINAL_SQLITE_SOCKET_FIXTURE":"1",
                 "GPT02_ISSUE159_FIXTURE_DESCRIPTOR":str(descriptor)}
            cmd=["node","--test",str(node_test)]
            ran=subprocess.run(cmd,env=env,timeout=20,text=True,
                               capture_output=True,check=False)
            if ran.returncode:
                print(ran.stdout[-6000:],file=sys.stderr)
                print(ran.stderr[-4000:],file=sys.stderr)
                raise RuntimeError("ORIGINAL_SOCKET_TO_PR207_GATE_FAILED")
            print(ran.stdout[-2300:])
            print("10/10 ORIGINAL_SQLITE_UNIX_RESPONSE_TO_PR207_GATE_PASS",flush=True)
        finally:
            server.shutdown()
            server.server_close()
    print("GPT02_ORIGINAL_ISSUE159_READER_SQLITE_UNIX_TO_PR207_INTEGRATION_PASS")
    print("LIVE_APPROVAL_DB_UNCHANGED; SIGNER_DISPATCH_OFF; PROD_UNTOUCHED")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--original-source-root",
                   default="/opt/ai-coding-standalone-dev")
    p.add_argument("--node-test",required=True)
    args=p.parse_args()
    test_fixture(Path(args.original_source_root),Path(args.node_test))

if __name__=="__main__":
    main()
