"""Exercise the Core routes against a disposable decision store."""
from email.message import Message
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch
import runpy
import sqlite3
import time

HERE = Path(__file__).resolve().parent
ACTOR = dict(id="google_fixture189", role="super_admin", companyId="default",
             authSupabaseId="11111111-1111-4111-8111-111111111111",
             email="fixture@example.invalid", authSource="supabase_google_identity")
TOKEN = "unusable-offline-fixture"


class CoreRouteTest(TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = Path(tmp.name) / "fixture.db"
        self.actor = dict(ACTOR, authVerifiedAt=int(time.time() * 1000))
        writer = runpy.run_path(str(HERE / "task189-owner-approval-writer-dev.py"))
        self.adapter = runpy.run_path(str(HERE / "task189-owner-approval-http.candidate.py"))
        self.window = False
        self.reader = runpy.run_path(str(HERE / "task189-owner-recovery-decision-reader.py"))
        self.written = None
        self.handoffs = 0
        with sqlite3.connect(self.db) as con:
            con.executescript((HERE / "task189-owner-decision.sqlite.sql").read_text())
            con.executescript("CREATE TABLE admin_identities(user_id, role, enabled);"
                              "CREATE TABLE gpt02_issue159_admin_operator_links(auth_user_id,hub_operator_id,email,enabled);")
            con.execute("INSERT INTO admin_identities VALUES (?,?,1)", (ACTOR['authSupabaseId'], ACTOR['role']))
            con.execute("INSERT INTO gpt02_issue159_admin_operator_links VALUES (?,?,?,1)",
                        (ACTOR['authSupabaseId'], ACTOR['id'], ACTOR['email']))
        packet = dict(readOnly=True, ownerApprovalGranted=False, dispatchPermitted=False, evidenceSha256=writer['SHA'],
                      evidence=dict(requestId=writer['REQUEST'], coreTaskId='aae1fb3b-1a1a-462f-8e65-ec3944f0fce0',
                                    hubExecutionId='816767f4-4264-4931-9a82-3d9496d3da3c',
                                    originalAttemptId='bb13af4f-8085-40e8-aa9b-a7e95d6ed1fc'))
        review = dict(review_evidence_packet=lambda *a, **kw: packet,
                      get_recovery_consent_state=lambda actor: dict(recorded=True, issuerAuthority=False, dispatchPermitted=False,
                          state='SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER'),
                      source_readback=lambda: {'attempt_id':'test','expires_at_ms':1},
                      validate_source=lambda source: None, get_status=lambda actor: {'requested':True})

        def record(**kw):
            self.written = writer['record'](**kw, db_path=self.db, operational=False)
            return self.written

        def handoff(decision, expected_request):
            self.handoffs += 1
            return {'manualReviewRequired':True, 'signedEvidenceVerified':False, 'receiptRegistered':False}

        modules = {
            'task183-owner-identity-readiness.py': {'eligible_owner':lambda actor: {'eligible':actor == self.actor}},
            'task189-recovery-review-intake-dev.py': review,
            'task189-owner-approval-http.candidate.py': self.adapter,
            'task189-owner-approval-writer-dev.py': dict(writer, LIVE_DB=self.db, record=record),
            'task189-owner-after-decision.candidate.py': {'run_handoff':handoff},
            'task189-owner-window-readiness.candidate.py': {'check':lambda: self.window},
        }
        # Fixture loading is confined to this process. The Hub signing key is never loaded by Core.
        ns = {'__name__':'task189_route_fixture'}
        path = HERE / 'task189-owner-review-service.py'
        with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=0o100400, st_uid=0)), \
             patch.object(runpy, 'run_path', side_effect=lambda p: modules[Path(p).name]):
            exec(compile(path.read_bytes(), str(path), 'exec'), ns)
        self.module = ns
        def verify(value):
            if value != TOKEN:
                raise ValueError('Invalid fixture session')
            return self.actor
        ns['verify_via_hub'] = verify

    def request(self, method='POST', path=None, token=TOKEN):
        headers = Message()
        headers['Host'] = self.adapter['HOST']
        headers['Origin'] = self.adapter['ORIGIN']
        if token:
            headers['Authorization'] = 'Bearer ' + token
        headers['Content-Type'] = 'application/json'
        headers['Content-Length'] = str(len(self.adapter['BODY']))
        headers['X-GPT02-Intent'] = self.adapter['INTENT']
        response = []
        request = SimpleNamespace(command=method, path=path or self.adapter['PATH'], headers=headers,
                                  rfile=BytesIO(self.adapter['BODY']), send=lambda code, body: response.append((code, body)))
        self.module['serve_core_request'](request)
        return response[0]

    def test_closed_window_and_invalid_sessions_cannot_record(self):
        self.assertEqual(self.request(token=None)[0], 401)
        self.assertEqual(self.request(token="invalid")[0], 403)
        self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.request(path=self.adapter['PATH'].replace('189','183'))[0],404)
        self.assertEqual(self.request(method='GET')[0],404)
        self.assertIsNone(self.written)
        self.assertEqual(self.handoffs,0)

    def test_exact_decision_reaches_writer_and_reader_once(self):
        self.window = True
        path = self.module['BASE'] + 'approval-readiness' + self.module['QUERY']
        self.assertTrue(self.request('GET',path)[1]['ready'])
        result = self.request()
        self.assertEqual(result[0],200)
        self.assertTrue(result[1]['ownerDecisionStored'])
        self.assertFalse(result[1]['receiptRegistered'])
        self.assertFalse(result[1]['dispatchPermitted'])
        self.assertEqual(self.request()[0],409)
        self.assertEqual(self.handoffs,1)
        self.assertTrue(self.request('GET',path)[1]['recorded'])
        claims=self.written['claims']
        now=int(time.time()*1000)
        lookup=dict(taskId=189,requestId=claims['requestId'],claimsSha256=self.written['claimsSha256'],
                    evidenceSha256=claims['evidenceSha256'],nonce=claims['nonce'],ownerSubject=claims['ownerSubject'],observedAt=now)
        read=self.reader['read_decision'](lookup, db_path=str(self.db), operational=False, now=now)
        self.assertTrue(read['persistedIndependentOwnerDecision'])
        self.assertFalse(read['signatureVerified'])


if __name__ == '__main__':
    main()
