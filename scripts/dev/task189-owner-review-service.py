"""Authenticated CST-DEV review intake for the expired Task 189 reservation."""
import http.server
import json
from pathlib import Path
import runpy
import socketserver
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

verify = trusted('task183-single-click-broker-dev.py')['verify_jwt']
owner = trusted('task183-owner-identity-readiness.py')['eligible_owner']
review = trusted('task189-recovery-review-intake-dev.py')

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

    def handle_review(self, write):
        route = BASE + ('review-request' if write else 'approval-readiness') + QUERY
        if self.path != route or self.headers.get('Host') != HOST:
            return self.reply(404, {})
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return self.reply(401, {'error':'OWNER_SESSION_REQUIRED'})
        try:
            actor = verify(auth[7:])
            if not owner(actor)['eligible']:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            return self.reply(403, {'error':'OWNER_SESSION_REQUIRED'})
        try:
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
            self.reply(200, result)
        except (RuntimeError, ValueError, OSError, TimeoutError):
            self.reply(503, {'error':'REVIEW_EVIDENCE_UNAVAILABLE'})

    def do_GET(self):
        self.handle_review(False)

    def do_POST(self):
        self.handle_review(True)

if __name__ == '__main__':
    import os
    import socket
    # systemd owns the socket and passes its listening descriptor to this service.
    with socketserver.UnixStreamServer('/unused', Handler, bind_and_activate=False) as server:
        server.socket.close()
        server.socket = socket.socket(fileno=3)
        server.serve_forever()
