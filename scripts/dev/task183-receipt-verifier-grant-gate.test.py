#!/usr/bin/env python3
"""Offline regression for Task183 receipt DB identity + grant admission.

No real database, signers, application sessions, secrets or network are used.
"""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

FILE = Path(__file__).with_name("task183-read-issuer-receipt.py")
SPEC = importlib.util.spec_from_file_location("task183_receipt_gate_under_test", FILE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

REQUEST = "a" * 36
PROOF = {
    "claims": {"originalAttemptId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
               "expiresAt": 1795500000000},
    "digest": "b" * 64,
    "signedAt": 1795499900000,
}

class Cursor:
    def __init__(self, value):
        self.value = value
    def fetchone(self):
        return (self.value,)

class Connection:
    def __init__(self, login_ok=True, grant_ok=True):
        self.login_ok = login_ok
        self.grant_ok = grant_ok
        self.calls = []
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def execute(self, sql, params=None):
        self.calls.append((sql,params))
        if "FROM pg_roles WHERE rolname = session_user" in sql:
            return Cursor(self.login_ok)
        if "FROM pg_roles WHERE rolname = current_user" in sql:
            return Cursor(self.grant_ok)
        return Cursor(None)
    @property
    def inserted(self):
        return sum("INSERT INTO gpt02_stage.task183_verified_recovery_receipts" in sql
                   for sql,_ in self.calls)

class Tests(unittest.TestCase):
    def run_case(self,login_ok=True,grant_ok=True):
        c=Connection(login_ok,grant_ok)
        def connect(**kwargs):
            self.assertEqual(kwargs["service"],"cst_dev_task183_receipt_verifier")
            self.assertEqual(kwargs["connect_timeout"],5)
            return c
        with patch.object(MODULE,"read_receipt",return_value=PROOF),patch.dict(
            sys.modules,{"psycopg":types.SimpleNamespace(connect=connect)}
        ):
            try:
                MODULE.record_receipt(REQUEST)
                result=None
            except ValueError as e:
                result=str(e)
        return c,result

    def test_actual_login_identity_is_required(self):
        c,error=self.run_case(login_ok=False)
        self.assertEqual(error,"DEDICATED_VERIFIER_LOGIN_REQUIRED")
        self.assertEqual(c.inserted,0)
        self.assertFalse(any("SET LOCAL ROLE" in q for q,_ in c.calls))

    def test_login_must_have_one_connection_and_role_set_privilege(self):
        c,_=self.run_case(login_ok=False)
        sql=c.calls[0][0]
        for required in ("session_user = 'gpt02_task183_verifier_login'",
                         "current_user = 'gpt02_task183_verifier_login'",
                         "rolcanlogin", "rolconnlimit = 1",
                         "pg_has_role(session_user, 'gpt02_task183_receipt_verifier', 'SET')"):
            self.assertIn(required,sql)

    def test_missing_column_insert_grant_denies_without_write(self):
        c,error=self.run_case(grant_ok=False)
        self.assertEqual(error,"VERIFIER_RECEIPT_INSERT_NOT_GRANTED")
        self.assertEqual(c.inserted,0)
        self.assertEqual(sum("SET LOCAL ROLE" in sql for sql,_ in c.calls),1)

    def test_verifier_is_no_login_and_five_column_insert_grants_only(self):
        c,_=self.run_case(grant_ok=False)
        sql=c.calls[-1][0]
        self.assertIn("current_user = 'gpt02_task183_receipt_verifier'",sql)
        self.assertIn("NOT (rolcanlogin OR rolsuper OR rolbypassrls",sql)
        self.assertIn("has_schema_privilege",sql)
        self.assertIn("NOT has_table_privilege(",sql)
        self.assertEqual(sql.count("has_column_privilege("),5)
        for column in ("request_id","approval_sha256","predecessor_attempt_id",
                       "signed_at","expires_at"):
            self.assertIn("'"+column+"', 'INSERT'",sql)

    def test_true_permissions_register_exactly_once(self):
        c,error=self.run_case()
        self.assertIsNone(error)
        self.assertEqual(c.inserted,1)
        sql,params=c.calls[-1]
        self.assertEqual(params,(REQUEST,PROOF["digest"],PROOF["claims"]["originalAttemptId"],
                                 PROOF["signedAt"],PROOF["claims"]["expiresAt"]))
        self.assertIn("INSERT INTO gpt02_stage.task183_verified_recovery_receipts",sql)

    def test_unverified_receipt_never_opens_database(self):
        called=[]
        def forbidden_connect(**kwargs):
            called.append(kwargs)
            raise AssertionError("connection must not be opened")
        with patch.object(MODULE,"read_receipt",side_effect=ValueError("INVALID_OWNER_SIGNATURE")),patch.dict(
            sys.modules,{"psycopg":types.SimpleNamespace(connect=forbidden_connect)}
        ):
            with self.assertRaisesRegex(ValueError,"INVALID_OWNER_SIGNATURE"):
                MODULE.record_receipt(REQUEST)
        self.assertEqual(called,[])

if __name__=="__main__":
    unittest.main(verbosity=2)
