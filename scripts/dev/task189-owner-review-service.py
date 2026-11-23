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
            if write:
                body = b'{"requestReview":true}'
                if (self.headers.get('Origin') != 'https://' + HOST or
                    self.headers.get('X-GPT02-Intent') != 'review-task189' or
                    self.headers.get_content_type() != 'application/json' or
                    self.headers.get('Content-Length') != str(len(body)) or
                    self.headers.get('Transfer-Encoding') or self.rfile.read(len(body)) != body):
                    return self.reply(400, {'error':'INVALID_REVIEW_REQUEST'})
                review['record_pending_request'](actor=actor, source=review['source_readback']())
            status = review['get_status'](actor)
            source = review['validate_source'](review['source_readback']())
            self.reply(200, {'taskId':189,'ready':False,'recorded':False,
                             'reviewRequested':status['requested'],'canRequestReview':not status['requested'],
                             'originalAttemptId':source['attempt_id'],'dispatchPermitted':False})
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
