"""Authenticated CST-DEV review intake for the expired Task 189 reservation."""
from functools import lru_cache
import http.client
import http.server
import json
import os
import sqlite3
from types import SimpleNamespace
from pathlib import Path
import runpy
import socket
import socketserver
import struct
import stat

ROOT = Path('/opt/ai-coding-standalone-dev/qa')
HOST = 'dev-ai-task.cstlogistic.co.id'
BASE = '/api/ai-tasks/189/gpt02-owner-'
QUERY = '?companyId=default'

def trusted(name):
    path = ROOT / name
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError('untrusted review module')
    return runpy.run_path(str(path))

@lru_cache(maxsize=1)
def hub_verifier():
    return trusted('task183-single-click-broker-dev.py')['verify_jwt']

owner = trusted('task183-owner-identity-readiness.py')['eligible_owner']
review = trusted('task189-recovery-review-intake-dev.py')

approval = trusted('task189-owner-approval-http.candidate.py')
writer = trusted('task189-owner-approval-writer-dev.py')
handoff = trusted('task189-owner-after-decision.candidate.py')
window = trusted('task189-owner-window-readiness.candidate.py')

SESSION_PATH = '/internal/task189/verified-owner'
SESSION_FIELDS = ('id', 'role', 'companyId', 'email', 'authSource', 'authSupabaseId', 'authVerifiedAt')
REVIEW_SOCKET = '/run/cst-task189-owner-review.sock'
CORE_UNIT = 'ai-coding-standalone-dev-approval.service'


def core_peer(connection):
    pid, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if uid != 0 or pid <= 1:
        return False
    return ('0::/system.slice/' + CORE_UNIT) in Path(f'/proc/{pid}/cgroup').read_text().splitlines()


class ReviewConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        try:
            self.sock.connect(REVIEW_SOCKET)
            _, uid, _ = struct.unpack('3i', self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != 0:
                raise OSError('Unexpected review service owner')
        except BaseException:
            self.close()
            raise


def verify_via_hub(token):
    # The established Hub verifier alone handles its session signing key.
    if not token.isascii() or not 48 <= len(token) <= 4096 or any(c.isspace() for c in token):
        raise ValueError('Invalid session')
    connection = ReviewConnection(HOST, timeout=8)
    try:
        connection.request('GET', SESSION_PATH, headers={
            'Host': HOST, 'Authorization': 'Bearer ' + token})
        response = connection.getresponse()
        if response.status in (401, 403):
            raise ValueError('Owner session required')
        if response.status != 200:
            raise OSError('Hub session verification unavailable')
        body = response.read(8193)
        if len(body) > 8192:
            raise OSError('Invalid Hub session response')
        actor = json.loads(body)
        if not isinstance(actor, dict) or set(actor) != set(SESSION_FIELDS):
            raise OSError('Invalid Hub session response')
        return actor
    finally:
        connection.close()


def serve_core_request(request):
    routes = {('GET', BASE + 'approval-readiness' + QUERY), ('POST', approval['PATH'])}
    if (request.command, request.path) not in routes:
        return request.send(404, {})
    http_request = SimpleNamespace(path=request.path, headers=request.headers,
                                   rfile=request.rfile, reply=request.send)
    return Handler.handle_review(http_request, request.command == 'POST', verify_via_hub)


def signing_window_ready():
    try:
        if not window['check']():
            return False
        db = writer['LIVE_DB']
        return os.access(db, os.W_OK) and os.access(db.parent, os.W_OK)
    except (RuntimeError, OSError):
        return False

def decision_recorded(actor):
    with sqlite3.connect(writer['LIVE_DB'].as_uri()+'?mode=ro', uri=True) as db:
        return db.execute("""
          SELECT EXISTS (SELECT 1 FROM gpt02_task189_owner_recovery_decisions d
          JOIN gpt02_task189_owner_recovery_outbox o ON o.decision_id=d.id
          AND o.claims_sha256=d.claims_sha256
          WHERE d.request_id=? AND d.auth_user_id=? AND d.owner_subject=?)""",
          (writer['REQUEST'], actor['authSupabaseId'], 'owner:'+actor['id'])).fetchone()[0] == 1

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_review(self, write, verify_session=None):
        route = BASE + ('review-request' if write else 'approval-readiness') + QUERY
        final = write and self.path == approval['PATH']
        if (not final and self.path != route) or self.headers.get('Host') != HOST:
            return self.reply(404, {})
        if len(self.headers.get_all('Authorization', [])) != 1:
            return self.reply(401, {'error':'OWNER_SESSION_REQUIRED'})
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return self.reply(401, {'error':'OWNER_SESSION_REQUIRED'})
        try:
            verify = verify_session if verify_session is not None else hub_verifier()
            actor = verify(auth[7:])
            if not owner(actor)['eligible']:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            return self.reply(403, {'error':'OWNER_SESSION_REQUIRED'})
        except (OSError, RuntimeError, http.client.HTTPException, sqlite3.Error):
            return self.reply(503, {'error':'OWNER_VERIFICATION_UNAVAILABLE'})
        try:
            if final:
                if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length') != str(len(approval['BODY'])):
                    return self.reply(400, {'error':'INVALID_APPROVAL_REQUEST'})
                if decision_recorded(actor):
                    return self.reply(409, {'error':'OWNER_DECISION_ALREADY_RECORDED'})
                if not signing_window_ready():
                    return self.reply(503, {'error':'SIGNING_WINDOW_NOT_READY'})
                decision = approval['authorize_request'](
                    path=self.path, headers=self.headers,
                    body=self.rfile.read(len(approval['BODY'])), verify_session=verify,
                    load_review=lambda: SimpleNamespace(**review), write_approval=writer['record'])
                proof = handoff['run_handoff'](decision, expected_request=writer['REQUEST'])
                return self.reply(200, {**decision, **proof})
            source = review['source_readback']()
            review['validate_source'](source)
            if write:
                if (self.headers.get('Origin') != 'https://' + HOST or
                    self.headers.get_content_type() != 'application/json' or
                    self.headers.get('Transfer-Encoding')):
                    return self.reply(400, {'error':'INVALID_REVIEW_REQUEST'})
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 1024:
                    return self.reply(400, {'error':'INVALID_REVIEW_REQUEST'})
                intent = self.headers.get('X-GPT02-Intent')
                body = json.loads(self.rfile.read(length))
                if intent == 'review-task189' and body == {'requestReview': True}:
                    review['record_pending_request'](actor=actor, source=source)
                elif intent in ('review-evidence-task189', 'confirm-intent-task189'):
                    packet = review['review_evidence_packet'](actor, actual_source=source)
                    digest = packet['evidenceSha256']
                    if not isinstance(body, dict) or body.get('evidenceSha256') != digest:
                        return self.reply(409, {'error':'EVIDENCE_CHANGED'})
                    if intent == 'review-evidence-task189' and set(body) == {'evidenceSha256'}:
                        review['attest_review_evidence'](actor=actor, evidence_sha256=digest, actual_source=source)
                        challenge = review['issue_recovery_consent_challenge'](actor=actor, actual_source=source)
                        return self.reply(200, challenge)
                    if intent != 'confirm-intent-task189' or set(body) != {'evidenceSha256','challengeId','nonce'}:
                        return self.reply(400, {'error':'INVALID_REVIEW_REQUEST'})
                    review['consent_to_recovery_review'](actor=actor, challenge_id=body['challengeId'],
                        nonce=body['nonce'], evidence_sha256=digest, actual_source=source)
                else:
                    return self.reply(400, {'error':'INVALID_REVIEW_REQUEST'})
            status = review['get_status'](actor)
            result = {'taskId':189,'ready':False,'recorded':False,'reviewRequested':status['requested'],
                      'canRequestReview':not status['requested'],'dispatchPermitted':False}
            if status['requested']:
                packet = review['review_evidence_packet'](actor, actual_source=source)
                if not Path('/etc/gpt02-dev/task189-broker-release.approved').exists():
                    result['releaseStatus'] = 'AWAITING_RELEASE'
                result.update(evidenceSha256=packet['evidenceSha256'],
                              originalAttemptId=source['attempt_id'], originalExpiryMs=int(source['expires_at_ms']),
                              intentRecorded=review['get_recovery_consent_state'](actor)['recorded'])
                result['recorded'] = decision_recorded(actor)
                result['ready'] = result['intentRecorded'] and not result['recorded'] and signing_window_ready()
            self.reply(200, result)
        except (RuntimeError, ValueError, OSError, sqlite3.Error, TimeoutError):
            self.reply(503, {'error':'REVIEW_EVIDENCE_UNAVAILABLE'})

    def do_GET(self):
        if self.path == SESSION_PATH:
            try:
                if self.headers.get('Host') != HOST or not core_peer(self.connection):
                    return self.reply(404, {})
                auth = self.headers.get('Authorization', '')
                if len(self.headers.get_all('Authorization', [])) != 1 or not auth.startswith('Bearer '):
                    return self.reply(401, {})
                actor = hub_verifier()(auth[7:])
                if not owner(actor)['eligible']:
                    return self.reply(403, {})
                return self.reply(200, {key: actor[key] for key in SESSION_FIELDS})
            except (ValueError, KeyError, TypeError):
                return self.reply(403, {})
            except (OSError, RuntimeError, sqlite3.Error):
                return self.reply(503, {})
        self.handle_review(False)

    def do_POST(self):
        if self.path == approval['PATH']:
            return self.reply(404, {})
        self.handle_review(True)

if __name__ == '__main__':
    import os
    import socket
    # systemd owns the socket and passes its listening descriptor to this service.
    with socketserver.UnixStreamServer('/unused', Handler, bind_and_activate=False) as server:
        server.socket.close()
        server.socket = socket.socket(fileno=3)
        server.serve_forever()
